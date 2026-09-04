import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { BenchmarkScenarioSchema } from '../../src/benchmark/scenario.js';
import type { EvaluationAttempt } from '../../src/experiments/run-artifacts.js';
import {
  assertPrimaryArtifactsTrackedAtHead,
  assertPrimaryEvaluationMatrixBinding,
  isOperationalRetryEligible,
  nextAttemptNumber,
  selectEvaluationAttempts,
  summarizeEvaluationAttempts,
} from '../../src/experiments/run-artifacts.js';

const scenario = BenchmarkScenarioSchema.parse(
  JSON.parse(readFileSync('benchmark/scenarios/base/transfer/tr-01.json', 'utf8')),
);

function attempt(
  number: number,
  executionStatus: 'FAILED' | 'TIMEOUT' | 'REPLAYED',
): EvaluationAttempt {
  const operationalFailure = executionStatus === 'FAILED' || executionStatus === 'TIMEOUT';
  return {
    schemaVersion: '0.1',
    attempt: number,
    startedAt: `2026-09-04T00:00:0${String(number)}.000Z`,
    completedAt: `2026-09-04T00:00:0${String(number)}.500Z`,
    result: {
      record: {
        runId: 'run-01',
        caseId: 'TR-01--BENIGN_ORIGINAL',
        baseScenarioId: 'TR-01',
        system: 'NONE',
        workflow: 'TRANSFER',
        class: 'BASE',
        split: 'TRAIN',
        chainIds: [1],
        actionCount: 1,
        observationStage: 'PRE_SIGN',
        oracleEvidenceLevel: 'EXPECTED_FIXTURE',
        mutationValidity: null,
        evaluationMode: 'OFFLINE_COUNTERFACTUAL_REPLAY',
        preSignDecision: operationalFailure ? 'ABSTAIN' : 'ALLOW',
        confirmationRequests: operationalFailure ? 1 : 0,
        firstDetectionOrdinal: null,
        executionStatus,
        postStateStatus: operationalFailure ? 'INSUFFICIENT_EVIDENCE' : 'PASS',
        postStateEvidence: operationalFailure ? 'NONE' : 'AUTHORED_ORACLE_FIXTURE',
        counterfactualEconomicEffectIssued: executionStatus === 'REPLAYED',
        counterfactualBenignCompletion: executionStatus === 'REPLAYED',
        latencyMs: 1,
        ...(operationalFailure ? { failureClass: 'Error' } : {}),
      },
      variant: 'BENIGN_ORIGINAL',
      mutationOperator: null,
      oracleExpectedDecision: 'ALLOW',
      oracleViolationAmount: '0',
      oracleAllowanceExposure: '0',
      scenarioSha256: 'a'.repeat(64),
      postStateMonitorDecision: 'NOT_EVALUATED',
      firstDetectionStage: 'NONE',
      firstDetectionOrdinal: null,
      verdict: {
        decision: operationalFailure ? 'ABSTAIN' : 'ALLOW',
        rationale: 'test result',
        reasonCodes: operationalFailure ? ['EVALUATION_FAILURE'] : [],
        attempts: 1,
      },
    },
  };
}

