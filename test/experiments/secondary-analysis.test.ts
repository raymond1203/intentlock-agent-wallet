import { describe, expect, it } from 'vitest';

import {
  ABLATION_ARMS,
  ARM_METADATA,
  type AblationArm,
  type AblationResult,
} from '../../src/experiments/ablations.js';
import type { AdaptiveEpisodeResult } from '../../src/experiments/adaptive.js';
import type { AdaptiveComparisonDocument } from '../../src/experiments/adaptive-provenance.js';
import type { RawEvaluationResult } from '../../src/experiments/evaluate-case.js';
import { aggregateEvaluationRecords } from '../../src/experiments/metrics.js';
import {
  analyzeAblationResults,
  analyzeAdaptiveResults,
  assertAblationReferenceMatchesPrimary,
  assertAblationSummaryMatchesRaw,
  assertAdaptiveSummaryMatchesRaw,
  parseAblationRawResults,
  parseAdaptiveEpisodes,
} from '../../src/experiments/secondary-analysis.js';

const RUN_ID = 'ablation-analysis-test';

function rawResult(caseId: string): RawEvaluationResult {
  return {
    record: {
      runId: RUN_ID,
      caseId,
      baseScenarioId: caseId,
      system: 'INTENTLOCK',
      workflow: 'TRANSFER',
      class: 'BASE',
      split: 'TRAIN',
      chainIds: [1],
      actionCount: 1,
      observationStage: 'PRE_SIGN',
      oracleEvidenceLevel: 'EXPECTED_FIXTURE',
      mutationValidity: null,
      evaluationMode: 'OFFLINE_COUNTERFACTUAL_REPLAY',
      preSignDecision: 'ALLOW',
      confirmationRequests: 0,
      firstDetectionOrdinal: null,
      executionStatus: 'REPLAYED',
      postStateStatus: 'PASS',
      postStateEvidence: 'AUTHORED_ORACLE_FIXTURE',
      counterfactualEconomicEffectIssued: true,
      counterfactualBenignCompletion: true,
      latencyMs: 1,
    },
    variant: 'BENIGN_ORIGINAL',
    mutationOperator: null,
    oracleExpectedDecision: 'ALLOW',
    oracleViolationAmount: '0',
    oracleAllowanceExposure: '0',
    scenarioSha256: 'a'.repeat(64),
    postStateMonitorDecision: 'ALLOW',
    firstDetectionStage: 'NONE',
    firstDetectionOrdinal: null,
    verdict: {
      decision: 'ALLOW',
      rationale: 'Synthetic complete result.',
      reasonCodes: [],
      attempts: 1,
    },
  };
}

function ablationResult(arm: AblationArm, caseId: string): AblationResult {
  const metadata = ARM_METADATA[arm];
  const source =
    arm === 'SEMANTIC_ONLY'
      ? 'PRIMARY_LLM_REFERENCE'
      : arm === 'HYBRID_CONJUNCTION'
        ? 'FRESH_PLUS_PRIMARY_LLM'
        : 'FRESH_SCENARIO_EVALUATION';
  const referencesPrimary = source !== 'FRESH_SCENARIO_EVALUATION';
  const result = rawResult(caseId);
  if (arm === 'SEMANTIC_ONLY') {
    result.record.system = 'LLM_VERIFIER';
    result.record.runId = 'primary-analysis-test';
  }
  return {
    schemaVersion: '0.2',
    runId: RUN_ID,
    arm,
    kind: metadata.kind,
    causalAblation: metadata.causalAblation,
    changedFactor: metadata.changedFactor,
    nonCausalReason: metadata.nonCausalReason,
    configuration: structuredClone(metadata.configuration),
    variant: 'BENIGN_ORIGINAL',
    mutationOperator: null,
    result,
    provenance: {
      source,
      evaluatorVersion: '0.2',
      scenarioSha256: 'a'.repeat(64),
      caseManifestSha256: 'b'.repeat(64),
      primaryRunId: referencesPrimary ? 'primary-analysis-test' : null,
      primaryResultSha256: referencesPrimary ? 'c'.repeat(64) : null,
    },
  };
}

function ablationCorpus(): AblationResult[] {
  return ABLATION_ARMS.flatMap((arm) =>
    Array.from({ length: 400 }, (_, index) =>
      ablationResult(arm, `TR-${String(index + 1).padStart(3, '0')}--BENIGN_ORIGINAL`),
    ),
  );
}

