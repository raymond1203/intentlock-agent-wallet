import { describe, expect, it } from 'vitest';

import type { EconomicEffect } from '../src/domain/action-ir.js';
import type { IntentContract } from '../src/domain/intent-contract.js';
import { evaluateIntent, type MonitorInput } from '../src/monitor/monitor.js';
import { REASON_CODES, type ReasonCode } from '../src/monitor/reason-codes.js';

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const TARGET = '0x2222222222222222222222222222222222222222';
const RECIPIENT = '0x3333333333333333333333333333333333333333';
const TOKEN = '0x4444444444444444444444444444444444444444';
const OTHER = '0x5555555555555555555555555555555555555555';
const ATTACKER = '0x6666666666666666666666666666666666666666';

function intentContract(): IntentContract {
  const permission = {
    target: TARGET,
    selectors: ['0xa9059cbb', '0x095ea7b3', '0x414bf389', '0x12345678', '0xabcdef01', '0x23b872dd'],
  };
  return {
    version: '0.1',
    account: ACCOUNT,
    nonce: '7',
    idempotencyKey: 'monitor-test',
    safety: {
      chainScopes: [
        { chainId: 1, allowedTargets: [permission], allowedRecipients: [ACCOUNT, RECIPIENT] },
        { chainId: 8453, allowedTargets: [permission], allowedRecipients: [ACCOUNT, RECIPIENT] },
      ],
      assetBudgets: [
        {
          chainId: 1,
          asset: TOKEN,
          maxGrossOutflow: '100',
          maxAllowanceExposure: '100',
        },
      ],
      maxGasWei: '100',
      maxSlippageBps: 100,
      expiresAt: '2026-09-05T00:00:00+09:00',
    },
    finalStateGoals: [
      {
        kind: 'MIN_ASSET_BALANCE',
        chainId: 1,
        asset: TOKEN,
        account: RECIPIENT,
        minAmount: '10',
      },
      { kind: 'MAX_DEBT', chainId: 1, asset: TOKEN, account: ACCOUNT, maxAmount: '50' },
    ],
  };
}

function provenance(selector = '0xa9059cbb', target = TARGET) {
  return { callPath: [0], target, selector, source: 'CALLDATA' as const };
}

function transfer(
  amount = '10',
  to = RECIPIENT,
  asset = TOKEN,
): Extract<EconomicEffect, { kind: 'TRANSFER' }> {
  return {
    id: 'transfer',
    phase: 'PREDICTED',
    provenance: provenance(),
    kind: 'TRANSFER',
    chainId: 1,
    asset,
    from: ACCOUNT,
    to,
    amount,
  };
}

function approval(
  amount = '10',
  spender = TARGET,
  expiration?: string,
): Extract<EconomicEffect, { kind: 'APPROVAL' }> {
  return {
    id: 'approval',
    phase: 'PREDICTED',
    provenance: provenance('0x095ea7b3'),
    kind: 'APPROVAL',
    chainId: 1,
    asset: TOKEN,
    owner: ACCOUNT,
    spender,
    amount,
    ...(expiration ? { expiration } : {}),
  };
}

function swap(
  overrides: Partial<Extract<EconomicEffect, { kind: 'SWAP' }>> = {},
): Extract<EconomicEffect, { kind: 'SWAP' }> {
  return {
    id: 'swap',
    phase: 'PREDICTED',
    provenance: provenance('0x414bf389'),
    kind: 'SWAP',
    chainId: 1,
    assetIn: TOKEN,
    assetOut: 'native',
    amountIn: '10',
    quotedAmountOut: '1000',
    minAmountOut: '990',
    recipient: ACCOUNT,
    ...overrides,
  };
}

function input(): MonitorInput {
  return {
    contract: intentContract(),
    acceptedEffects: [],
    candidateEffects: [transfer()],
    candidateDecodeStatus: 'COMPLETE',
    simulationStatus: 'SUCCESS',
    evaluatedAt: '2026-08-29T00:00:00Z',
  };
}

interface TransitionCase {
  name: string;
  kind: 'ALLOW' | 'DENY' | 'ESCALATE';
  code?: ReasonCode;
  change: (value: MonitorInput) => void;
}

