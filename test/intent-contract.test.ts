import { describe, expect, it } from 'vitest';

import {
  createIntentContractJsonSchema,
  IntentContractSchema,
} from '../src/domain/intent-contract.js';

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const TARGET = '0x2222222222222222222222222222222222222222';
const RECIPIENT = '0x3333333333333333333333333333333333333333';
const TOKEN = '0x4444444444444444444444444444444444444444';

function validContract(): Record<string, unknown> {
  return {
    version: '0.1',
    account: ACCOUNT,
    nonce: '1',
    idempotencyKey: 'scenario-001',
    safety: {
      chainScopes: [
        {
          chainId: 1,
          allowedTargets: [{ target: TARGET, selectors: ['0xa9059cbb'] }],
          allowedRecipients: [RECIPIENT],
        },
      ],
      assetBudgets: [
        {
          chainId: 1,
          asset: TOKEN,
          maxGrossOutflow: '1000000',
          maxAllowanceExposure: '1000000',
        },
      ],
      maxGasWei: '10000000000000000',
      maxSlippageBps: 50,
      expiresAt: '2026-09-05T00:00:00+09:00',
    },
    finalStateGoals: [
      {
        kind: 'MIN_ASSET_BALANCE',
        chainId: 1,
        asset: TOKEN,
        account: RECIPIENT,
        minAmount: '1000000',
      },
    ],
  };
}

function mutate(path: readonly (string | number)[], value: unknown): Record<string, unknown> {
  const last = path.at(-1);
  if (last === undefined) throw new Error('mutation path must not be empty');
  const clone = structuredClone(validContract());
  let cursor: unknown = clone;
  for (const segment of path.slice(0, -1)) {
    cursor = (cursor as Record<string | number, unknown>)[segment];
  }
  (cursor as Record<string | number, unknown>)[last] = value;
  return clone;
}

describe('IntentContractSchema', () => {
  it('accepts a bounded intent contract', () => {
    expect(IntentContractSchema.safeParse(validContract()).success).toBe(true);
  });

  const invalidCases: ReadonlyArray<readonly [string, () => Record<string, unknown>]> = [
    ['unknown top-level field', () => ({ ...validContract(), extra: true })],
    ['wrong version', () => mutate(['version'], '1.0')],
    ['invalid account', () => mutate(['account'], 'not-an-address')],
    ['negative nonce', () => mutate(['nonce'], '-1')],
    ['non-canonical nonce', () => mutate(['nonce'], '01')],
    ['empty idempotency key', () => mutate(['idempotencyKey'], '')],
    ['zero chain id', () => mutate(['safety', 'chainScopes', 0, 'chainId'], 0)],
    ['empty target list', () => mutate(['safety', 'chainScopes', 0, 'allowedTargets'], [])],
    [
      'invalid target address',
      () => mutate(['safety', 'chainScopes', 0, 'allowedTargets', 0, 'target'], '0x1'),
    ],
    [
      'empty selector list',
      () => mutate(['safety', 'chainScopes', 0, 'allowedTargets', 0, 'selectors'], []),
    ],
    [
      'invalid selector',
      () => mutate(['safety', 'chainScopes', 0, 'allowedTargets', 0, 'selectors', 0], '0x12'),
    ],
    ['empty recipient list', () => mutate(['safety', 'chainScopes', 0, 'allowedRecipients'], [])],
    ['floating amount', () => mutate(['safety', 'assetBudgets', 0, 'maxGrossOutflow'], '1.5')],
    ['leading-zero amount', () => mutate(['safety', 'assetBudgets', 0, 'maxGrossOutflow'], '01')],
    ['number amount', () => mutate(['safety', 'assetBudgets', 0, 'maxGrossOutflow'], 10)],
    [
      'negative allowance',
      () => mutate(['safety', 'assetBudgets', 0, 'maxAllowanceExposure'], '-1'),
    ],
    ['slippage below zero', () => mutate(['safety', 'maxSlippageBps'], -1)],
    ['slippage above 10000', () => mutate(['safety', 'maxSlippageBps'], 10_001)],
    ['fractional slippage', () => mutate(['safety', 'maxSlippageBps'], 1.5)],
    ['offset-free expiry', () => mutate(['safety', 'expiresAt'], '2026-09-05T00:00:00')],
    ['empty final goals', () => mutate(['finalStateGoals'], [])],
    ['goal on unscoped chain', () => mutate(['finalStateGoals', 0, 'chainId'], 8453)],
    ['budget on unscoped chain', () => mutate(['safety', 'assetBudgets', 0, 'chainId'], 8453)],
    [
      'duplicate chain scope',
      () => {
        const contract = validContract();
        const safety = contract.safety as Record<string, unknown>;
        const scopes = safety.chainScopes as unknown[];
        scopes.push(structuredClone(scopes[0]));
        return contract;
      },
    ],
    [
      'duplicate asset budget',
      () => {
        const contract = validContract();
        const safety = contract.safety as Record<string, unknown>;
        const budgets = safety.assetBudgets as unknown[];
        budgets.push(structuredClone(budgets[0]));
        return contract;
      },
    ],
  ];

  it.each(invalidCases)('rejects %s', (_name, makeContract) => {
    expect(IntentContractSchema.safeParse(makeContract()).success).toBe(false);
  });

  it('defaults omitted allowance exposure to zero', () => {
    const contract = validContract();
    const safety = contract.safety as Record<string, unknown>;
    const [budget] = safety.assetBudgets as Record<string, unknown>[];
    if (!budget) throw new Error('test contract must contain an asset budget');
    delete budget.maxAllowanceExposure;

    const result = IntentContractSchema.parse(contract);
    expect(result.safety.assetBudgets[0]?.maxAllowanceExposure).toBe('0');
  });

  it('accepts all four final-state goal variants', () => {
    const contract = validContract();
    contract.finalStateGoals = [
      ...(contract.finalStateGoals as unknown[]),
      { kind: 'MAX_DEBT', chainId: 1, asset: TOKEN, account: ACCOUNT, maxAmount: '0' },
      { kind: 'OWNER_IS', chainId: 1, collection: TOKEN, tokenId: '7', owner: ACCOUNT },
      {
        kind: 'NO_RESIDUAL_ALLOWANCE',
        chainId: 1,
        asset: TOKEN,
        owner: ACCOUNT,
        spender: TARGET,
      },
    ];
    expect(IntentContractSchema.safeParse(contract).success).toBe(true);
  });

  it('exports a closed Draft 2020-12 JSON Schema', () => {
    const jsonSchema = createIntentContractJsonSchema();
    expect(jsonSchema).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
    });
  });
});