function ablationRunnerSummary(corpus: readonly AblationResult[]): unknown {
  return {
    schemaVersion: '0.2',
    runId: RUN_ID,
    records: 3_200,
    summary: ABLATION_ARMS.map((arm, armIndex) => {
      const armResults = corpus.filter((result) => result.arm === arm);
      const records = armResults.map((result) => result.result.record);
      const [aggregate] = aggregateEvaluationRecords(records);
      if (!aggregate) throw new Error('test aggregate is missing');
      const metadata = ARM_METADATA[arm];
      const postStateDetections = armResults.filter(
        (result) => result.result.firstDetectionStage === 'POST_STATE',
      ).length;
      const groupCount = new Set(records.map((record) => record.baseScenarioId)).size;
      return {
        arm,
        kind: metadata.kind,
        causalAblation: metadata.causalAblation,
        changedFactor: metadata.changedFactor,
        nonCausalReason: metadata.nonCausalReason,
        configuration: metadata.configuration,
        records: 400,
        aggregate,
        unsafeExecutionRate95: {
          point: aggregate.unsafeExecutionRate,
          lower95: aggregate.unsafeExecutionRate,
          upper95: aggregate.unsafeExecutionRate,
          replicates: 10_000,
          seed: 2026 + armIndex * 2,
          groupCount,
        },
        benignCompletionRate95: {
          point: aggregate.benignCompletionRate,
          lower95: aggregate.benignCompletionRate,
          upper95: aggregate.benignCompletionRate,
          replicates: 10_000,
          seed: 2027 + armIndex * 2,
          groupCount,
        },
        postStateDetections,
        detectionOrdinals: {
          planPreflight: armResults.filter((result) => result.result.firstDetectionOrdinal === 0)
            .length,
          actionPreSign: armResults.filter(
            (result) =>
              result.result.firstDetectionStage === 'PRE_SIGN' &&
              result.result.firstDetectionOrdinal !== null &&
              result.result.firstDetectionOrdinal > 0,
          ).length,
          postState: postStateDetections,
          none: armResults.filter((result) => result.result.firstDetectionOrdinal === null).length,
        },
        provenanceSources: {
          FRESH_SCENARIO_EVALUATION: armResults.filter(
            (result) => result.provenance.source === 'FRESH_SCENARIO_EVALUATION',
          ).length,
          PRIMARY_LLM_REFERENCE: armResults.filter(
            (result) => result.provenance.source === 'PRIMARY_LLM_REFERENCE',
          ).length,
          FRESH_PLUS_PRIMARY_LLM: armResults.filter(
            (result) => result.provenance.source === 'FRESH_PLUS_PRIMARY_LLM',
          ).length,
        },
      };
    }),
  };
}

function adaptiveEpisode(index: number): AdaptiveEpisodeResult {
  const families = [
    'ASSET_AUTHORIZATION',
    'ROUTED_SWAP',
    'CROSS_CHAIN',
    'LENDING',
    'BATCH_RECOVERY',
  ] as const;
  const family = families[Math.floor(index / 8)];
  if (!family) throw new Error('test adaptive family index is out of range');
  return {
    schemaVersion: '0.1',
    claimScope: 'OFFLINE_SCRIPTED_SIGNER_BOUNDARY_ONLY',
    attackerMode: 'DETERMINISTIC_SCRIPTED_NO_MODEL',
    postStateObservation: 'NOT_OBSERVED',
    episodeId: `ADAPT-${String(index + 1).padStart(2, '0')}`,
    baseScenarioId: `TR-${String(index + 1).padStart(2, '0')}`,
    family,
    attackType: 'TOOL_OUTPUT_POISONING',
    seed: 2026 + index,
    maxReplans: 3,
    attemptedPlans: 1,
    signerInvocations: 0,
    outcome: 'NORMAL_FAILURE',
    classification: null,
    transcript: [
      {
        replanNumber: 0,
        strategyId: 'synthetic-strategy',
        injectionText: 'synthetic public injection',
        actionSha256: 'd'.repeat(64),
        chainId: 1,
        selector: '0x12345678',
        guardDecision: 'DENY',
        reasonCode: 'SYNTHETIC_DENY',
        publicReason: 'Synthetic guard rejection.',
        publicToolResult: 'No signer invocation.',
        signerInvoked: false,
        executionStatus: 'BLOCKED',
      },
    ],
  };
}

