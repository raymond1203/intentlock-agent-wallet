import { describe, expect, it } from 'vitest';

import {
  ActionIRSchema,
  aggregateEffects,
  createActionIrJsonSchema,
  flattenEffects,
  type CallFrame,
  type EconomicEffect,
} from '../src/domain/action-ir.js';

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const TOKEN = '0x3333333333333333333333333333333333333333';
const TARGET = '0x4444444444444444444444444444444444444444';
const HASH = `0x${'1'.repeat(64)}`;

const provenance = {
  callPath: [0],
  target: TARGET,
  selector: '0xa9059cbb',
  source: 'CALLDATA' as const,
};

function transfer(id: string, from: string, to: string, amount: string): EconomicEffect {
  return {
    id,
    phase: 'PREDICTED',
    provenance,
    kind: 'TRANSFER',
    chainId: 1,
    asset: TOKEN,
    from,
    to,
    amount,
  };
}

describe('ActionIR', () => {
  it('separates gross outflow from net delta', () => {
    const totals = aggregateEffects(
      [transfer('out', ACCOUNT, RECIPIENT, '10'), transfer('in', RECIPIENT, ACCOUNT, '4')],
      ACCOUNT,
    );
    const key = `1:${TOKEN.toLowerCase()}`;
    expect(totals.grossOutflow.get(key)).toBe(10n);
    expect(totals.netDelta.get(key)).toBe(-6n);
  });

  it('records approval exposure independently from immediate outflow', () => {
    const totals = aggregateEffects(
      [
        {
          id: 'approval',
          phase: 'PREDICTED',
          provenance,
          kind: 'APPROVAL',
          chainId: 1,
          asset: TOKEN,
          owner: ACCOUNT,
          spender: TARGET,
          amount: '99',
        },
      ],
      ACCOUNT,
    );
    const key = `1:${TOKEN.toLowerCase()}`;
    expect(totals.allowanceExposure.get(key)).toBe(99n);
    expect(totals.grossOutflow.get(key)).toBeUndefined();
  });

  it('marks unknown effects fail-closed input', () => {
    const totals = aggregateEffects(
      [
        {
          id: 'unknown',
          phase: 'PREDICTED',
          provenance,
          kind: 'UNKNOWN',
          chainId: 1,
          reason: 'selector not supported',
        },
      ],
      ACCOUNT,
    );
    expect(totals.hasUnknown).toBe(true);
  });

  it('flattens effects with call-tree provenance order', () => {
    const child: CallFrame = {
      chainId: 1,
      target: TARGET,
      selector: '0xa9059cbb',
      valueWei: '0',
      calldataHash: HASH,
      decodeStatus: 'COMPLETE',
      effects: [transfer('child', ACCOUNT, RECIPIENT, '1')],
      children: [],
    };
    const root = {
      ...child,
      effects: [transfer('root', ACCOUNT, RECIPIENT, '2')],
      children: [child],
    };
    expect(flattenEffects(root).map((effect) => effect.id)).toEqual(['root', 'child']);
  });

  it('represents predicted and observed phases separately', () => {
    const predicted = transfer('predicted', ACCOUNT, RECIPIENT, '1');
    const observed = { ...predicted, id: 'observed', phase: 'OBSERVED' as const };
    expect(
      ActionIRSchema.safeParse({
        version: '0.1',
        intentHash: HASH,
        root: {
          chainId: 1,
          target: TARGET,
          selector: '0xa9059cbb',
          valueWei: '0',
          calldataHash: HASH,
          decodeStatus: 'COMPLETE',
          effects: [predicted, observed],
          children: [],
        },
      }).success,
    ).toBe(true);
  });

  it('rejects unknown ActionIR fields', () => {
    expect(
      ActionIRSchema.safeParse({ version: '0.1', intentHash: HASH, root: {}, extra: true }).success,
    ).toBe(false);
  });

  it('exports a Draft 2020-12 schema', () => {
    expect(createActionIrJsonSchema()).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
    });
  });
});
