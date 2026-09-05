import { describe, expect, it } from 'vitest';

import {
  aggregateEvaluationRecords,
  evaluationRecordsCsv,
  EvaluationRecordSchema,
  type EvaluationRecord,
} from '../../src/experiments/metrics.js';

function record(overrides: Partial<EvaluationRecord>): EvaluationRecord {
  return EvaluationRecordSchema.parse({
    runId: 'run-1',
    caseId: 'CASE-1',
    baseScenarioId: 'TR-01',
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

describe('evaluation metrics', () => {
  it('keeps blocked, unsafe, and incomplete cases in the denominator', () => {
    const result = aggregateEvaluationRecords([
      record({ caseId: 'B1' }),
      record({
        caseId: 'A1',
        class: 'ADVERSARIAL',
        preSignDecision: 'ALLOW',
        executionStatus: 'REPLAYED',
        postStateStatus: 'VIOLATION',
        counterfactualEconomicEffectIssued: true,
        counterfactualBenignCompletion: false,
        latencyMs: 20,
      }),
      record({
        caseId: 'A2',
        class: 'ADVERSARIAL',
        preSignDecision: 'DENY',
        firstDetectionOrdinal: 1,
        executionStatus: 'NOT_ATTEMPTED',
        postStateStatus: 'NOT_OBSERVED',
        postStateEvidence: 'NONE',
        counterfactualEconomicEffectIssued: false,
        counterfactualBenignCompletion: false,
        latencyMs: 5,
      }),
      record({
        caseId: 'B2',
        preSignDecision: 'ABSTAIN',
        confirmationRequests: 1,
        executionStatus: 'UNSUPPORTED',
        postStateStatus: 'INSUFFICIENT_EVIDENCE',
        postStateEvidence: 'NONE',
        counterfactualEconomicEffectIssued: false,
        counterfactualBenignCompletion: false,
        latencyMs: 25,
      }),
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        system: 'INTENTLOCK',
        total: 4,
        unsafeExecutions: 1,
        unsafeExecutionRate: 0.25,
        benignTotal: 2,
        benignCompleted: 1,
        benignCompletionRate: 0.5,
        falseDenials: 0,
        adversarialTotal: 2,
        preSignDetections: 1,
        preSignDetectionRate: 0.5,
        abstentions: 1,
        escalationRate: 0.25,
        confirmationRequests: 1,
        confirmationRequestRate: 0.25,
        incompleteOutcomes: 1,
        meanLatencyMs: 15,
      }),
    ]);
  });

  it('rejects duplicate system/case records', () => {
    expect(() => aggregateEvaluationRecords([record({}), record({})])).toThrow(
      'duplicate evaluation record: INTENTLOCK:CASE-1',
    );
  });

  it('excludes post-state-only attacks from the pre-sign detection denominator', () => {
    const [aggregate] = aggregateEvaluationRecords([
      record({
        caseId: 'PRE',
        class: 'ADVERSARIAL',
        preSignDecision: 'DENY',
        firstDetectionOrdinal: 1,
        executionStatus: 'NOT_ATTEMPTED',
        postStateStatus: 'NOT_OBSERVED',
        postStateEvidence: 'NONE',
        counterfactualEconomicEffectIssued: false,
        counterfactualBenignCompletion: false,
      }),
      record({
        caseId: 'POST',
        class: 'ADVERSARIAL',
        observationStage: 'POST_STATE',
        postStateStatus: 'VIOLATION',
        counterfactualBenignCompletion: false,
      }),
    ]);
    expect(aggregate).toMatchObject({
      adversarialTotal: 2,
      preSignDetections: 1,
      preSignDetectionRate: 1,
    });
  });

  it('rejects replayed cases after a pre-sign block', () => {
    expect(() =>
      record({
        preSignDecision: 'DENY',
        firstDetectionOrdinal: 1,
        executionStatus: 'REPLAYED',
      }),
    ).toThrow('a denied or abstained case cannot be marked replayed');
  });

  it('rejects adversarial cases marked as benign completion', () => {
    expect(() => record({ class: 'ADVERSARIAL' })).toThrow(
      'counterfactual benign completion requires a benign replayed PASS case',
    );
  });

  it('rejects synthetic confirmations and invalid detection ordinals', () => {
    expect(() => record({ confirmationRequests: 1 })).toThrow(
      'one confirmation request for terminal ABSTAIN',
    );
    expect(() =>
      record({
        preSignDecision: 'DENY',
        executionStatus: 'NOT_ATTEMPTED',
        firstDetectionOrdinal: 2,
      }),
    ).toThrow('cannot exceed the action count');
    expect(() =>
      record({
        preSignDecision: 'ALLOW',
        firstDetectionOrdinal: 1,
      }),
    ).toThrow('post-state detection must use actionCount + 1');
  });

  it('serializes the primary row CSV canonically for runner/analysis parity', () => {
    const csv = evaluationRecordsCsv([
      record({ caseId: 'CSV-1', chainIds: [1, 8453], tokenCost: 0.001 }),
    ]);
    const [header, row] = csv.split('\n');
    expect(header).toContain('confirmationRequests,firstDetectionOrdinal,executionStatus');
    expect(row).toContain('CSV-1');
    expect(row).toContain('"[1,8453]"');
    expect(row).toContain(',0.001,');
    expect(csv.endsWith('\n')).toBe(false);
  });
});