function adaptiveComparison(
  episodes: readonly AdaptiveEpisodeResult[],
): AdaptiveComparisonDocument {
  const digest = 'c'.repeat(64);
  return {
    schemaVersion: '0.1',
    runId: 'adaptive-analysis-test',
    createdAt: '2026-09-04T00:00:00.000Z',
    design: 'NON_PAIRED_NON_CAUSAL',
    interpretation:
      'Descriptive contrast only. Rows share an authored base-scenario ID but are not paired or equivalent experimental cases, so no causal effect is estimated.',
    evidenceLimits: {
      equivalentCases: false,
      causalComparison: false,
      modelAdaptiveEvidence: false,
      forkExecutionEvidence: false,
      productionMetaMaskEvidence: false,
    },
    sources: {
      reviewedSourceCommit: 'a'.repeat(40),
      freezeCommit: 'b'.repeat(40),
      executionCommit: 'c'.repeat(40),
      primaryRunId: 'primary-analysis-test',
      primaryRunManifestSha256: digest,
      primaryRawSha256: digest,
      primarySelectedResultsSha256: digest,
      primaryStaticIntentLockSha256: digest,
      adaptiveSelectionConfigSha256: digest,
    },
    selection: {
      adaptiveSelectionConfigPath: 'experiments/configs/adaptive-selection-v0.1.json',
      staticSelection: 'PRIMARY_ATTEMPT_1_INTENTLOCK_BENIGN_ORIGINAL_BY_BASE_SCENARIO_ID',
      rowCount: 40,
    },
    rows: episodes.map((episode) => ({
      relationship: 'NON_PAIRED_NON_CAUSAL',
      equivalentCaseClaim: false,
      sameAuthoredBaseScenarioIdOnly: true,
      baseScenarioId: episode.baseScenarioId,
      family: episode.family,
      attackType: episode.attackType,
      seed: episode.seed,
      frozenStaticIntentLock: {
        caseId: `${episode.baseScenarioId}--BENIGN_ORIGINAL`,
        variant: 'BENIGN_ORIGINAL',
        primaryResultSha256: digest,
        record: {
          ...rawResult(`${episode.baseScenarioId}--BENIGN_ORIGINAL`).record,
          runId: 'primary-analysis-test',
          baseScenarioId: episode.baseScenarioId,
        },
      },
      adaptiveSignerBoundary: {
        episodeId: episode.episodeId,
        outcome: episode.outcome,
        attemptedPlans: episode.attemptedPlans,
        signerInvocations: episode.signerInvocations,
        claimScope: 'OFFLINE_SCRIPTED_SIGNER_BOUNDARY_ONLY',
        attackerMode: 'DETERMINISTIC_SCRIPTED_NO_MODEL',
        postStateObservation: 'NOT_OBSERVED',
        structuralVerdict: null,
      },
    })),
  };
}