describe('immutable evaluation attempts', () => {
  it('allows operational sensitivity retries for failures and timeouts only', () => {
    expect(isOperationalRetryEligible('FAILED')).toBe(true);
    expect(isOperationalRetryEligible('TIMEOUT')).toBe(true);
    expect(isOperationalRetryEligible('UNSUPPORTED')).toBe(false);
    expect(isOperationalRetryEligible('REPLAYED')).toBe(false);
    expect(isOperationalRetryEligible('NOT_ATTEMPTED')).toBe(false);
  });

  it('keeps attempt one as the intention-to-treat primary record', () => {
    const attempts = [attempt(1, 'FAILED'), attempt(2, 'REPLAYED')];
    expect(
      selectEvaluationAttempts(attempts, {
        maxAttemptsPerCase: 2,
        maxTotalRetryAttempts: 2,
      }),
    ).toEqual([attempts[0]]);
    expect(nextAttemptNumber(attempts, 'NONE', 'TR-01--BENIGN_ORIGINAL')).toBe(3);
  });

  it('keeps the first failure when no retry succeeds', () => {
    const attempts = [attempt(1, 'FAILED'), attempt(2, 'FAILED')];
    expect(
      selectEvaluationAttempts(attempts, {
        maxAttemptsPerCase: 2,
        maxTotalRetryAttempts: 2,
      }),
    ).toEqual([attempts[0]]);
  });

  it('keeps a timeout as primary while reporting a successful retry as recovery only', () => {
    const attempts = [attempt(1, 'TIMEOUT'), attempt(2, 'REPLAYED')];
    expect(
      selectEvaluationAttempts(attempts, {
        maxAttemptsPerCase: 2,
        maxTotalRetryAttempts: 1,
      }),
    ).toEqual([attempts[0]]);
    expect(
      summarizeEvaluationAttempts(attempts, {
        maxAttemptsPerCase: 2,
        maxTotalRetryAttempts: 1,
      }),
    ).toMatchObject({
      timedOutAttempts: 1,
      primaryAttemptFailures: 1,
      operationalRecoverySuccesses: 1,
    });
  });

  it('enforces the frozen attempt cap and preserves failed-attempt provenance', () => {
    const recovered = [attempt(1, 'FAILED'), attempt(2, 'REPLAYED')];
    expect(
      summarizeEvaluationAttempts(recovered, {
        maxAttemptsPerCase: 2,
        maxTotalRetryAttempts: 1,
      }),
    ).toMatchObject({
      selectionPolicy: 'attempt-1-intention-to-treat-retries-operational-sensitivity-only',
      rawAttempts: 2,
      selectedRecords: 1,
      retryAttempts: 1,
      failedAttempts: 1,
      casesWithRetries: 1,
      primaryAttemptFailures: 1,
      operationalRecoverySuccesses: 1,
      maxAttemptsObserved: 2,
      maxAttemptsPerCase: 2,
      maxTotalRetryAttempts: 1,
    });
    expect(() =>
      selectEvaluationAttempts([...recovered, attempt(3, 'REPLAYED')], {
        maxAttemptsPerCase: 2,
        maxTotalRetryAttempts: 2,
      }),
    ).toThrow('attempt count exceeds frozen cap');
    expect(() =>
      selectEvaluationAttempts(recovered, {
        maxAttemptsPerCase: 2,
        maxTotalRetryAttempts: 0,
      }),
    ).toThrow('total retry attempts exceed frozen cap');
  });

  it('rejects ignored or otherwise untracked primary artifacts before downstream use', () => {
    expect(() => {
      assertPrimaryArtifactsTrackedAtHead('run-01', (path) => !path.endsWith('/raw.jsonl'));
    }).toThrow('primary result artifact must be committed before downstream use');
    expect(() => {
      assertPrimaryArtifactsTrackedAtHead('run-01', () => true);
    }).not.toThrow();
  });

  it('binds every selected row to run ID and full frozen case metadata', () => {
    const selected = attempt(1, 'REPLAYED');
    const entry = {
      caseId: 'TR-01--BENIGN_ORIGINAL',
      baseScenarioId: 'TR-01',
      variant: 'BENIGN_ORIGINAL' as const,
      workflow: 'TRANSFER' as const,
      class: 'BASE' as const,
      split: 'TRAIN' as const,
      chainIds: [1],
      observationStage: 'PRE_SIGN' as const,
      oracleEvidenceLevel: 'EXPECTED_FIXTURE' as const,
      mutationValidity: null,
      mutationOperator: null,
      seed: null,
      scenarioSha256: 'a'.repeat(64),
    };
    expect(() => {
      assertPrimaryEvaluationMatrixBinding({
        attempts: [selected],
        primaryRunId: 'run-01',
        entries: [entry],
        scenarios: [scenario],
        systems: ['NONE'],
      });
    }).not.toThrow();

    const mismatched = structuredClone(selected);
    mismatched.result.record.runId = 'other-run';
    expect(() => {
      assertPrimaryEvaluationMatrixBinding({
        attempts: [mismatched],
        primaryRunId: 'run-01',
        entries: [entry],
        scenarios: [scenario],
        systems: ['NONE'],
      });
    }).toThrow('does not match the frozen case matrix');
  });
});
