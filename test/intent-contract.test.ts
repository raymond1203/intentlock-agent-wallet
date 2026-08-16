import { describe, expect, it } from 'vitest';

import {
  createIntentContractJsonSchema,
  IntentContractSchema,
} from '../src/domain/intent-contract.js';

describe('IntentContractSchema', () => {
  it('accepts a bounded intent contract', () => {
    const result = IntentContractSchema.safeParse({
      version: '0.1',
      chainId: 1,
      allowedTargets: ['0x1111111111111111111111111111111111111111'],
      assetBudgets: [{ asset: 'native', maxGrossOutflow: '1000000000000000000' }],
      maxGasWei: '10000000000000000',
      expiresAt: '2026-09-05T00:00:00+09:00',
      nonce: 'scenario-001',
    });

    expect(result.success).toBe(true);
  });

  it('rejects an invalid target address', () => {
    const result = IntentContractSchema.safeParse({
      version: '0.1',
      chainId: 1,
      allowedTargets: ['not-an-address'],
      assetBudgets: [{ asset: 'native', maxGrossOutflow: '1' }],
      maxGasWei: '1',
      expiresAt: '2026-09-05T00:00:00+09:00',
      nonce: 'scenario-002',
    });

    expect(result.success).toBe(false);
  });

  it('exports a closed JSON Schema contract', () => {
    const jsonSchema = createIntentContractJsonSchema();

    expect(jsonSchema).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
    });
    expect(jsonSchema.required).toEqual(
      expect.arrayContaining([
        'version',
        'chainId',
        'allowedTargets',
        'assetBudgets',
        'maxGasWei',
        'expiresAt',
        'nonce',
      ]),
    );
  });
});
