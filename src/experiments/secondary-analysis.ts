import { z } from 'zod';

import {
  ABLATION_ARMS,
  ARM_METADATA,
  AblationRawEnvelopeSchema,
  AblationResultSchema,
  type AblationArm,
  type AblationResult,
} from './ablations.js';
import { AdaptiveEpisodeResultSchema, type AdaptiveEpisodeResult } from './adaptive.js';
import {
  ADAPTIVE_COMPARISON_DESIGN,
  AdaptiveComparisonDocumentSchema,
  type AdaptiveComparisonDocument,
} from './adaptive-provenance.js';
import {
  benignCompletionCount,
  groupedStratifiedBootstrap,
  groupedStratifiedPairedBootstrap,
  unsafeExecutionCount,
  type BootstrapInterval,
  type PairedBootstrapInterval,
} from './bootstrap.js';
import type { RawEvaluationResult } from './evaluate-case.js';
import { aggregateEvaluationRecords, type EvaluationAggregate } from './metrics.js';

export const ABLATION_INTERPRETATION_CLASSES = {
  INTENTLOCK_FULL: 'REFERENCE',
  SEMANTIC_ONLY: 'NON_CAUSAL_STAGE_COMPARISON',
  SYMBOLIC_ONLY: 'NON_CAUSAL_STAGE_COMPARISON',
  HYBRID_CONJUNCTION: 'NON_CAUSAL_STAGE_COMPARISON',
  STATELESS_LEDGER: 'ONE_FACTOR_CAUSAL_ABLATION',
  SHALLOW_DECODER: 'ONE_FACTOR_CAUSAL_ABLATION',
  NO_POST_STATE_VERIFIER: 'ONE_FACTOR_CAUSAL_ABLATION',
  CONFIRMATION_ALWAYS: 'NON_CAUSAL_POLICY_VARIANT',
} as const satisfies Readonly<Record<AblationArm, string>>;

export interface AblationAnalysisRow {
  arm: AblationArm;
  interpretationClass: (typeof ABLATION_INTERPRETATION_CLASSES)[AblationArm];
  changedFactor: string;
  causalAblation: boolean;
  nonCausalReason: string | null;
  records: number;
  aggregate: EvaluationAggregate;
  unsafeAuthorizationRate95: BootstrapInterval;
  benignCompletionRate95: BootstrapInterval;
  pairedUnsafeRateDifferenceFromReference95: PairedBootstrapInterval | null;
  pairedBenignCompletionDifferenceFromReference95: PairedBootstrapInterval | null;
}

export interface AblationAnalysis {
  runId: string;
  evidenceMode: 'OFFLINE_COUNTERFACTUAL_REPLAY';
  recordCount: 3200;
  design: {
    referenceArm: 'INTENTLOCK_FULL';
    nonCausalStageComparisons: ['SEMANTIC_ONLY', 'SYMBOLIC_ONLY', 'HYBRID_CONJUNCTION'];
    oneFactorCausalAblations: ['STATELESS_LEDGER', 'SHALLOW_DECODER', 'NO_POST_STATE_VERIFIER'];
    nonCausalPolicyVariants: ['CONFIRMATION_ALWAYS'];
  };
  rows: AblationAnalysisRow[];
}

const BootstrapSummarySchema = z
  .object({
    point: z.number(),
    lower95: z.number(),
    upper95: z.number(),
    replicates: z.literal(10_000),
    seed: z.number().int().nonnegative(),
    groupCount: z.number().int().positive(),
  })
  .strict();

const AblationRunnerSummarySchema = z
  .object({
    schemaVersion: z.literal('0.2'),
    runId: z.string().min(1),
    records: z.literal(3_200),
    summary: z
      .array(
        z
          .object({
            arm: z.enum(ABLATION_ARMS),
            kind: AblationResultSchema.shape.kind,
            causalAblation: z.boolean(),
            changedFactor: z.string().min(1),
            nonCausalReason: z.string().min(1).nullable(),
            configuration: AblationResultSchema.shape.configuration,
            records: z.literal(400),
            aggregate: z.unknown(),
            unsafeExecutionRate95: BootstrapSummarySchema,
            benignCompletionRate95: BootstrapSummarySchema,
            postStateDetections: z.number().int().nonnegative(),
            detectionOrdinals: z
              .object({
                planPreflight: z.number().int().nonnegative(),
                actionPreSign: z.number().int().nonnegative(),
                postState: z.number().int().nonnegative(),
                none: z.number().int().nonnegative(),
              })
              .strict(),
            provenanceSources: z
              .object({
                FRESH_SCENARIO_EVALUATION: z.number().int().nonnegative(),
                PRIMARY_LLM_REFERENCE: z.number().int().nonnegative(),
                FRESH_PLUS_PRIMARY_LLM: z.number().int().nonnegative(),
              })
              .strict(),
          })
          .strict(),
      )
      .length(8),
  })
  .strict();

