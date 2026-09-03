import { aggregateEffects, type EconomicEffect } from '../domain/action-ir.js';
import type { DecisionEvidence, GuardDecision } from '../domain/guard-decision.js';
import type { IntentContract } from '../domain/intent-contract.js';
import { hashIntentContract } from '../domain/intent-hash.js';
import { REASON_CODES, type ReasonCode } from './reason-codes.js';

export interface FinalGoalCheck {
  goalIndex: number;
  satisfied: boolean;
  evidence: string;
}

export interface MonitorInput {
  contract: IntentContract;
  acceptedEffects: readonly EconomicEffect[];
  candidateEffects: readonly EconomicEffect[];
  candidateDecodeStatus: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';
  simulationStatus: 'SUCCESS' | 'FAILED' | 'UNAVAILABLE';
  evaluatedAt: string;
  finalGoalChecks?: readonly FinalGoalCheck[];
}

function evidence(
  path: string,
  expected: string,
  actual: string,
  source: DecisionEvidence['source'],
): DecisionEvidence[] {
  return [{ path, expected, actual, source }];
}

function deny(
  input: MonitorInput,
  code: ReasonCode,
  invariant: string,
  reason: string,
  details: DecisionEvidence[],
): GuardDecision {
  return {
    kind: 'DENY',
    intentHash: hashIntentContract(input.contract),
    evaluatedAt: input.evaluatedAt,
    code,
    reason,
    violatedInvariant: invariant,
    evidence: details,
  };
}

function escalate(
  input: MonitorInput,
  code: ReasonCode,
  invariant: string,
  prompt: string,
  details: DecisionEvidence[],
): GuardDecision {
  return {
    kind: 'ESCALATE',
    intentHash: hashIntentContract(input.contract),
    evaluatedAt: input.evaluatedAt,
    code,
    prompt,
    violatedInvariant: invariant,
    evidence: details,
  };
}

function chainIdOf(effect: EconomicEffect): number {
  return effect.kind === 'BRIDGE' ? effect.sourceChainId : effect.chainId;
}

function isAllowedRecipient(contract: IntentContract, chainId: number, recipient: string): boolean {
  const scope = contract.safety.chainScopes.find((entry) => entry.chainId === chainId);
  return (
    scope?.allowedRecipients.some((entry) => entry.toLowerCase() === recipient.toLowerCase()) ??
    false
  );
}

function isAllowedTarget(contract: IntentContract, chainId: number, target: string): boolean {
  return (
    contract.safety.chainScopes
      .find((entry) => entry.chainId === chainId)
      ?.allowedTargets.some((entry) => entry.target.toLowerCase() === target.toLowerCase()) ?? false
  );
}

function evaluatePermissions(
  input: MonitorInput,
  effects: readonly EconomicEffect[],
): GuardDecision | undefined {
  for (const effect of effects) {
    const chainId = chainIdOf(effect);
    const scope = input.contract.safety.chainScopes.find((entry) => entry.chainId === chainId);
    if (!scope) {
      return deny(
        input,
        REASON_CODES.CHAIN_OUT_OF_SCOPE,
        'safety.chainScopes',
        'Effect chain is outside the intent contract.',
        evidence('effect.chainId', 'one of contracted chains', String(chainId), 'ACTION_IR'),
      );
    }

    const permission = scope.allowedTargets.find(
      (entry) => entry.target.toLowerCase() === effect.provenance.target.toLowerCase(),
    );
    if (!permission) {
      return deny(
        input,
        REASON_CODES.TARGET_NOT_ALLOWED,
        'safety.chainScopes.allowedTargets',
        'Effect target is not allowed.',
        evidence(
          'effect.provenance.target',
          'contracted target',
          effect.provenance.target,
          'ACTION_IR',
        ),
      );
    }
    if (
      !permission.selectors.some(
        (selector) => selector.toLowerCase() === effect.provenance.selector.toLowerCase(),
      )
    ) {
      return deny(
        input,
        REASON_CODES.SELECTOR_NOT_ALLOWED,
        'safety.chainScopes.allowedTargets.selectors',
        'Effect selector is not allowed.',
        evidence(
          'effect.provenance.selector',
          permission.selectors.join(','),
          effect.provenance.selector,
          'ACTION_IR',
        ),
      );
    }
  }
  return undefined;
}

