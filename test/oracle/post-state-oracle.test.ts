import { required } from '../../src/domain/required.js';
import { describe, expect, it } from 'vitest';
import {
  evaluatePostState,
  type OracleInput,
  type StateObservation,
} from '../../src/oracle/post-state-oracle.js';
const A = `0x${'11'.repeat(20)}`,
  B = `0x${'22'.repeat(20)}`,
  T = `0x${'33'.repeat(20)}`,
  P = `0x${'44'.repeat(20)}`;
const row = (value: string, field: StateObservation['field'] = 'BALANCE'): StateObservation => ({
  chainId: 1,
  subject: A,
  asset: T,
  field,
  value,
  source: 'EXPECTED_FIXTURE',
});
function input(): OracleInput {
  return {
    contract: {
      version: '0.1',
      account: A,
      nonce: '0',
      idempotencyKey: 'oracle-test',
      safety: {
        chainScopes: [
          {
            chainId: 1,
            allowedTargets: [{ target: P, selectors: ['0xa9059cbb'] }],
            allowedRecipients: [A, B],
          },
        ],
        assetBudgets: [
          { chainId: 1, asset: T, maxGrossOutflow: '100', maxAllowanceExposure: '100' },
        ],
        maxGasWei: '100',
        maxSlippageBps: 100,
        expiresAt: '2026-09-05T00:00:00Z',
      },
      finalStateGoals: [
        { kind: 'MIN_ASSET_BALANCE', chainId: 1, asset: T, account: A, minAmount: '10' },
      ],
    },
    preState: [row('0')],
    postState: [row('10')],
    evidenceLevel: 'EXPECTED_FIXTURE',
    observedEffects: [],
    executionComplete: true,
  };
}
const effectBase = {
  id: 'e',
  phase: 'OBSERVED' as const,
  provenance: { callPath: [0], target: P, selector: '0xa9059cbb', source: 'RECEIPT' as const },
};
describe('independent exact-state oracle', () => {
  it('computes exact deltas and reproducible labels without calling the monitor', () => {
    const value = input();
    expect(evaluatePostState(value)).toMatchObject({
      status: 'PASS',
      decision: 'ALLOW',
      deltas: [{ delta: '10' }],
    });
    expect(evaluatePostState(value)).toEqual(evaluatePostState(value));
  });
  it('handles integers above Number.MAX_SAFE_INTEGER exactly', () => {
    const value = input();
    value.preState = [row('900719925474099300000')];
    value.postState = [row('900719925474099300001')];
    expect(evaluatePostState(value).deltas[0]?.delta).toBe('1');
  });
  it('reports a final balance shortfall in integer units', () => {
    const value = input();
    value.postState = [row('9')];
    expect(evaluatePostState(value)).toMatchObject({
      status: 'VIOLATION',
      violations: [{ amount: '1' }],
    });
  });
  it.each(['DEBT', 'POSITION', 'HEALTH_FACTOR', 'ALLOWANCE', 'OWNER'] as const)(
    'checks %s final goals independently',
    (field) => {
      const value = input();
      const sample = { ...row(field === 'OWNER' ? A : '10', field), counterparty: P, tokenId: '7' };
      value.preState = [{ ...sample, value: field === 'OWNER' ? B : '0' }];
      value.postState = [sample];
      value.contract.finalStateGoals =
        field === 'DEBT'
          ? [{ kind: 'MAX_DEBT', chainId: 1, account: A, asset: T, maxAmount: '10' }]
          : field === 'POSITION'
            ? [
                {
                  kind: 'MIN_POSITION',
                  chainId: 1,
                  account: A,
                  asset: T,
                  protocol: P,
                  minAmount: '10',
                },
              ]
            : field === 'HEALTH_FACTOR'
              ? [{ kind: 'MIN_HEALTH_FACTOR', chainId: 1, account: A, protocol: P, minWad: '10' }]
              : field === 'ALLOWANCE'
                ? [{ kind: 'NO_RESIDUAL_ALLOWANCE', chainId: 1, owner: A, asset: T, spender: P }]
                : [{ kind: 'OWNER_IS', chainId: 1, collection: A, tokenId: '7', owner: A }];
      if (field === 'ALLOWANCE') value.postState = [{ ...sample, value: '0' }];
      expect(evaluatePostState(value).status).toBe('PASS');
      required(value.postState[0]).value =
        field === 'OWNER' ? B : field === 'DEBT' ? '11' : field === 'ALLOWANCE' ? '1' : '9';
      expect(evaluatePostState(value).status).toBe('VIOLATION');
    },
  );
  it.each([
    'missing-goal',
    'invalid-number',
    'negative-number',
    'duplicate-post',
    'duplicate-pre',
    'missing-pre',
    'partial',
    'no-events',
  ] as const)('does not turn %s into ALLOW', (reason) => {
    const value = input();
    if (reason === 'missing-goal') value.postState = [];
    if (reason === 'invalid-number') value.postState = [row(A)];
    if (reason === 'negative-number') value.postState = [row('-1')];
    if (reason === 'duplicate-post') value.postState.push(row('10'));
    if (reason === 'duplicate-pre') value.preState.push(row('0'));
    if (reason === 'missing-pre') value.preState = [];
    if (reason === 'partial') value.executionComplete = false;
    if (reason === 'no-events') delete value.observedEffects;
    expect(evaluatePostState(value).status).toBe('INSUFFICIENT_EVIDENCE');
  });
  it('keeps expected/observed disagreement separate from a security verdict', () => {
    const value = input();
    value.expectedPostState = [row('11')];
    expect(evaluatePostState(value)).toMatchObject({
      status: 'DISAGREEMENT',
      decision: 'ESCALATE',
      disagreements: [{ expected: '11', actual: '10' }],
    });
    value.expectedPostState = [{ ...row('10'), subject: B }];
    expect(evaluatePostState(value).disagreements[0]?.actual).toBeNull();
  });
  it('keeps a proven contract violation terminal even when prediction also disagrees', () => {
    const value = input();
    value.postState = [row('9')];
    value.expectedPostState = [row('10')];
    expect(evaluatePostState(value)).toMatchObject({
      status: 'VIOLATION',
      decision: 'DENY',
      violations: [{ amount: '1' }],
      disagreements: [{ expected: '10', actual: '9' }],
    });
  });
  it('checks signed delta references and delta-based final goals', () => {
    const value = input();
    value.preState = [row('5')];
    value.postState = [row('15')];
    value.contract.finalStateGoals = [
      { kind: 'MIN_ASSET_BALANCE_DELTA', chainId: 1, account: A, asset: T, minIncrease: '10' },
    ];
    value.expectedDeltas = [
      {
        chainId: 1,
        subject: A,
        field: 'BALANCE',
        asset: T,
        comparison: 'EXACT',
        delta: '10',
        rationale: 'exact recipient increase',
      },
    ];
    expect(evaluatePostState(value)).toMatchObject({
      status: 'PASS',
      finalGoals: [{ actual: '10', satisfied: true }],
    });
    value.expectedDeltas = [
      {
        ...required(required(value.expectedDeltas)[0]),
        comparison: 'AT_LEAST',
        delta: '11',
      },
    ];
    expect(evaluatePostState(value)).toMatchObject({
      status: 'DISAGREEMENT',
      disagreements: [{ expected: 'AT_LEAST:11', actual: '10' }],
    });
    value.expectedDeltas = [
      {
        ...required(required(value.expectedDeltas)[0]),
        comparison: 'AT_MOST',
        delta: '10',
      },
    ];
    expect(evaluatePostState(value).status).toBe('PASS');
  });
  it('cannot call synthetic data executed evidence', () => {
    const value = input();
    value.evidenceLevel = 'EXECUTED_FORK';
    expect(evaluatePostState(value).missing).toContain('executed:synthetic-state');
  });
  it('requires successful, complete, unique receipts on the required chains', () => {
    const value = input();
    value.evidenceLevel = 'EXECUTED_FORK';
    required(value.preState[0]).source = 'FIXED_FORK';
    required(value.postState[0]).source = 'POST_STATE';
    value.requiredReceiptCount = 1;
    value.receipts = [
      { chainId: 1, transactionHash: `0x${'aa'.repeat(32)}`, status: 'success', gasCostWei: '0' },
    ];
    expect(evaluatePostState(value).status).toBe('PASS');
    value.receipts = [{ chainId: 1, transactionHash: `0x${'aa'.repeat(32)}`, status: 'success' }];
    expect(evaluatePostState(value).status).toBe('INSUFFICIENT_EVIDENCE');
    value.receipts = [
      { chainId: 1, transactionHash: `0x${'aa'.repeat(32)}`, status: 'success', gasCostWei: '101' },
    ];
    expect(evaluatePostState(value).status).toBe('VIOLATION');
    value.receipts = [{ chainId: 8453, transactionHash: '0x1234', status: 'reverted' }];
    expect(evaluatePostState(value).status).toBe('INSUFFICIENT_EVIDENCE');
    value.receipts = [
      { chainId: 1, transactionHash: `0x${'aa'.repeat(32)}`, status: 'success' },
      { chainId: 1, transactionHash: `0x${'aa'.repeat(32)}`, status: 'success' },
    ];
    value.requiredReceiptCount = 2;
    expect(evaluatePostState(value).missing).toContain('receipts:duplicate');
  });
  it('uses ordered outflow events rather than net balance loss', () => {
    const value = input();
    value.observedEffects = [
      { ...effectBase, kind: 'TRANSFER', chainId: 1, asset: T, from: A, to: B, amount: '101' },
      {
        ...effectBase,
        id: 'return',
        kind: 'TRANSFER',
        chainId: 1,
        asset: T,
        from: B,
        to: A,
        amount: '101',
      },
    ];
    expect(evaluatePostState(value).violations).toContainEqual({
      code: 'GROSS_OUTFLOW_EXCEEDED',
      key: `1:${T}`,
      amount: '1',
    });
  });
  it('sums exposure across spenders and keeps asset keys separate', () => {
    const value = input();
    for (const counterparty of [P, B]) {
      value.preState.push({ ...row('0', 'ALLOWANCE'), counterparty });
      value.postState.push({ ...row('60', 'ALLOWANCE'), counterparty });
    }
    expect(evaluatePostState(value).allowanceExposure[0]?.amount).toBe('120');
    expect(evaluatePostState(value).violations[0]?.amount).toBe('20');
  });
  it('sums debt across protocols instead of accepting the first matching debt row', () => {
    const value = input();
    value.contract.finalStateGoals = [
      { kind: 'MAX_DEBT', chainId: 1, account: A, asset: T, maxAmount: '100' },
    ];
    value.preState = [P, B].map((counterparty) => ({ ...row('0', 'DEBT'), counterparty }));
    value.postState = [P, B].map((counterparty) => ({ ...row('60', 'DEBT'), counterparty }));
    expect(evaluatePostState(value)).toMatchObject({
      status: 'VIOLATION',
      finalGoals: [{ actual: '120' }],
      violations: [{ amount: '20' }],
    });
    required(value.postState[1]).value = '-1';
    expect(evaluatePostState(value).status).toBe('INSUFFICIENT_EVIDENCE');
  });
  it('does not choose a favorable balance from ambiguous matching observations', () => {
    const value = input();
    value.postState.push({ ...row('9'), counterparty: P });
    value.preState.push({ ...row('0'), counterparty: P });
    expect(evaluatePostState(value).status).toBe('INSUFFICIENT_EVIDENCE');
  });
  it('rejects invalid allowance state and missing metadata', () => {
    const value = input();
    value.preState.push(row('0', 'ALLOWANCE'));
    value.postState.push(row('-1', 'ALLOWANCE'));
    expect(evaluatePostState(value).status).toBe('INSUFFICIENT_EVIDENCE');
  });
  it('counts bridge departure once and checks receipt gas separately', () => {
    const value = input();
    value.observedEffects = [
      {
        ...effectBase,
        kind: 'BRIDGE',
        sourceChainId: 1,
        destinationChainId: 8453,
        asset: T,
        amount: '101',
        maxFee: '1',
        recipient: A,
      },
      { ...effectBase, id: 'gas', kind: 'GAS', chainId: 1, payer: A, maxFeeWei: '101' },
    ];
    expect(evaluatePostState(value).violations.map((v) => v.code)).toEqual([
      'GROSS_OUTFLOW_EXCEEDED',
      'GAS_BUDGET_EXCEEDED',
    ]);
  });
  it('does not silently accept unknown or predicted executed effects', () => {
    const value = input();
    value.evidenceLevel = 'EXECUTED_FORK';
    value.observedEffects = [
      { ...effectBase, phase: 'PREDICTED', kind: 'UNKNOWN', chainId: 1, reason: 'unknown' },
    ];
    expect(evaluatePostState(value).missing).toContain('effect:not-observed:e');
    expect(evaluatePostState(value).missing).toContain('effect:unknown:e');
  });
});
