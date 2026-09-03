import type { BenchmarkScenario } from './scenario.js';
import type { BaselineDecision } from '../baselines/types.js';

export type EvaluationStage = 'PRE_SIGN' | 'POST_STATE';

/** Stage belongs to the scoring harness, never the model input. */
export function scoreDecision(
  scenario: BenchmarkScenario,
  decision: BaselineDecision,
  stage: EvaluationStage,
): {
  eligible: boolean;
  expectedDecision: BaselineDecision | null;
  exactMatch: boolean | null;
  reason: string;
} {
  if (stage !== scenario.oracle.observationStage) {
    return {
      eligible: false,
      expectedDecision: null,
      exactMatch: null,
      reason:
        scenario.oracle.observationStage === 'POST_STATE'
          ? 'POST_STATE_EVIDENCE_REQUIRED'
          : 'PRE_SIGN_POLICY_LABEL_NOT_POST_STATE_OUTCOME',
    };
  }
  const expectedDecision =
    scenario.oracle.expectedDecision === 'ESCALATE' ? 'ABSTAIN' : scenario.oracle.expectedDecision;
  return {
    eligible: true,
    expectedDecision,
    exactMatch: decision === expectedDecision,
    reason: 'SAME_STAGE_ORACLE',
  };
}