const EXPECTED_ABLATION_PROVENANCE = {
  INTENTLOCK_FULL: 'FRESH_SCENARIO_EVALUATION',
  SEMANTIC_ONLY: 'PRIMARY_LLM_REFERENCE',
  SYMBOLIC_ONLY: 'FRESH_SCENARIO_EVALUATION',
  HYBRID_CONJUNCTION: 'FRESH_PLUS_PRIMARY_LLM',
  STATELESS_LEDGER: 'FRESH_SCENARIO_EVALUATION',
  SHALLOW_DECODER: 'FRESH_SCENARIO_EVALUATION',
  NO_POST_STATE_VERIFIER: 'FRESH_SCENARIO_EVALUATION',
  CONFIRMATION_ALWAYS: 'FRESH_SCENARIO_EVALUATION',
} as const satisfies Readonly<Record<AblationArm, AblationResult['provenance']['source']>>;

function parseJsonLines(source: string, label: string): unknown[] {
  if (!source.trim()) throw new Error(`${label} is empty`);
  return source
    .trim()
    .split(/\r?\n/u)
    .map((line, index) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        throw new Error(`${label} line ${String(index + 1)} is not valid JSON`);
      }
    });
}

export function parseAblationRawResults(source: string, runId: string): AblationResult[] {
  const envelopes = parseJsonLines(source, 'ablation raw artifact').map((value) =>
    AblationRawEnvelopeSchema.parse(value),
  );
  if (envelopes.length !== 3_200) {
    throw new Error(`ablation raw record count ${String(envelopes.length)} != 3200`);
  }
  for (const [index, envelope] of envelopes.entries()) {
    if (envelope.sequence !== index) {
      throw new Error(`ablation raw sequence ${String(envelope.sequence)} != ${String(index)}`);
    }
    if (envelope.value.runId !== runId) {
      throw new Error(`ablation row ${String(index)} belongs to a different run`);
    }
  }
  const results = envelopes.map((envelope) => envelope.value);
  const referenceRows = results.filter((result) => result.arm === 'INTENTLOCK_FULL');
  const referenceByCase = new Map(
    referenceRows.map((result) => [result.result.record.caseId, result]),
  );
  if (referenceRows.length !== 400 || referenceByCase.size !== 400) {
    throw new Error('INTENTLOCK_FULL must contain 400 unique cases');
  }
  for (const arm of ABLATION_ARMS) {
    const rows = results.filter((result) => result.arm === arm);
    const caseIds = new Set(rows.map((result) => result.result.record.caseId));
    if (
      rows.length !== 400 ||
      caseIds.size !== 400 ||
      [...referenceByCase.keys()].some((caseId) => !caseIds.has(caseId))
    ) {
      throw new Error(`${arm} does not contain the same 400 unique frozen cases`);
    }
    for (const row of rows) {
      const caseId = row.result.record.caseId;
      const reference = referenceByCase.get(caseId);
      if (!reference) throw new Error(`${arm} contains unknown frozen case ${caseId}`);
      if (
        row.result.scenarioSha256 !== reference.result.scenarioSha256 ||
        row.provenance.scenarioSha256 !== row.result.scenarioSha256 ||
        row.provenance.caseManifestSha256 !== reference.provenance.caseManifestSha256 ||
        row.result.record.baseScenarioId !== reference.result.record.baseScenarioId ||
        row.result.record.workflow !== reference.result.record.workflow ||
        row.result.record.class !== reference.result.record.class ||
        row.result.record.split !== reference.result.record.split ||
        row.result.variant !== reference.result.variant ||
        row.result.mutationOperator !== reference.result.mutationOperator
      ) {
        throw new Error(`${arm} frozen-case provenance differs for ${caseId}`);
      }
      const expectedSource = EXPECTED_ABLATION_PROVENANCE[arm];
      if (row.provenance.source !== expectedSource) {
        throw new Error(`${arm} uses an invalid provenance source for ${caseId}`);
      }
      const referencesPrimary = expectedSource !== 'FRESH_SCENARIO_EVALUATION';
      const hasPrimaryRunId = row.provenance.primaryRunId !== null;
      const hasPrimaryResultHash = row.provenance.primaryResultSha256 !== null;
      if (
        (referencesPrimary && (!hasPrimaryRunId || !hasPrimaryResultHash)) ||
        (!referencesPrimary && (hasPrimaryRunId || hasPrimaryResultHash))
      ) {
        throw new Error(`${arm} primary-reference provenance is incomplete for ${caseId}`);
      }
      if (
        (arm === 'SEMANTIC_ONLY' &&
          (row.result.record.system !== 'LLM_VERIFIER' ||
            row.result.record.runId !== row.provenance.primaryRunId)) ||
        (arm !== 'SEMANTIC_ONLY' &&
          (row.result.record.system !== 'INTENTLOCK' || row.result.record.runId !== runId))
      ) {
        throw new Error(
          `${arm} result identity differs from its declared provenance for ${caseId}`,
        );
      }
    }
  }
  return results;
}

