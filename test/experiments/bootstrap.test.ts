import { describe, expect, it } from 'vitest';

import {
  benignCompletionCount,
  groupedStratifiedBootstrap,
  groupedStratifiedPairedBootstrap,
  unsafeExecutionCount,
} from '../../src/experiments/bootstrap.js';
import { EvaluationRecordSchema, type EvaluationRecord } from '../../src/experiments/metrics.js';

function record(
  baseScenarioId: string,
  caseId: string,
  overrides: Partial<EvaluationRecord> = {},
): EvaluationRecord {
  return EvaluationRecordSchema.parse({
    runId: 'run-1',
    caseId,
    baseScenarioId,
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
    latencyMs: 10,
    ...overrides,
  });
}

describe('grouped stratified bootstrap', () => {
  const rows = [
    record('TR-01', 'TR-01-B'),
    record('TR-01', 'TR-01-A', {
      class: 'ADVERSARIAL',
      postStateStatus: 'VIOLATION',
      counterfactualBenignCompletion: false,
    }),
    record('TR-02', 'TR-02-B'),
    record('TR-02', 'TR-02-A', {
      class: 'ADVERSARIAL',
      preSignDecision: 'DENY',
      firstDetectionOrdinal: 1,
      executionStatus: 'NOT_ATTEMPTED',
      postStateStatus: 'NOT_OBSERVED',
      postStateEvidence: 'NONE',
      counterfactualEconomicEffectIssued: false,
      counterfactualBenignCompletion: false,
    }),
  ];

  it('is deterministic and reports base groups instead of treating variants as independent', () => {
    const first = groupedStratifiedBootstrap(rows, unsafeExecutionCount, {
      replicates: 500,
      seed: 2026,
    });
    const second = groupedStratifiedBootstrap(rows, unsafeExecutionCount, {
      replicates: 500,
      seed: 2026,
    });
    expect(first).toEqual(second);
    expect(first).toMatchObject({ point: 0.25, replicates: 500, seed: 2026, groupCount: 2 });
    expect(first.lower95).toBeLessThanOrEqual(first.point);
    expect(first.upper95).toBeGreaterThanOrEqual(first.point);
  });

  it('computes benign completion on benign cases only', () => {
    const result = groupedStratifiedBootstrap(rows, benignCompletionCount, {
      replicates: 200,
    });
    expect(result.point).toBe(1);
  });

  it('resamples matched base groups for a paired system difference', () => {
    const baseline = rows.map((row) =>
      row.class === 'ADVERSARIAL'
        ? record(row.baseScenarioId, row.caseId, {
            system: 'NONE',
            class: 'ADVERSARIAL',
            preSignDecision: 'ALLOW',
            executionStatus: 'REPLAYED',
            postStateStatus: 'VIOLATION',
            postStateEvidence: 'AUTHORED_ORACLE_FIXTURE',
            counterfactualEconomicEffectIssued: true,
            counterfactualBenignCompletion: false,
          })
        : record(row.baseScenarioId, row.caseId, { system: 'NONE' }),
    );
    const interval = groupedStratifiedPairedBootstrap(rows, baseline, unsafeExecutionCount, {
      replicates: 200,
      seed: 2030,
    });
    expect(interval).toMatchObject({ point: -0.25, replicates: 200, groupCount: 2 });
  });

  it('rejects invalid bootstrap configuration', () => {
    expect(() =>
      groupedStratifiedBootstrap(rows, unsafeExecutionCount, { replicates: 99 }),
    ).toThrow('at least 100');
  });
});
