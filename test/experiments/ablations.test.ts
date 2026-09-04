import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { applyMutation } from '../../src/benchmark/mutations/index.js';
import { BenchmarkScenarioSchema, type BenchmarkScenario } from '../../src/benchmark/scenario.js';
import {
  ABLATION_ARMS,
  AblationManifestSchema,
  AblationResultSchema,
  AblationRunManifestSchema,
  ReadyAblationManifestSchema,
  ablationConfiguration,
  configurationDiff,
  evaluateAblationCase,
  validateOneFactorConfigurations,
  type AblationArm,
} from '../../src/experiments/ablations.js';
import {
  createEvaluationCaseMatrix,
  type EvaluationCaseManifestEntry,
  type EvaluationVariant,
} from '../../src/experiments/case-matrix.js';
import { MutationOperatorIdSchema } from '../../src/experiments/case-manifest.js';
import { evaluateCase, type RawEvaluationResult } from '../../src/experiments/evaluate-case.js';
import { sha256Text } from '../../src/experiments/protocol.js';

const CASE_MANIFEST_SHA256 = 'a'.repeat(64);
const EVALUATED_AT = '2026-08-30T00:00:00Z';

function scenario(path: string): BenchmarkScenario {
  return BenchmarkScenarioSchema.parse(
    JSON.parse(readFileSync(resolve(import.meta.dirname, `../../${path}`), 'utf8')),
  );
}

const transfer = scenario('benchmark/scenarios/base/transfer/tr-01.json');
const nestedBatch = scenario('benchmark/scenarios/base/batch/ba-01.json');
const zeroApprovalRevoke = scenario('benchmark/scenarios/base/batch/ba-02.json');

function entryFor(
  value: BenchmarkScenario,
  variant: EvaluationVariant = 'BENIGN_ORIGINAL',
  baseScenarioId = value.id,
): EvaluationCaseManifestEntry {
  return {
    caseId: `${baseScenarioId}--${variant}`,
    baseScenarioId,
    variant,
    workflow: value.workflow,
    class: value.class,
    split: value.split,
    chainIds: [
      ...new Set([
        ...value.trace.actions.map((action) => action.chainId),
        ...(value.fixture?.chains.map((chain) => chain.chainId) ?? []),
      ]),
    ].sort((left, right) => left - right),
    observationStage: value.oracle.observationStage,
    oracleEvidenceLevel: value.oracle.evidenceLevel,
    mutationValidity: value.mutation?.validity ?? null,
    mutationOperator:
      value.provenance.mutationOperator === undefined
        ? null
        : MutationOperatorIdSchema.parse(value.provenance.mutationOperator),
    seed: value.provenance.seed ?? null,
    scenarioSha256: sha256Text(JSON.stringify(value)),
  };
}

function primaryLlm(
  value: BenchmarkScenario,
  entry: EvaluationCaseManifestEntry,
  decision: 'ALLOW' | 'DENY' | 'ABSTAIN' = 'ALLOW',
): RawEvaluationResult {
  const allowed = decision === 'ALLOW';
  const invalidCalldata = value.mutation?.validity === 'INVALID_CALLDATA';
  const replayed = allowed && !invalidCalldata;
  const postStateStatus = replayed
    ? value.oracle.expectedDecision === 'ALLOW'
      ? 'PASS'
      : value.oracle.expectedDecision === 'DENY'
        ? 'VIOLATION'
        : 'INSUFFICIENT_EVIDENCE'
    : allowed
      ? 'INSUFFICIENT_EVIDENCE'
      : 'NOT_OBSERVED';
  return {
    record: {
      runId: 'primary-run',
      caseId: entry.caseId,
      baseScenarioId: entry.baseScenarioId,
      system: 'LLM_VERIFIER',
      workflow: value.workflow,
      class: value.class,
      split: value.split,
      chainIds: entry.chainIds,
      actionCount: value.trace.actions.length,
      observationStage: value.oracle.observationStage,
      oracleEvidenceLevel: entry.oracleEvidenceLevel,
      mutationValidity: entry.mutationValidity,
      evaluationMode: 'OFFLINE_COUNTERFACTUAL_REPLAY',
      preSignDecision: decision,
      confirmationRequests: decision === 'ABSTAIN' ? 1 : 0,
      firstDetectionOrdinal: decision === 'ALLOW' ? null : 0,
      executionStatus: allowed ? (invalidCalldata ? 'UNSUPPORTED' : 'REPLAYED') : 'NOT_ATTEMPTED',
      postStateStatus,
      postStateEvidence:
        postStateStatus === 'PASS' || postStateStatus === 'VIOLATION'
          ? 'AUTHORED_ORACLE_FIXTURE'
          : 'NONE',
      counterfactualEconomicEffectIssued:
        replayed &&
        value.trace.expectedEffects.some(
          (effect) => effect.kind !== 'UNKNOWN' && effect.kind !== 'GAS',
        ),
      counterfactualBenignCompletion:
        replayed && value.class !== 'ADVERSARIAL' && postStateStatus === 'PASS',
      latencyMs: 1,
      ...(invalidCalldata && allowed ? { failureClass: 'INVALID_CALLDATA' } : {}),
    },
    variant: entry.variant,
    mutationOperator: entry.mutationOperator,
    oracleExpectedDecision: value.oracle.expectedDecision,
    oracleViolationAmount: value.oracle.violationAmount ?? '0',
    oracleAllowanceExposure: value.oracle.allowanceExposure ?? '0',
    scenarioSha256: entry.scenarioSha256,
    postStateMonitorDecision: 'NOT_EVALUATED',
    firstDetectionStage: decision === 'ALLOW' ? 'NONE' : 'PRE_SIGN',
    firstDetectionOrdinal: decision === 'ALLOW' ? null : 0,
    verdict: {
      decision,
      rationale: 'Frozen primary LLM test result.',
      reasonCodes: decision === 'ALLOW' ? [] : ['TEST_PRIMARY_DECISION'],
      attempts: 1,
    },
  };
}