const PRIMARY_REFERENCE_FIELDS = [
  'preSignDecision',
  'confirmationRequests',
  'firstDetectionOrdinal',
  'executionStatus',
  'postStateStatus',
  'postStateEvidence',
  'counterfactualEconomicEffectIssued',
  'counterfactualBenignCompletion',
  'failureClass',
] as const satisfies ReadonlyArray<keyof RawEvaluationResult['record']>;

/** The fresh full arm must reproduce the frozen primary IntentLock semantics case by case. */
export function assertAblationReferenceMatchesPrimary(
  ablationResults: readonly AblationResult[],
  primaryIntentLock: readonly RawEvaluationResult[],
): void {
  const reference = new Map(
    ablationResults
      .filter((result) => result.arm === 'INTENTLOCK_FULL')
      .map((result) => [result.result.record.caseId, result.result]),
  );
  if (reference.size !== 400 || primaryIntentLock.length !== 400) {
    throw new Error('reference parity requires 400 ablation and 400 primary IntentLock rows');
  }
  for (const primary of primaryIntentLock) {
    const ablation = reference.get(primary.record.caseId);
    if (!ablation || ablation.scenarioSha256 !== primary.scenarioSha256) {
      throw new Error(`ablation reference provenance mismatch for ${primary.record.caseId}`);
    }
    for (const field of PRIMARY_REFERENCE_FIELDS) {
      if (ablation.record[field] !== primary.record[field]) {
        throw new Error(
          `ablation reference differs from primary at ${primary.record.caseId}:${field}`,
        );
      }
    }
    if (
      ablation.firstDetectionStage !== primary.firstDetectionStage ||
      ablation.firstDetectionOrdinal !== primary.firstDetectionOrdinal ||
      ablation.postStateMonitorDecision !== primary.postStateMonitorDecision
    ) {
      throw new Error(`ablation reference detection semantics differ for ${primary.record.caseId}`);
    }
  }
}

