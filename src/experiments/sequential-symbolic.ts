import type { BenchmarkScenario } from '../benchmark/scenario.js';
import type { EconomicEffect } from '../domain/action-ir.js';
import type { GuardDecision } from '../domain/guard-decision.js';
import { evaluateIntent } from '../monitor/monitor.js';

export interface SequentialSymbolicConfiguration {
  acceptedEffectHistory: boolean;
  recursiveDecoder: boolean;
  confirmationPolicy: 'AUTONOMOUS' | 'ALWAYS_CONFIRM';
}

export interface SequentialSymbolicVerdict {
  decision: 'ALLOW' | 'DENY' | 'ABSTAIN';
  rationale: string;
  reasonCodes: string[];
  /** Number of action-level checks performed; retained as the raw verdict attempt count. */
  attempts: number;
  /** One-based execution-order position of the first pre-sign intervention. */
  firstDetectionActionOrdinal: number | null;
}

export interface OrderedActionStep {
  executionIndex: number;
  ordinal: number;
  signerActionFingerprint: string;
  effects: EconomicEffect[];
}

function signerActionFingerprint(action: BenchmarkScenario['trace']['actions'][number]): string {
  return JSON.stringify({
    chainId: action.chainId,
    target: action.target.toLowerCase(),
    selector: action.selector.toLowerCase(),
    calldata: action.calldata.toLowerCase(),
    valueWei: action.valueWei,
  });
}

/** Maps every predicted effect to its top-level action and returns signer execution order. */
export function orderedActionSteps(scenario: BenchmarkScenario): OrderedActionStep[] {
  const ordered = [...scenario.trace.actions].sort(
    (left, right) => left.executionIndex - right.executionIndex,
  );
  const effectsByIndex = new Map<number, EconomicEffect[]>();
  for (const action of ordered) {
    if (effectsByIndex.has(action.executionIndex)) {
      throw new Error(
        `${scenario.id} has duplicate action executionIndex ${String(action.executionIndex)}`,
      );
    }
    effectsByIndex.set(action.executionIndex, []);
  }
  for (const effect of scenario.trace.expectedEffects) {
    const executionIndex = effect.provenance.callPath[0];
    if (executionIndex === undefined || !effectsByIndex.has(executionIndex)) {
      throw new Error(`${scenario.id} effect does not map to an action step`);
    }
    effectsByIndex.get(executionIndex)?.push(effect);
  }
  return ordered.map((action, index) => ({
    executionIndex: action.executionIndex,
    ordinal: index + 1,
    signerActionFingerprint: signerActionFingerprint(action),
    effects: effectsByIndex.get(action.executionIndex) ?? [],
  }));
}

/**
 * Retry/concurrency mutations encode two invocations of the same intent as two identical signer
 * sequences. The persisted idempotency ledger returns the first reservation and must not invoke
 * the signer for the second sequence, even when the underlying state update is idempotent (for
 * example approve(0) or an identical Permit2 allowance).
 */
function replayedSequenceStartOrdinal(steps: readonly OrderedActionStep[]): number | null {
  if (steps.length === 0 || steps.length % 2 !== 0) return null;
  const half = steps.length / 2;
  for (let index = 0; index < half; index += 1) {
    if (steps[index]?.signerActionFingerprint !== steps[index + half]?.signerActionFingerprint) {
      return null;
    }
  }
  return half + 1;
}

function publicVerdict(decision: GuardDecision, ordinal: number): SequentialSymbolicVerdict {
  if (decision.kind === 'ALLOW') {
    return {
      decision: 'ALLOW',
      rationale: 'Every replayed step satisfies the configured symbolic contract.',
      reasonCodes: [],
      attempts: ordinal,
      firstDetectionActionOrdinal: null,
    };
  }
  return {
    decision: decision.kind === 'DENY' ? 'DENY' : 'ABSTAIN',
    rationale: decision.kind === 'DENY' ? decision.reason : decision.prompt,
    reasonCodes: [decision.code],
    attempts: ordinal,
    firstDetectionActionOrdinal: ordinal,
  };
}

/**
 * Replays actions in signer order. Effects from an ALLOWed prefix are committed to the
 * cumulative ledger before the next action is checked, and evaluation stops at the first
 * DENY/ABSTAIN. This is the shared implementation for the primary IntentLock arm and its
 * symbolic ablations.
 */
export function evaluateSequentialSymbolic(
  scenario: BenchmarkScenario,
  evaluatedAt: string,
  configuration: SequentialSymbolicConfiguration,
): SequentialSymbolicVerdict {
  const steps = orderedActionSteps(scenario);
  const replayStartOrdinal = configuration.acceptedEffectHistory
    ? replayedSequenceStartOrdinal(steps)
    : null;
  if (configuration.confirmationPolicy === 'ALWAYS_CONFIRM') {
    return {
      decision: 'ABSTAIN',
      rationale: 'The policy variant requires confirmation before the first replayed action.',
      reasonCodes: ['CONFIRMATION_REQUIRED'],
      attempts: 1,
      firstDetectionActionOrdinal: 1,
    };
  }

  const acceptedEffects: EconomicEffect[] = [];
  for (const step of steps) {
    const nestedEffect = step.effects.some((effect) => effect.provenance.callPath.length > 1);
    const containsUnknown = step.effects.some((effect) => effect.kind === 'UNKNOWN');
    const decision = evaluateIntent({
      contract: scenario.intent,
      acceptedEffects: configuration.acceptedEffectHistory ? acceptedEffects : [],
      candidateEffects: step.effects,
      candidateDecodeStatus:
        !configuration.recursiveDecoder && nestedEffect
          ? 'PARTIAL'
          : containsUnknown
            ? 'UNKNOWN'
            : 'COMPLETE',
      simulationStatus: 'SUCCESS',
      evaluatedAt,
    });
    if (decision.kind !== 'ALLOW') return publicVerdict(decision, step.ordinal);
    if (step.ordinal === replayStartOrdinal) {
      return {
        decision: 'DENY',
        rationale:
          'The signer action sequence replays an existing reservation for this intent idempotency key.',
        reasonCodes: ['IDEMPOTENCY_REPLAY'],
        attempts: step.ordinal,
        firstDetectionActionOrdinal: step.ordinal,
      };
    }
    if (configuration.acceptedEffectHistory) acceptedEffects.push(...step.effects);
  }

  return {
    decision: 'ALLOW',
    rationale: 'Every replayed step satisfies the configured symbolic contract.',
    reasonCodes: [],
    attempts: Math.max(1, steps.length),
    firstDetectionActionOrdinal: null,
  };
}