function evaluate(
  arm: AblationArm,
  value = transfer,
  entry = entryFor(value),
  semanticDecision: 'ALLOW' | 'DENY' | 'ABSTAIN' = 'ALLOW',
) {
  return evaluateAblationCase({
    runId: 'ablation-run',
    arm,
    scenario: value,
    entry,
    evaluatedAt: EVALUATED_AT,
    caseManifestSha256: CASE_MANIFEST_SHA256,
    primaryRunId: 'primary-run',
    primaryLlmResult: primaryLlm(value, entry, semanticDecision),
  });
}

function allBases(): BenchmarkScenario[] {
  const root = resolve(import.meta.dirname, '../../benchmark/scenarios/base');
  const values: BenchmarkScenario[] = [];
  for (const directory of readdirSync(root).sort()) {
    const nested = resolve(root, directory);
    if (!statSync(nested).isDirectory()) continue;
    for (const file of readdirSync(nested)
      .filter((name) => name.endsWith('.json'))
      .sort()) {
      values.push(
        BenchmarkScenarioSchema.parse(JSON.parse(readFileSync(resolve(nested, file), 'utf8'))),
      );
    }
  }
  return values;
}

describe('preregistered ablation evaluation', () => {
  it('loads the eight-arm candidate manifest but refuses to treat it as frozen', () => {
    const manifest = AblationManifestSchema.parse(
      JSON.parse(
        readFileSync(
          resolve(import.meta.dirname, '../../experiments/configs/ablations/manifest.json'),
          'utf8',
        ),
      ),
    );
    expect(manifest.arms.map((arm) => arm.id)).toEqual(ABLATION_ARMS);
    expect(manifest.status).toBe('CANDIDATE_UNFROZEN');
    expect(ReadyAblationManifestSchema.safeParse(manifest).success).toBe(false);
  });

  it('records reviewed A, primary freeze B, and descendant ablation C separately', () => {
    const digest = 'a'.repeat(64);
    const value = {
      schemaVersion: '0.2',
      runId: 'ablation-run',
      createdAt: '2026-09-04T00:00:00.000Z',
      gitCommit: 'a'.repeat(40),
      primaryExecutionCommit: 'b'.repeat(40),
      executionCommit: 'c'.repeat(40),
      primaryRunId: 'primary-run',
      primaryRunManifestSha256: digest,
      primaryRawSha256: digest,
      primarySummarySha256: digest,
      primarySummaryCsvSha256: digest,
      primarySelectedResultsSha256: digest,
      frozenEvalSha256: digest,
      ablationManifestSha256: digest,
      caseManifestSha256: digest,
      freezeDigests: {
        dependencyDigestSha256: digest,
        datasetDigestSha256: digest,
        caseManifestDigestSha256: digest,
        promptDigestSha256: digest,
        toolSchemaDigestSha256: digest,
        metricImplementationDigestSha256: digest,
        protocolConfigDigestSha256: digest,
        evaluationConfigDigestSha256: digest,
        implementationDigestSha256: digest,
      },
      rootSeed: 2026,
      caseCount: 400,
      arms: ABLATION_ARMS,
      expectedRecords: 3_200,
      evaluationMode: 'OFFLINE_COUNTERFACTUAL_REPLAY',
      appendOnly: true,
      overwrite: false,
    } as const;
    expect(AblationRunManifestSchema.parse(value)).toMatchObject({
      gitCommit: 'a'.repeat(40),
      primaryExecutionCommit: 'b'.repeat(40),
      executionCommit: 'c'.repeat(40),
    });
    const { primaryExecutionCommit: omitted, ...missingPrimaryFreezeCommit } = value;
    void omitted;
    expect(AblationRunManifestSchema.safeParse(missingPrimaryFreezeCommit).success).toBe(false);
  });

  it('holds every causal ablation to exactly one changed evaluator factor', () => {
    expect(() => {
      validateOneFactorConfigurations();
    }).not.toThrow();
    const full = ablationConfiguration('INTENTLOCK_FULL');
    expect(configurationDiff(full, ablationConfiguration('STATELESS_LEDGER'))).toEqual([
      'acceptedEffectHistory',
    ]);
    expect(configurationDiff(full, ablationConfiguration('SHALLOW_DECODER'))).toEqual([
      'recursiveDecoder',
    ]);
    expect(configurationDiff(full, ablationConfiguration('NO_POST_STATE_VERIFIER'))).toEqual([
      'postStateReconciliation',
    ]);
  });

  it('removes only reconciliation in the no-post-state arm', () => {
    const full = evaluate('INTENTLOCK_FULL');
    const withoutPostState = evaluate('NO_POST_STATE_VERIFIER');
    expect(withoutPostState.result.record.preSignDecision).toBe(full.result.record.preSignDecision);
    expect(full.result).toMatchObject({
      postStateMonitorDecision: 'ALLOW',
      record: { postStateStatus: 'PASS', postStateEvidence: 'AUTHORED_ORACLE_FIXTURE' },
    });
    expect(withoutPostState.result).toMatchObject({
      postStateMonitorDecision: 'NOT_EVALUATED',
      firstDetectionStage: 'NONE',
      firstDetectionOrdinal: null,
      record: {
        firstDetectionOrdinal: null,
        postStateStatus: 'PASS',
        postStateEvidence: 'AUTHORED_ORACLE_FIXTURE',
        counterfactualBenignCompletion: true,
      },
    });
  });

  it('matches the primary IntentLock pre-sign verdict on all 400 frozen cases', async () => {
    const matrix = createEvaluationCaseMatrix(allBases());
    for (const [index, entry] of matrix.entries.entries()) {
      const value = matrix.scenarios[index];
      if (!value) throw new Error(`missing scenario for ${entry.caseId}`);
      const primary = await evaluateCase({
        runId: 'primary-parity-test',
        system: 'INTENTLOCK',
        scenario: value,
        entry,
        evaluatedAt: EVALUATED_AT,
      });
      const full = evaluateAblationCase({
        runId: 'ablation-parity-test',
        arm: 'INTENTLOCK_FULL',
        scenario: value,
        entry,
        evaluatedAt: EVALUATED_AT,
        caseManifestSha256: CASE_MANIFEST_SHA256,
        primaryRunId: 'primary-run',
      });
      expect(primary.record.failureClass, entry.caseId).toBeUndefined();
      expect(full.result.record.preSignDecision, entry.caseId).toBe(primary.record.preSignDecision);
      expect(full.result.record.firstDetectionOrdinal, entry.caseId).toBe(
        primary.record.firstDetectionOrdinal,
      );
    }
  }, 60_000);

  it('safe-abstains on nested effects only when recursive decoding is removed', () => {
    expect(evaluate('INTENTLOCK_FULL', nestedBatch).result.record.preSignDecision).toBe('ALLOW');
    expect(evaluate('SHALLOW_DECODER', nestedBatch).result.record.preSignDecision).toBe('ABSTAIN');
  });

  it('actually re-evaluates composition with and without accepted history', () => {
    const mutated = applyMutation(transfer, 'policy-laundering', 2026);
    const entry = entryFor(mutated, 'ADVERSARIAL_COMPOSITION', transfer.id);
    expect(evaluate('INTENTLOCK_FULL', mutated, entry).result.record.preSignDecision).toBe('DENY');
    expect(evaluate('STATELESS_LEDGER', mutated, entry).result.record.preSignDecision).toBe(
      'ALLOW',
    );
  });

  it('attributes idempotent signer-sequence replay prevention to the stateful ledger', () => {
    const replay = applyMutation(zeroApprovalRevoke, 'retry-double-spend', 2026);
    const entry = entryFor(replay, 'ADVERSARIAL_COMPOSITION', zeroApprovalRevoke.id);
    expect(evaluate('INTENTLOCK_FULL', replay, entry).result).toMatchObject({
      firstDetectionOrdinal: 2,
      verdict: { decision: 'DENY', reasonCodes: ['IDEMPOTENCY_REPLAY'] },
    });
    expect(evaluate('STATELESS_LEDGER', replay, entry).result.record.preSignDecision).toBe('ALLOW');
  });

  it('references the exact primary LLM row only as a non-causal stage comparison', () => {
    const entry = entryFor(transfer);
    const primary = primaryLlm(transfer, entry, 'DENY');
    const result = evaluateAblationCase({
      runId: 'ablation-run',
      arm: 'SEMANTIC_ONLY',
      scenario: transfer,
      entry,
      evaluatedAt: EVALUATED_AT,
      caseManifestSha256: CASE_MANIFEST_SHA256,
      primaryRunId: 'primary-run',
      primaryLlmResult: primary,
    });
    expect(result.result).toEqual(primary);
    expect(result).toMatchObject({
      causalAblation: false,
      provenance: { source: 'PRIMARY_LLM_REFERENCE', primaryRunId: 'primary-run' },
    });
  });

  it('labels hybrid reuse as non-causal fresh-plus-primary provenance', () => {
    expect(evaluate('HYBRID_CONJUNCTION', transfer, entryFor(transfer), 'DENY')).toMatchObject({
      causalAblation: false,
      provenance: { source: 'FRESH_PLUS_PRIMARY_LLM' },
      result: { record: { preSignDecision: 'DENY', executionStatus: 'NOT_ATTEMPTED' } },
    });
  });

  it('keeps always-confirm separate from causal ablations', () => {
    expect(evaluate('CONFIRMATION_ALWAYS')).toMatchObject({
      kind: 'POLICY_VARIANT',
      causalAblation: false,
      result: {
        record: {
          preSignDecision: 'ABSTAIN',
          executionStatus: 'NOT_ATTEMPTED',
          counterfactualEconomicEffectIssued: false,
          counterfactualBenignCompletion: false,
        },
      },
    });
  });

  it('rejects a causal row that claims primary LLM provenance', () => {
    const causal = structuredClone(evaluate('STATELESS_LEDGER'));
    causal.provenance.source = 'PRIMARY_LLM_REFERENCE';
    causal.provenance.primaryRunId = 'primary-run';
    causal.provenance.primaryResultSha256 = 'b'.repeat(64);
    expect(AblationResultSchema.safeParse(causal).success).toBe(false);
  });

  it('rejects a scenario that differs from its frozen case hash', () => {
    const entry = entryFor(transfer);
    entry.scenarioSha256 = '0'.repeat(64);
    expect(() => evaluate('INTENTLOCK_FULL', transfer, entry)).toThrow('scenario hash mismatch');
  });

  it('evaluates the same generated 400-case matrix for every arm', () => {
    const matrix = createEvaluationCaseMatrix(allBases());
    const counts = new Map<AblationArm, number>();
    for (const arm of ABLATION_ARMS) {
      for (const [index, entry] of matrix.entries.entries()) {
        const value = matrix.scenarios[index];
        if (!value) throw new Error(`missing scenario for ${entry.caseId}`);
        evaluateAblationCase({
          runId: 'matrix-test',
          arm,
          scenario: value,
          entry,
          evaluatedAt: EVALUATED_AT,
          caseManifestSha256: CASE_MANIFEST_SHA256,
          primaryRunId: 'primary-run',
          primaryLlmResult: primaryLlm(
            value,
            entry,
            value.oracle.expectedDecision === 'ALLOW' ? 'ALLOW' : 'DENY',
          ),
        });
        counts.set(arm, (counts.get(arm) ?? 0) + 1);
      }
    }
    expect(Object.fromEntries(counts)).toEqual(
      Object.fromEntries(ABLATION_ARMS.map((arm) => [arm, 400])),
    );
  }, 60_000);
});