export function analyzeAblationResults(
  resultsInput: readonly AblationResult[],
  options: { bootstrapReplicates?: number } = {},
): AblationAnalysis {
  const results = z.array(AblationResultSchema).parse(resultsInput);
  if (results.length !== 3_200) throw new Error('ablation analysis requires 3,200 records');
  const runIds = new Set(results.map((result) => result.runId));
  if (runIds.size !== 1) throw new Error('ablation analysis cannot mix run IDs');
  const runId = [...runIds][0];
  if (!runId) throw new Error('ablation run ID is missing');
  // Re-run the same corpus-shape and provenance checks used for JSONL input. Callers that already
  // parsed an in-memory array must not be able to bypass the frozen-case pairing invariants.
  parseAblationRawResults(
    results
      .map((value, sequence) =>
        JSON.stringify({
          schemaVersion: '0.1',
          sequence,
          recordedAt: '2026-01-01T00:00:00.000Z',
          value,
        }),
      )
      .join('\n'),
    runId,
  );
  const replicates = options.bootstrapReplicates ?? 10_000;
  const referenceRecords = results
    .filter((result) => result.arm === 'INTENTLOCK_FULL')
    .map((result) => result.result.record);
  if (referenceRecords.length !== 400) throw new Error('ablation reference is incomplete');

  const rows = ABLATION_ARMS.map((arm, armIndex): AblationAnalysisRow => {
    const armResults = results.filter((result) => result.arm === arm);
    if (armResults.length !== 400) throw new Error(`${arm} analysis row is incomplete`);
    const records = armResults.map((result) => result.result.record);
    const [aggregate] = aggregateEvaluationRecords(records);
    if (!aggregate) throw new Error(`${arm} aggregate is missing`);
    const metadata = ARM_METADATA[arm];
    const causal = metadata.kind === 'ONE_FACTOR_ABLATION';
    return {
      arm,
      interpretationClass: ABLATION_INTERPRETATION_CLASSES[arm],
      changedFactor: metadata.changedFactor,
      causalAblation: causal,
      nonCausalReason: metadata.nonCausalReason,
      records: records.length,
      aggregate,
      unsafeAuthorizationRate95: groupedStratifiedBootstrap(records, unsafeExecutionCount, {
        replicates,
        seed: 3026 + armIndex * 4,
      }),
      benignCompletionRate95: groupedStratifiedBootstrap(records, benignCompletionCount, {
        replicates,
        seed: 3027 + armIndex * 4,
      }),
      pairedUnsafeRateDifferenceFromReference95: causal
        ? groupedStratifiedPairedBootstrap(records, referenceRecords, unsafeExecutionCount, {
            replicates,
            seed: 3028 + armIndex * 4,
          })
        : null,
      pairedBenignCompletionDifferenceFromReference95: causal
        ? groupedStratifiedPairedBootstrap(records, referenceRecords, benignCompletionCount, {
            replicates,
            seed: 3029 + armIndex * 4,
          })
        : null,
    };
  });

  return {
    runId,
    evidenceMode: 'OFFLINE_COUNTERFACTUAL_REPLAY',
    recordCount: 3_200,
    design: {
      referenceArm: 'INTENTLOCK_FULL',
      nonCausalStageComparisons: ['SEMANTIC_ONLY', 'SYMBOLIC_ONLY', 'HYBRID_CONJUNCTION'],
      oneFactorCausalAblations: ['STATELESS_LEDGER', 'SHALLOW_DECODER', 'NO_POST_STATE_VERIFIER'],
      nonCausalPolicyVariants: ['CONFIRMATION_ALWAYS'],
    },
    rows,
  };
}

/** Ensures the runner-authored summary is a faithful index of the append-only raw artifact. */
export function assertAblationSummaryMatchesRaw(
  summaryInput: unknown,
  resultsInput: readonly AblationResult[],
): void {
  const summary = AblationRunnerSummarySchema.parse(summaryInput);
  const results = z.array(AblationResultSchema).length(3_200).parse(resultsInput);
  if (results.some((result) => result.runId !== summary.runId)) {
    throw new Error('ablation summary and raw results use different run IDs');
  }
  for (const [armIndex, arm] of ABLATION_ARMS.entries()) {
    const row = summary.summary[armIndex];
    if (!row || row.arm !== arm)
      throw new Error('ablation summary arm order differs from protocol');
    const armResults = results.filter((result) => result.arm === arm);
    const records = armResults.map((result) => result.result.record);
    const [aggregate] = aggregateEvaluationRecords(records);
    if (!aggregate) throw new Error(`${arm} aggregate is missing`);
    const metadata = ARM_METADATA[arm];
    const postStateDetections = armResults.filter(
      (result) => result.result.firstDetectionStage === 'POST_STATE',
    ).length;
    const detectionOrdinals = {
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
    };
    const provenanceSources = {
      FRESH_SCENARIO_EVALUATION: armResults.filter(
        (result) => result.provenance.source === 'FRESH_SCENARIO_EVALUATION',
      ).length,
      PRIMARY_LLM_REFERENCE: armResults.filter(
        (result) => result.provenance.source === 'PRIMARY_LLM_REFERENCE',
      ).length,
      FRESH_PLUS_PRIMARY_LLM: armResults.filter(
        (result) => result.provenance.source === 'FRESH_PLUS_PRIMARY_LLM',
      ).length,
    };
    if (
      row.kind !== metadata.kind ||
      row.causalAblation !== metadata.causalAblation ||
      row.changedFactor !== metadata.changedFactor ||
      row.nonCausalReason !== metadata.nonCausalReason ||
      JSON.stringify(row.configuration) !== JSON.stringify(metadata.configuration) ||
      JSON.stringify(row.aggregate) !== JSON.stringify(aggregate) ||
      JSON.stringify(row.detectionOrdinals) !== JSON.stringify(detectionOrdinals) ||
      JSON.stringify(row.provenanceSources) !== JSON.stringify(provenanceSources) ||
      row.postStateDetections !== postStateDetections ||
      row.unsafeExecutionRate95.point !== aggregate.unsafeExecutionRate ||
      row.benignCompletionRate95.point !== aggregate.benignCompletionRate ||
      row.unsafeExecutionRate95.seed !== 2026 + armIndex * 2 ||
      row.benignCompletionRate95.seed !== 2027 + armIndex * 2 ||
      row.unsafeExecutionRate95.groupCount !==
        new Set(records.map((record) => record.baseScenarioId)).size ||
      row.benignCompletionRate95.groupCount !==
        new Set(records.map((record) => record.baseScenarioId)).size
    ) {
      throw new Error(`${arm} summary does not match its raw records`);
    }
  }
}