function evaluateEffectSpecificRules(
  input: MonitorInput,
  effects: readonly EconomicEffect[],
): GuardDecision | undefined {
  for (const effect of effects) {
    switch (effect.kind) {
      case 'TRANSFER':
        if (
          effect.from.toLowerCase() === input.contract.account.toLowerCase() &&
          !isAllowedRecipient(input.contract, effect.chainId, effect.to) &&
          !isAllowedTarget(input.contract, effect.chainId, effect.to)
        ) {
          return deny(
            input,
            REASON_CODES.RECIPIENT_NOT_ALLOWED,
            'safety.chainScopes.allowedRecipients',
            'Transfer recipient is not allowed.',
            evidence('effect.to', 'contracted recipient', effect.to, 'ACTION_IR'),
          );
        }
        break;
      case 'APPROVAL': {
        const scope = input.contract.safety.chainScopes.find(
          (entry) => entry.chainId === effect.chainId,
        );
        const spenderAllowed = scope?.allowedTargets.some(
          (entry) => entry.target.toLowerCase() === effect.spender.toLowerCase(),
        );
        if (
          effect.owner.toLowerCase() === input.contract.account.toLowerCase() &&
          !spenderAllowed
        ) {
          return deny(
            input,
            REASON_CODES.RECIPIENT_NOT_ALLOWED,
            'approval.spender',
            'Approval spender is outside the contracted targets.',
            evidence('effect.spender', 'contracted target', effect.spender, 'ACTION_IR'),
          );
        }
        if (
          effect.expiration &&
          BigInt(effect.expiration) >
            BigInt(Math.floor(Date.parse(input.contract.safety.expiresAt) / 1000))
        ) {
          return deny(
            input,
            REASON_CODES.DEADLINE_EXCEEDED,
            'safety.expiresAt',
            'Approval expiration exceeds the intent deadline.',
            evidence(
              'effect.expiration',
              input.contract.safety.expiresAt,
              effect.expiration,
              'ACTION_IR',
            ),
          );
        }
        if (
          effect.signatureDeadline &&
          BigInt(effect.signatureDeadline) >
            BigInt(Math.floor(Date.parse(input.contract.safety.expiresAt) / 1000))
        ) {
          return deny(
            input,
            REASON_CODES.DEADLINE_EXCEEDED,
            'safety.expiresAt',
            'Signature deadline exceeds the intent deadline.',
            evidence(
              'effect.signatureDeadline',
              input.contract.safety.expiresAt,
              effect.signatureDeadline,
              'ACTION_IR',
            ),
          );
        }
        break;
      }
      case 'SWAP': {
        if (!isAllowedRecipient(input.contract, effect.chainId, effect.recipient)) {
          return deny(
            input,
            REASON_CODES.RECIPIENT_NOT_ALLOWED,
            'safety.chainScopes.allowedRecipients',
            'Swap recipient is not allowed.',
            evidence('effect.recipient', 'contracted recipient', effect.recipient, 'ACTION_IR'),
          );
        }
        if (!effect.quotedAmountOut) {
          return escalate(
            input,
            REASON_CODES.MISSING_QUOTE,
            'safety.maxSlippageBps',
            '기준 quote가 없어 slippage 한도를 검증할 수 없습니다.',
            evidence('effect.quotedAmountOut', 'positive quote', 'missing', 'SIMULATOR'),
          );
        }
        const quoted = BigInt(effect.quotedAmountOut);
        const minimum = BigInt(effect.minAmountOut);
        const slippageBps = quoted === 0n ? 10_001n : ((quoted - minimum) * 10_000n) / quoted;
        if (minimum > quoted || slippageBps > BigInt(input.contract.safety.maxSlippageBps)) {
          return deny(
            input,
            REASON_CODES.SLIPPAGE_EXCEEDED,
            'safety.maxSlippageBps',
            'Swap minimum output widens slippage beyond the contract.',
            evidence(
              'effect.minAmountOut',
              `slippage <= ${String(input.contract.safety.maxSlippageBps)} bps`,
              `${slippageBps.toString()} bps`,
              'ACTION_IR',
            ),
          );
        }
        if (
          effect.deadline &&
          BigInt(effect.deadline) >
            BigInt(Math.floor(Date.parse(input.contract.safety.expiresAt) / 1000))
        ) {
          return deny(
            input,
            REASON_CODES.DEADLINE_EXCEEDED,
            'safety.expiresAt',
            'Swap deadline exceeds the intent deadline.',
            evidence(
              'effect.deadline',
              input.contract.safety.expiresAt,
              effect.deadline,
              'ACTION_IR',
            ),
          );
        }
        break;
      }
      case 'BRIDGE':
        if (!isAllowedRecipient(input.contract, effect.destinationChainId, effect.recipient)) {
          return deny(
            input,
            REASON_CODES.RECIPIENT_NOT_ALLOWED,
            'destination.allowedRecipients',
            'Bridge destination recipient is not allowed.',
            evidence('effect.recipient', 'destination recipient', effect.recipient, 'ACTION_IR'),
          );
        }
        break;
      case 'DEBT': {
        const limit = input.contract.safety.debtLimits?.find(
          (entry) =>
            entry.chainId === effect.chainId &&
            entry.asset.toLowerCase() === effect.asset.toLowerCase() &&
            entry.account.toLowerCase() === effect.account.toLowerCase(),
        );
        const maxDebt = input.contract.finalStateGoals.find(
          (goal) =>
            goal.kind === 'MAX_DEBT' &&
            goal.chainId === effect.chainId &&
            goal.asset.toLowerCase() === effect.asset.toLowerCase() &&
            goal.account.toLowerCase() === effect.account.toLowerCase(),
        );
        const maxAmount =
          limit?.maxDebt ?? (maxDebt?.kind === 'MAX_DEBT' ? maxDebt.maxAmount : '0');
        let debt = BigInt(limit?.initialDebt ?? '0');
        let peak = debt;
        for (const candidate of [...input.acceptedEffects, ...input.candidateEffects]) {
          if (
            candidate.kind !== 'DEBT' ||
            candidate.chainId !== effect.chainId ||
            candidate.asset.toLowerCase() !== effect.asset.toLowerCase() ||
            candidate.account.toLowerCase() !== effect.account.toLowerCase()
          )
            continue;
          debt += BigInt(candidate.delta);
          if (debt > peak) peak = debt;
        }
        if (peak > BigInt(maxAmount)) {
          return deny(
            input,
            REASON_CODES.DEBT_CAP_EXCEEDED,
            'finalStateGoals.MAX_DEBT',
            'Debt increase exceeds the contracted cap.',
            evidence('cumulativeDebtPeak', maxAmount, peak.toString(), 'ACTION_IR'),
          );
        }
        break;
      }
      case 'OWNERSHIP':
        if (!isAllowedRecipient(input.contract, effect.chainId, effect.to)) {
          return deny(
            input,
            REASON_CODES.RECIPIENT_NOT_ALLOWED,
            'safety.chainScopes.allowedRecipients',
            'Ownership recipient is not allowed.',
            evidence('effect.to', 'contracted recipient', effect.to, 'ACTION_IR'),
          );
        }
        break;
      case 'GAS':
      case 'UNKNOWN':
        break;
    }
  }
  return undefined;
}

