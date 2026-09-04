import { describe, expect, it } from 'vitest';
import type { EconomicEffect } from '../../src/domain/action-ir.js';
import { classifyReceiptEffects } from '../../src/oracle/receipt-accounting.js';

const owner = `0x${'11'.repeat(20)}`;
const zero = `0x${'00'.repeat(20)}`;
const aToken = `0x${'22'.repeat(20)}`;
const debt = `0x${'33'.repeat(20)}`;
const reserve = [{ chainId: 1, aToken, variableDebtToken: debt }];
function transfer(asset = aToken, from = owner, to = zero, chainId = 1): EconomicEffect {
  return {
    id: 'event',
    phase: 'OBSERVED',
    provenance: { source: 'RECEIPT', callPath: [], target: asset, selector: '0xa9059cbb' },
    kind: 'TRANSFER',
    chainId,
    asset,
    from,
    to,
    amount: '7',
  };
}
describe('receipt reserve accounting', () => {
  it('separates only pinned reserve mint/burn events, retaining their evidence', () => {
    const effects = [transfer(), transfer(debt, zero, owner)];
    expect(classifyReceiptEffects(effects, reserve)).toEqual({
      economicFlows: [],
      positionTokenEvents: effects,
    });
  });
  it('does not hide collateral transfers, unknown asset burns, or another chain', () => {
    const effects = [
      transfer(aToken, owner, debt),
      transfer(owner),
      transfer(aToken, owner, zero, 8453),
    ];
    expect(classifyReceiptEffects(effects, reserve)).toEqual({
      economicFlows: effects,
      positionTokenEvents: [],
    });
  });
});