export interface AdaptiveDescriptiveAnalysis {
  runId: string;
  design: 'NON_PAIRED_NON_CAUSAL';
  claimScope: 'OFFLINE_SCRIPTED_SIGNER_BOUNDARY_ONLY';
  attackerMode: 'DETERMINISTIC_SCRIPTED_NO_MODEL';
  postStateObservation: 'NOT_OBSERVED';
  interpretation: string;
  evidenceLimits: AdaptiveComparisonDocument['evidenceLimits'];
  staticPrimaryDescriptive: {
    evidenceMode: 'OFFLINE_COUNTERFACTUAL_REPLAY';
    rows: 40;
    preSignDecisions: Record<'ALLOW' | 'DENY' | 'ABSTAIN', number>;
  };
  adaptiveSignerBoundaryDescriptive: {
    evidenceMode: 'OFFLINE_SCRIPTED_SIGNER_BOUNDARY_FAKE_EXECUTOR';
    episodes: 40;
    attemptedPlans: number;
    signerInvocations: number;
    outcomes: Record<'ATTACK_SUCCESS' | 'SAFE_BLOCK' | 'NORMAL_FAILURE' | 'INCONCLUSIVE', number>;
    outcomesByFamily: Record<string, Record<string, number>>;
  };
}

export function parseAdaptiveEpisodes(source: string): AdaptiveEpisodeResult[] {
  const episodes = parseJsonLines(source, 'adaptive episode artifact').map((value) =>
    AdaptiveEpisodeResultSchema.parse(value),
  );
  if (
    episodes.length !== 40 ||
    new Set(episodes.map((episode) => episode.episodeId)).size !== 40 ||
    new Set(episodes.map((episode) => episode.baseScenarioId)).size !== 40
  ) {
    throw new Error('adaptive artifact must contain 40 unique episodes and base scenarios');
  }
  const familyCounts = new Map<string, number>();
  for (const episode of episodes) {
    familyCounts.set(episode.family, (familyCounts.get(episode.family) ?? 0) + 1);
  }
  if (
    familyCounts.size !== 5 ||
    [...familyCounts.values()].some((episodeCount) => episodeCount !== 8)
  ) {
    throw new Error(
      'adaptive artifact must contain exactly five families with eight episodes each',
    );
  }
  return episodes;
}

function countValues<T extends string>(
  values: readonly T[],
  universe: readonly T[],
): Record<T, number> {
  return Object.fromEntries(
    universe.map((value) => [value, values.filter((candidate) => candidate === value).length]),
  ) as Record<T, number>;
}