function evaluateBudgets(
  input: MonitorInput,
  allEffects: readonly EconomicEffect[],
): GuardDecision | undefined {
  const totals = aggregateEffects(allEffects, input.contract.account);
  for (const [key, amount] of totals.grossOutflow) {
    const [chainId, asset] = key.split(':') as [string, string];
    const budget = input.contract.safety.assetBudgets.find(
      (entry) => entry.chainId === Number(chainId) && entry.asset.toLowerCase() === asset,
    );
    if (!budget) {
      return deny(
        input,
        REASON_CODES.ASSET_NOT_BUDGETED,
        'safety.assetBudgets',
        'Outgoing asset has no budget.',
        evidence('effect.asset', 'budgeted asset', key, 'ACTION_IR'),
      );
    }
    if (amount > BigInt(budget.maxGrossOutflow)) {
      return deny(
        input,
        REASON_CODES.GROSS_OUTFLOW_EXCEEDED,
        'assetBudget.maxGrossOutflow',
        'Cumulative gross outflow exceeds the budget.',
        evidence('cumulativeGrossOutflow', budget.maxGrossOutflow, amount.toString(), 'LEDGER'),
      );
    }
  }
  for (const [key, amount] of totals.allowanceExposure) {
    const [chainId, asset] = key.split(':') as [string, string];
    const budget = input.contract.safety.assetBudgets.find(
      (entry) => entry.chainId === Number(chainId) && entry.asset.toLowerCase() === asset,
    );
    if (!budget) {
      return deny(
        input,
        REASON_CODES.ASSET_NOT_BUDGETED,
        'safety.assetBudgets',
        'Approved asset has no budget.',
        evidence('approval.asset', 'budgeted asset', key, 'ACTION_IR'),
      );
    }
    if (amount > BigInt(budget.maxAllowanceExposure)) {
      return deny(
        input,
        REASON_CODES.ALLOWANCE_EXPOSURE_EXCEEDED,
        'assetBudget.maxAllowanceExposure',
        'Allowance exposure exceeds the budget.',
        evidence('allowanceExposure', budget.maxAllowanceExposure, amount.toString(), 'LEDGER'),
      );
    }
  }
  if (totals.gasWei > BigInt(input.contract.safety.maxGasWei)) {
    return deny(
      input,
      REASON_CODES.GAS_BUDGET_EXCEEDED,
      'safety.maxGasWei',
      'Cumulative gas exceeds the budget.',
      evidence(
        'cumulativeGasWei',
        input.contract.safety.maxGasWei,
        totals.gasWei.toString(),
        'LEDGER',
      ),
    );
  }
  return undefined;
}