const transitions: TransitionCase[] = [
  { name: 'bounded transfer', kind: 'ALLOW', change: () => undefined },
  {
    name: 'expired intent',
    kind: 'DENY',
    code: REASON_CODES.INTENT_EXPIRED,
    change: (value) => (value.evaluatedAt = '2026-09-05T00:00:00+09:00'),
  },
  {
    name: 'invalid evaluation time',
    kind: 'DENY',
    code: REASON_CODES.INTENT_EXPIRED,
    change: (value) => (value.evaluatedAt = 'not-a-time'),
  },
  {
    name: 'failed simulation',
    kind: 'ESCALATE',
    code: REASON_CODES.SIMULATION_FAILED,
    change: (value) => (value.simulationStatus = 'FAILED'),
  },
  {
    name: 'unavailable simulation',
    kind: 'ESCALATE',
    code: REASON_CODES.SIMULATION_FAILED,
    change: (value) => (value.simulationStatus = 'UNAVAILABLE'),
  },
  {
    name: 'partial decode',
    kind: 'ESCALATE',
    code: REASON_CODES.PARTIAL_DECODE,
    change: (value) => (value.candidateDecodeStatus = 'PARTIAL'),
  },
  {
    name: 'unknown decode',
    kind: 'ESCALATE',
    code: REASON_CODES.PARTIAL_DECODE,
    change: (value) => (value.candidateDecodeStatus = 'UNKNOWN'),
  },
  {
    name: 'unknown effect',
    kind: 'ESCALATE',
    code: REASON_CODES.UNKNOWN_EFFECT,
    change: (value) => {
      value.candidateEffects = [
        {
          id: 'unknown',
          phase: 'PREDICTED',
          provenance: provenance(),
          kind: 'UNKNOWN',
          chainId: 1,
          reason: 'unsupported selector',
        },
      ];
    },
  },
  {
    name: 'chain outside scope',
    kind: 'DENY',
    code: REASON_CODES.CHAIN_OUT_OF_SCOPE,
    change: (value) => {
      value.candidateEffects = [{ ...transfer(), chainId: 10 }];
    },
  },
  {
    name: 'target outside scope',
    kind: 'DENY',
    code: REASON_CODES.TARGET_NOT_ALLOWED,
    change: (value) => {
      value.candidateEffects = [{ ...transfer(), provenance: provenance('0xa9059cbb', OTHER) }];
    },
  },
  {
    name: 'selector outside scope',
    kind: 'DENY',
    code: REASON_CODES.SELECTOR_NOT_ALLOWED,
    change: (value) => {
      value.candidateEffects = [{ ...transfer(), provenance: provenance('0xdeadbeef') }];
    },
  },
  {
    name: 'recipient substitution',
    kind: 'DENY',
    code: REASON_CODES.RECIPIENT_NOT_ALLOWED,
    change: (value) => (value.candidateEffects = [transfer('10', ATTACKER)]),
  },
  {
    name: 'unbudgeted asset',
    kind: 'DENY',
    code: REASON_CODES.ASSET_NOT_BUDGETED,
    change: (value) => (value.candidateEffects = [transfer('10', RECIPIENT, OTHER)]),
  },
  {
    name: 'single transfer over budget',
    kind: 'DENY',
    code: REASON_CODES.GROSS_OUTFLOW_EXCEEDED,
    change: (value) => (value.candidateEffects = [transfer('101')]),
  },
  {
    name: 'accepted prefix plus candidate over budget',
    kind: 'DENY',
    code: REASON_CODES.GROSS_OUTFLOW_EXCEEDED,
    change: (value) => {
      value.acceptedEffects = [transfer('60')];
      value.candidateEffects = [transfer('41')];
    },
  },
  {
    name: 'approval spender substitution',
    kind: 'DENY',
    code: REASON_CODES.RECIPIENT_NOT_ALLOWED,
    change: (value) => (value.candidateEffects = [approval('10', ATTACKER)]),
  },
  {
    name: 'allowance over budget',
    kind: 'DENY',
    code: REASON_CODES.ALLOWANCE_EXPOSURE_EXCEEDED,
    change: (value) => (value.candidateEffects = [approval('101')]),
  },
  {
    name: 'approval expiration over deadline',
    kind: 'DENY',
    code: REASON_CODES.DEADLINE_EXCEEDED,
    change: (value) => (value.candidateEffects = [approval('10', TARGET, '1788562801')]),
  },
  {
    name: 'gas over budget',
    kind: 'DENY',
    code: REASON_CODES.GAS_BUDGET_EXCEEDED,
    change: (value) => {
      value.candidateEffects = [
        {
          id: 'gas',
          phase: 'PREDICTED',
          provenance: provenance(),
          kind: 'GAS',
          chainId: 1,
          payer: ACCOUNT,
          maxFeeWei: '101',
        },
      ];
    },
  },
  {
    name: 'swap quote missing',
    kind: 'ESCALATE',
    code: REASON_CODES.MISSING_QUOTE,
    change: (value) => (value.candidateEffects = [swap({ quotedAmountOut: undefined })]),
  },
  {
    name: 'swap slippage widened',
    kind: 'DENY',
    code: REASON_CODES.SLIPPAGE_EXCEEDED,
    change: (value) => (value.candidateEffects = [swap({ minAmountOut: '989' })]),
  },
  {
    name: 'swap recipient substituted',
    kind: 'DENY',
    code: REASON_CODES.RECIPIENT_NOT_ALLOWED,
    change: (value) => (value.candidateEffects = [swap({ recipient: ATTACKER })]),
  },
  {
    name: 'swap deadline widened',
    kind: 'DENY',
    code: REASON_CODES.DEADLINE_EXCEEDED,
    change: (value) => (value.candidateEffects = [swap({ deadline: '1788562801' })]),
  },
  {
    name: 'bridge recipient substituted',
    kind: 'DENY',
    code: REASON_CODES.RECIPIENT_NOT_ALLOWED,
    change: (value) => {
      value.candidateEffects = [
        {
          id: 'bridge',
          phase: 'PREDICTED',
          provenance: provenance('0x12345678'),
          kind: 'BRIDGE',
          sourceChainId: 1,
          destinationChainId: 8453,
          asset: TOKEN,
          amount: '10',
          maxFee: '1',
          recipient: ATTACKER,
        },
      ];
    },
  },
  {
    name: 'debt cap exceeded',
    kind: 'DENY',
    code: REASON_CODES.DEBT_CAP_EXCEEDED,
    change: (value) => {
      value.candidateEffects = [
        {
          id: 'debt',
          phase: 'PREDICTED',
          provenance: provenance('0xabcdef01'),
          kind: 'DEBT',
          chainId: 1,
          protocol: TARGET,
          account: ACCOUNT,
          asset: TOKEN,
          delta: '51',
        },
      ];
    },
  },
  {
    name: 'ownership recipient substituted',
    kind: 'DENY',
    code: REASON_CODES.RECIPIENT_NOT_ALLOWED,
    change: (value) => {
      value.candidateEffects = [
        {
          id: 'ownership',
          phase: 'PREDICTED',
          provenance: provenance('0x23b872dd'),
          kind: 'OWNERSHIP',
          chainId: 1,
          collection: TOKEN,
          tokenId: '1',
          from: ACCOUNT,
          to: ATTACKER,
        },
      ];
    },
  },
  {
    name: 'missing final-state evidence',
    kind: 'ESCALATE',
    code: REASON_CODES.FINAL_STATE_UNAVAILABLE,
    change: (value) => {
      value.finalGoalChecks = [{ goalIndex: 0, satisfied: true, evidence: 'balance=10' }];
    },
  },
  {
    name: 'failed final-state goal',
    kind: 'DENY',
    code: REASON_CODES.FINAL_GOAL_UNSATISFIED,
    change: (value) => {
      value.finalGoalChecks = [
        { goalIndex: 0, satisfied: false, evidence: 'balance=9' },
        { goalIndex: 1, satisfied: true, evidence: 'debt=0' },
      ];
    },
  },
  {
    name: 'all final-state goals satisfied',
    kind: 'ALLOW',
    change: (value) => {
      value.finalGoalChecks = [
        { goalIndex: 0, satisfied: true, evidence: 'balance=10' },
        { goalIndex: 1, satisfied: true, evidence: 'debt=0' },
      ];
    },
  },
];

describe('deterministic intent monitor transitions', () => {
  it('covers at least 25 transition cases', () => {
    expect(transitions.length).toBeGreaterThanOrEqual(25);
  });

  it.each(transitions)('$name -> $kind $code', (transition) => {
    const value = input();
    transition.change(value);
    const decision = evaluateIntent(value);
    expect(decision.kind).toBe(transition.kind);
    if (transition.code && decision.kind !== 'ALLOW') {
      expect(decision.code).toBe(transition.code);
      expect(decision.violatedInvariant).not.toBe('');
      expect(decision.evidence.length).toBeGreaterThan(0);
    }
  });

  it('returns byte-for-byte identical decisions for identical inputs', () => {
    expect(evaluateIntent(input())).toEqual(evaluateIntent(input()));
  });
});
