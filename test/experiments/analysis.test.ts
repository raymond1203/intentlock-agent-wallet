import { describe, expect, it } from 'vitest';

import type { RawEvaluationResult } from '../../src/experiments/evaluate-case.js';
import { analyzeEvaluationResults } from '../../src/experiments/analysis.js';

function result(
  system: 'NONE' | 'INTENTLOCK',
  caseId: string,
  adversarial: boolean,
  blocked: boolean,
): RawEvaluationResult {
  const unsafe = adversarial && !blocked;
  const [baseScenarioId] = caseId.split('--');
  if (!baseScenarioId) throw new Error('test case ID is missing a base ID');
  return {
    record: {
      runId: 'analysis-run',
      caseId,
      baseScenarioId,
      system,
      workflow: 'TRANSFER',
      class: adversarial ? 'ADVERSARIAL' : 'BASE',
      split: 'TRAIN',
      chainIds: [1],
      actionCount: 1,
      observationStage: 'PRE_SIGN',
      oracleEvidenceLevel: 'EXPECTED_FIXTURE',
      mutationValidity: adversarial ? 'VALID_SEMANTIC' : null,
      evaluationMode: 'OFFLINE_COUNTERFACTUAL_REPLAY',
      preSignDecision: blocked ? 'DENY' : 'ALLOW',
      confirmationRequests: 0,
      firstDetectionOrdinal: blocked ? 1 : null,
      executionStatus: blocked ? 'NOT_ATTEMPTED' : 'REPLAYED',
      postStateStatus: blocked ? 'NOT_OBSERVED' : unsafe ? 'VIOLATION' : 'PASS',
      postStateEvidence: blocked ? 'NONE' : 'AUTHORED_ORACLE_FIXTURE',
      counterfactualEconomicEffectIssued: !blocked,
      counterfactualBenignCompletion: !adversarial && !blocked,
      latencyMs: 1,
    },
    variant: adversarial ? 'ADVERSARIAL_BUDGET' : 'BENIGN_ORIGINAL',
    mutationOperator: adversarial ? 'amount-inflation' : null,
    oracleExpectedDecision: adversarial ? 'DENY' : 'ALLOW',
    oracleViolationAmount: unsafe ? '10' : '0',
    oracleAllowanceExposure: '0',
    scenarioSha256: 'a'.repeat(64),
    postStateMonitorDecision: 'NOT_EVALUATED',
    firstDetectionStage: blocked ? 'PRE_SIGN' : 'NONE',
    firstDetectionOrdinal: blocked ? 1 : null,
    verdict: {
      decision: blocked ? 'DENY' : 'ALLOW',
      rationale: 'synthetic test verdict',
      reasonCodes: blocked ? ['DENY'] : [],
      attempts: 1,
    },
  };
}

describe('evaluation analysis', () => {
  const selected = [
    result('NONE', 'TR-01--BENIGN_ORIGINAL', false, false),
    result('NONE', 'TR-01--ADVERSARIAL_BUDGET', true, false),
    result('INTENTLOCK', 'TR-01--BENIGN_ORIGINAL', false, false),
    result('INTENTLOCK', 'TR-01--ADVERSARIAL_BUDGET', true, true),
  ];

  it('keeps unsafe amounts, grouped intervals, and strongest-baseline comparison traceable', () => {
    const analysis = analyzeEvaluationResults(selected, {
      expectedCasesPerSystem: 2,
      bootstrapReplicates: 100,
    });
    expect(analysis.selectedRecords).toBe(4);
    expect(analysis.strongestBaseline).toBe('NONE');
    expect(analysis.systems.find((system) => system.system === 'NONE')).toMatchObject({
      unauthorizedViolationAmountAtomicByCase: {
        'TR-01--ADVERSARIAL_BUDGET': '10',
      },
      aggregate: { unsafeExecutionRate: 0.5 },
    });
    expect(analysis.systems.find((system) => system.system === 'INTENTLOCK')).toMatchObject({
      unauthorizedViolationAmountAtomicByCase: {},
      aggregate: {
        unsafeExecutionRate: 0,
        confirmationRequests: 0,
        confirmationRequestRate: 0,
      },
      detectionOrdinals: {
        planPreflight: 0,
        actionPreSign: 1,
        postState: 0,
        none: 1,
      },
      firstDetectionOrdinalByCase: {
        'TR-01--ADVERSARIAL_BUDGET': 1,
      },
    });
    expect(analysis.intentLockUnsafeRateDifference95).toMatchObject({
      point: -0.5,
      replicates: 100,
      groupCount: 1,
    });
  });

  it('refuses missing per-system results', () => {
    expect(() =>
      analyzeEvaluationResults(selected.slice(0, 3), {
        expectedCasesPerSystem: 2,
        bootstrapReplicates: 100,
      }),
    ).toThrow('selected record count');
  });
});