function evaluateFinalGoals(input: MonitorInput): GuardDecision | undefined {
  if (!input.finalGoalChecks) return undefined;
  const byIndex = new Map(input.finalGoalChecks.map((check) => [check.goalIndex, check]));
  for (const [index] of input.contract.finalStateGoals.entries()) {
    const check = byIndex.get(index);
    if (!check) {
      return escalate(
        input,
        REASON_CODES.FINAL_STATE_UNAVAILABLE,
        `finalStateGoals.${String(index)}`,
        'receipt 이후 final-state 증거가 누락되었습니다.',
        evidence(`finalStateGoals.${String(index)}`, 'observed post-state', 'missing', 'RECEIPT'),
      );
    }
    if (!check.satisfied) {
      return deny(
        input,
        REASON_CODES.FINAL_GOAL_UNSATISFIED,
        `finalStateGoals.${String(index)}`,
        'Receipt post-state does not satisfy the final goal.',
        evidence(`finalStateGoals.${String(index)}`, 'satisfied', check.evidence, 'RECEIPT'),
      );
    }
  }
  return undefined;
}

export function evaluateIntent(input: MonitorInput): GuardDecision {
  const intentHash = hashIntentContract(input.contract);
  const evaluatedAtMs = Date.parse(input.evaluatedAt);
  if (
    !Number.isFinite(evaluatedAtMs) ||
    evaluatedAtMs >= Date.parse(input.contract.safety.expiresAt)
  ) {
    return deny(
      input,
      REASON_CODES.INTENT_EXPIRED,
      'safety.expiresAt',
      'Intent has expired.',
      evidence('evaluatedAt', `< ${input.contract.safety.expiresAt}`, input.evaluatedAt, 'INTENT'),
    );
  }
  if (input.simulationStatus !== 'SUCCESS') {
    return escalate(
      input,
      REASON_CODES.SIMULATION_FAILED,
      'simulation.success',
      '시뮬레이션이 성공하지 않아 서명을 진행할 수 없습니다.',
      evidence('simulationStatus', 'SUCCESS', input.simulationStatus, 'SIMULATOR'),
    );
  }
  if (input.candidateDecodeStatus !== 'COMPLETE') {
    return escalate(
      input,
      REASON_CODES.PARTIAL_DECODE,
      'decoder.completeness',
      '모든 내부 호출과 경제 효과가 해석되지 않았습니다.',
      evidence('candidateDecodeStatus', 'COMPLETE', input.candidateDecodeStatus, 'ACTION_IR'),
    );
  }
  const allEffects = [...input.acceptedEffects, ...input.candidateEffects];
  if (allEffects.some((effect) => effect.kind === 'UNKNOWN')) {
    return escalate(
      input,
      REASON_CODES.UNKNOWN_EFFECT,
      'effects.known',
      '알 수 없는 경제 효과를 사용자가 검토해야 합니다.',
      evidence('effect.kind', 'known effect', 'UNKNOWN', 'ACTION_IR'),
    );
  }

  const decision =
    evaluatePermissions(input, input.candidateEffects) ??
    evaluateEffectSpecificRules(input, input.candidateEffects) ??
    evaluateBudgets(input, allEffects) ??
    evaluateFinalGoals(input);
  if (decision) return decision;

  return { kind: 'ALLOW', intentHash, evaluatedAt: input.evaluatedAt, evidence: [] };
}
