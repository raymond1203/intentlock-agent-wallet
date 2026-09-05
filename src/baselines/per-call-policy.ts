import type { BenchmarkScenario } from '../benchmark/scenario.js';
import type { EconomicEffect } from '../domain/action-ir.js';
import { evaluateIntent } from '../monitor/monitor.js';
import type { BaselineVerdict } from './types.js';

function normalize(value: string): string {
  return value.toLowerCase();
}

function effectsForAction(
  effects: readonly EconomicEffect[],
  executionIndex: number,
): EconomicEffect[] {
  return effects.filter((effect) => effect.provenance.callPath[0] === executionIndex);
}

/**
 * Deliberately weak baseline: every top-level call is evaluated in isolation.
 * It shares the production monitor's field rules but never carries an accepted-effects ledger
 * across calls, retries, or concurrent workers.
 */
export function evaluatePerCallPolicy(
  scenario: BenchmarkScenario,
  evaluatedAt = '2026-08-30T00:00:00Z',
): BaselineVerdict {
  const orderedActions = [...scenario.trace.actions].sort(
    (left, right) => left.executionIndex - right.executionIndex,
  );
  if (
    scenario.mutation?.validity === 'INVALID_CALLDATA' ||
    scenario.trace.expectedEffects.some((effect) => effect.kind === 'UNKNOWN')
  ) {
    const unknownExecutionIndex = scenario.trace.expectedEffects.find(
      (effect) => effect.kind === 'UNKNOWN',
    )?.provenance.callPath[0];
    const detectedIndex = orderedActions.findIndex(
      (action) => action.executionIndex === unknownExecutionIndex,
    );
    const firstDetectionActionOrdinal = detectedIndex >= 0 ? detectedIndex + 1 : 1;
    return {
      baseline: 'PER_CALL_POLICY',
      decision: 'ABSTAIN',
      rationale: 'At least one isolated call could not be completely interpreted.',
      reasonCodes: ['UNKNOWN_EFFECT'],
      checkedUnits: orderedActions.length,
      attempts: 1,
      firstDetectionActionOrdinal,
    };
  }
  const reasonCodes: string[] = [];
  let sawAbstention = false;
  let sawDenial = false;
  let firstDetectionActionOrdinal: number | undefined;

  const markDetection = (ordinal: number): void => {
    firstDetectionActionOrdinal ??= ordinal;
  };

  for (const [index, action] of orderedActions.entries()) {
    const ordinal = index + 1;
    const scope = scenario.intent.safety.chainScopes.find(
      (candidate) => candidate.chainId === action.chainId,
    );
    if (!scope) {
      sawDenial = true;
      reasonCodes.push('CHAIN_OUT_OF_SCOPE');
      markDetection(ordinal);
      continue;
    }
    const permission = scope.allowedTargets.find(
      (candidate) => normalize(candidate.target) === normalize(action.target),
    );
    if (!permission) {
      sawDenial = true;
      reasonCodes.push('TARGET_NOT_ALLOWED');
      markDetection(ordinal);
      continue;
    }
    if (
      !permission.selectors.some((selector) => normalize(selector) === normalize(action.selector))
    ) {
      sawDenial = true;
      reasonCodes.push('SELECTOR_NOT_ALLOWED');
      markDetection(ordinal);
      continue;
    }

    const valueWei = BigInt(action.valueWei);
    const nativeBudget = scenario.intent.safety.assetBudgets.find(
      (budget) => budget.chainId === action.chainId && budget.asset === 'native',
    );
    if (valueWei > 0n && (!nativeBudget || valueWei > BigInt(nativeBudget.maxGrossOutflow))) {
      sawDenial = true;
      reasonCodes.push('VALUE_CEILING_EXCEEDED');
      markDetection(ordinal);
      continue;
    }

    const effects = effectsForAction(scenario.trace.expectedEffects, action.executionIndex);
    if (effects.length === 0) {
      sawAbstention = true;
      reasonCodes.push('MISSING_ACTION_EFFECTS');
      markDetection(ordinal);
      continue;
    }
    const result = evaluateIntent({
      contract: scenario.intent,
      acceptedEffects: [],
      candidateEffects: effects,
      candidateDecodeStatus: effects.some((effect) => effect.kind === 'UNKNOWN')
        ? 'UNKNOWN'
        : 'COMPLETE',
      simulationStatus: 'SUCCESS',
      evaluatedAt,
    });
    if (result.kind === 'DENY') {
      sawDenial = true;
      reasonCodes.push(result.code);
      markDetection(ordinal);
    }
    if (result.kind === 'ESCALATE') {
      sawAbstention = true;
      reasonCodes.push(result.code);
      markDetection(ordinal);
    }
  }

  const uniqueCodes = [...new Set(reasonCodes)];
  if (sawDenial) {
    return {
      baseline: 'PER_CALL_POLICY',
      decision: 'DENY',
      rationale:
        'At least one isolated call violates its local target, selector, value, or effect rule.',
      reasonCodes: uniqueCodes,
      checkedUnits: orderedActions.length,
      attempts: 1,
      ...(firstDetectionActionOrdinal === undefined ? {} : { firstDetectionActionOrdinal }),
    };
  }
  if (sawAbstention) {
    return {
      baseline: 'PER_CALL_POLICY',
      decision: 'ABSTAIN',
      rationale: 'At least one isolated call could not be completely interpreted.',
      reasonCodes: uniqueCodes,
      checkedUnits: orderedActions.length,
      attempts: 1,
      ...(firstDetectionActionOrdinal === undefined ? {} : { firstDetectionActionOrdinal }),
    };
  }
  return {
    baseline: 'PER_CALL_POLICY',
    decision: 'ALLOW',
    rationale:
      'Every call independently satisfies its local policy; cumulative state was not checked.',
    reasonCodes: [],
    checkedUnits: orderedActions.length,
    attempts: 1,
  };
}