export function analyzeAdaptiveResults(
  runId: string,
  episodesInput: readonly AdaptiveEpisodeResult[],
  comparisonInput: unknown,
): AdaptiveDescriptiveAnalysis {
  const episodes = z.array(AdaptiveEpisodeResultSchema).length(40).parse(episodesInput);
  const comparison = AdaptiveComparisonDocumentSchema.parse(comparisonInput);
  if (comparison.runId !== runId) throw new Error('adaptive comparison belongs to a different run');
  for (const [index, episode] of episodes.entries()) {
    const row = comparison.rows[index];
    if (
      !row ||
      row.baseScenarioId !== episode.baseScenarioId ||
      row.family !== episode.family ||
      row.attackType !== episode.attackType ||
      row.seed !== episode.seed ||
      row.frozenStaticIntentLock.record.baseScenarioId !== row.baseScenarioId ||
      row.frozenStaticIntentLock.record.caseId !== row.frozenStaticIntentLock.caseId ||
      row.adaptiveSignerBoundary.episodeId !== episode.episodeId ||
      row.adaptiveSignerBoundary.outcome !== episode.outcome ||
      row.adaptiveSignerBoundary.attemptedPlans !== episode.attemptedPlans ||
      row.adaptiveSignerBoundary.signerInvocations !== episode.signerInvocations ||
      row.adaptiveSignerBoundary.structuralVerdict !== (episode.classification?.verdict ?? null)
    ) {
      throw new Error(`adaptive comparison row ${String(index + 1)} is not bound to its episode`);
    }
  }

  const families = [...new Set(episodes.map((episode) => episode.family))].sort();
  const outcomeUniverse = [
    'ATTACK_SUCCESS',
    'SAFE_BLOCK',
    'NORMAL_FAILURE',
    'INCONCLUSIVE',
  ] as const;
  return {
    runId,
    design: ADAPTIVE_COMPARISON_DESIGN,
    claimScope: 'OFFLINE_SCRIPTED_SIGNER_BOUNDARY_ONLY',
    attackerMode: 'DETERMINISTIC_SCRIPTED_NO_MODEL',
    postStateObservation: 'NOT_OBSERVED',
    interpretation:
      'Descriptive contrast only. Static primary rows and adaptive episodes are neither paired nor equivalent cases; no causal effect or cross-environment rate difference is estimated.',
    evidenceLimits: comparison.evidenceLimits,
    staticPrimaryDescriptive: {
      evidenceMode: 'OFFLINE_COUNTERFACTUAL_REPLAY',
      rows: 40,
      preSignDecisions: countValues(
        comparison.rows.map((row) => row.frozenStaticIntentLock.record.preSignDecision),
        ['ALLOW', 'DENY', 'ABSTAIN'],
      ),
    },
    adaptiveSignerBoundaryDescriptive: {
      evidenceMode: 'OFFLINE_SCRIPTED_SIGNER_BOUNDARY_FAKE_EXECUTOR',
      episodes: 40,
      attemptedPlans: episodes.reduce((sum, episode) => sum + episode.attemptedPlans, 0),
      signerInvocations: episodes.reduce((sum, episode) => sum + episode.signerInvocations, 0),
      outcomes: countValues(
        episodes.map((episode) => episode.outcome),
        outcomeUniverse,
      ),
      outcomesByFamily: Object.fromEntries(
        families.map((family) => [
          family,
          countValues(
            episodes
              .filter((episode) => episode.family === family)
              .map((episode) => episode.outcome),
            outcomeUniverse,
          ),
        ]),
      ),
    },
  };
}

/** Validates the runner summary without turning the adaptive/static contrast into a rate estimate. */
export function assertAdaptiveSummaryMatchesRaw(
  summaryInput: unknown,
  runId: string,
  episodesInput: readonly AdaptiveEpisodeResult[],
  comparisonInput: unknown,
): void {
  const episodes = z.array(AdaptiveEpisodeResultSchema).length(40).parse(episodesInput);
  const comparison = AdaptiveComparisonDocumentSchema.parse(comparisonInput);
  const outcomes = countValues(
    episodes.map((episode) => episode.outcome),
    ['ATTACK_SUCCESS', 'SAFE_BLOCK', 'NORMAL_FAILURE', 'INCONCLUSIVE'],
  );
  const expected = {
    schemaVersion: '0.1',
    runId,
    claimScope: 'OFFLINE_SCRIPTED_SIGNER_BOUNDARY_ONLY',
    attackerMode: 'DETERMINISTIC_SCRIPTED_NO_MODEL',
    postStateObservation: 'NOT_OBSERVED',
    episodeCount: 40,
    attemptedPlans: episodes.reduce((sum, episode) => sum + episode.attemptedPlans, 0),
    signerInvocations: episodes.reduce((sum, episode) => sum + episode.signerInvocations, 0),
    outcomes,
    comparison: {
      design: 'NON_PAIRED_NON_CAUSAL',
      rows: comparison.rows.length,
      equivalentCaseClaim: false,
      causalComparison: false,
      modelAdaptiveEvidence: false,
      forkExecutionEvidence: false,
    },
  } as const;
  if (comparison.runId !== runId || JSON.stringify(summaryInput) !== JSON.stringify(expected)) {
    throw new Error('adaptive summary does not exactly match the validated raw episodes');
  }
}