describe('secondary result analysis', () => {
  it('parses 3,200 append-only rows and estimates only one-factor causal arms', () => {
    const corpus = ablationCorpus();
    const source = corpus
      .map((value, sequence) =>
        JSON.stringify({
          schemaVersion: '0.1',
          sequence,
          recordedAt: '2026-09-04T00:00:00.000Z',
          value,
        }),
      )
      .join('\n');
    const parsed = parseAblationRawResults(source, RUN_ID);
    const analysis = analyzeAblationResults(parsed, { bootstrapReplicates: 100 });
    expect(analysis.recordCount).toBe(3_200);
    expect(
      analysis.rows
        .filter((row) => row.pairedUnsafeRateDifferenceFromReference95 !== null)
        .map((row) => row.arm),
    ).toEqual(['STATELESS_LEDGER', 'SHALLOW_DECODER', 'NO_POST_STATE_VERIFIER']);
    expect(analysis.rows.find((row) => row.arm === 'SEMANTIC_ONLY')).toMatchObject({
      interpretationClass: 'NON_CAUSAL_STAGE_COMPARISON',
      causalAblation: false,
      pairedUnsafeRateDifferenceFromReference95: null,
    });
    expect(() => parseAblationRawResults(source.split('\n').slice(1).join('\n'), RUN_ID)).toThrow(
      /record count/,
    );
    const mismatched = structuredClone(corpus);
    const semantic = mismatched.find((row) => row.arm === 'SEMANTIC_ONLY');
    if (!semantic) throw new Error('test semantic row is missing');
    semantic.result.scenarioSha256 = 'd'.repeat(64);
    semantic.provenance.scenarioSha256 = 'd'.repeat(64);
    const mismatchedSource = mismatched
      .map((value, sequence) =>
        JSON.stringify({
          schemaVersion: '0.1',
          sequence,
          recordedAt: '2026-09-04T00:00:00.000Z',
          value,
        }),
      )
      .join('\n');
    expect(() => parseAblationRawResults(mismatchedSource, RUN_ID)).toThrow(
      /frozen-case provenance/,
    );
  });

  it('rejects runner summaries that do not reproduce the ablation raw artifact', () => {
    const corpus = ablationCorpus();
    const summary = ablationRunnerSummary(corpus);
    expect(() => {
      assertAblationSummaryMatchesRaw(summary, corpus);
    }).not.toThrow();
    const tampered = structuredClone(summary) as {
      summary: Array<{ aggregate: { total: number } }>;
    };
    const first = tampered.summary[0];
    if (!first) throw new Error('test ablation summary row is missing');
    first.aggregate.total = 399;
    expect(() => {
      assertAblationSummaryMatchesRaw(tampered, corpus);
    }).toThrow(/does not match/);
  });

  it('requires full-arm semantics to match primary IntentLock case by case', () => {
    const corpus = ablationCorpus();
    const primary = corpus
      .filter((row) => row.arm === 'INTENTLOCK_FULL')
      .map((row) => structuredClone(row.result));
    expect(() => {
      assertAblationReferenceMatchesPrimary(corpus, primary);
    }).not.toThrow();
    const tampered = structuredClone(primary);
    const first = tampered[0];
    if (!first) throw new Error('test primary row is missing');
    first.record.confirmationRequests = 1;
    expect(() => {
      assertAblationReferenceMatchesPrimary(corpus, tampered);
    }).toThrow(/confirmationRequests/);
  });

  it('keeps adaptive output descriptive, offline, non-paired, and non-causal', () => {
    const episodes = Array.from({ length: 40 }, (_, index) => adaptiveEpisode(index));
    const episodeSource = episodes.map((episode) => JSON.stringify(episode)).join('\n');
    const parsed = parseAdaptiveEpisodes(episodeSource);
    const comparison = adaptiveComparison(parsed);
    const analysis = analyzeAdaptiveResults('adaptive-analysis-test', parsed, comparison);
    expect(analysis).toMatchObject({
      design: 'NON_PAIRED_NON_CAUSAL',
      claimScope: 'OFFLINE_SCRIPTED_SIGNER_BOUNDARY_ONLY',
      attackerMode: 'DETERMINISTIC_SCRIPTED_NO_MODEL',
      postStateObservation: 'NOT_OBSERVED',
      evidenceLimits: {
        equivalentCases: false,
        causalComparison: false,
        modelAdaptiveEvidence: false,
        forkExecutionEvidence: false,
        productionMetaMaskEvidence: false,
      },
      adaptiveSignerBoundaryDescriptive: {
        evidenceMode: 'OFFLINE_SCRIPTED_SIGNER_BOUNDARY_FAKE_EXECUTOR',
        episodes: 40,
        outcomes: { NORMAL_FAILURE: 40 },
      },
    });
    const tampered = structuredClone(comparison);
    const first = tampered.rows[0];
    if (!first) throw new Error('test adaptive comparison row is missing');
    first.adaptiveSignerBoundary.outcome = 'SAFE_BLOCK';
    expect(() => analyzeAdaptiveResults('adaptive-analysis-test', parsed, tampered)).toThrow(
      /not bound/,
    );

    const summary = {
      schemaVersion: '0.1',
      runId: 'adaptive-analysis-test',
      claimScope: 'OFFLINE_SCRIPTED_SIGNER_BOUNDARY_ONLY',
      attackerMode: 'DETERMINISTIC_SCRIPTED_NO_MODEL',
      postStateObservation: 'NOT_OBSERVED',
      episodeCount: 40,
      attemptedPlans: 40,
      signerInvocations: 0,
      outcomes: {
        ATTACK_SUCCESS: 0,
        SAFE_BLOCK: 0,
        NORMAL_FAILURE: 40,
        INCONCLUSIVE: 0,
      },
      comparison: {
        design: 'NON_PAIRED_NON_CAUSAL',
        rows: 40,
        equivalentCaseClaim: false,
        causalComparison: false,
        modelAdaptiveEvidence: false,
        forkExecutionEvidence: false,
      },
    };
    expect(() => {
      assertAdaptiveSummaryMatchesRaw(summary, 'adaptive-analysis-test', parsed, comparison);
    }).not.toThrow();
    const inflated = structuredClone(summary);
    inflated.signerInvocations = 1;
    expect(() => {
      assertAdaptiveSummaryMatchesRaw(inflated, 'adaptive-analysis-test', parsed, comparison);
    }).toThrow(/does not exactly match/);
  });
});
