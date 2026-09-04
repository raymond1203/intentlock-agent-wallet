import { describe, expect, it } from 'vitest';
import type { EconomicEffect } from '../../src/domain/action-ir.js';
import { minimumPrefixFunding } from '../../src/benchmark/execution-funding.js';
const owner = `0x${'11'.repeat(20)}`,
  pool = `0x${'22'.repeat(20)}`,
  asset = `0x${'33'.repeat(20)}`;
function transfer(amount: string, from = owner, to = pool): EconomicEffect {
  return {
    kind: 'TRANSFER',
    id: 'e',
    phase: 'PREDICTED',
    provenance: { source: 'CALLDATA', target: asset, selector: '0xa9059cbb', callPath: [] },
    chainId: 1,
    asset,
    amount,
    from,
    to,
  };
}
describe('execution prefix funding', () => {
  it('funds a supply before a later withdrawal, not just the net debit', () => {
    expect(
      minimumPrefixFunding(owner, [transfer('100'), transfer('50', pool, owner)]).get(`1:${asset}`),
    ).toBe(100n);
  });
  it('does not pre-fund a repayment already funded by a preceding borrow', () => {
    expect(minimumPrefixFunding(owner, [transfer('100', pool, owner), transfer('100')]).size).toBe(
      0,
    );
  });
  it('counts the entire accepted prefix and the temporary requirement of a self-transfer', () => {
    expect(minimumPrefixFunding(owner, [transfer('40'), transfer('60')]).get(`1:${asset}`)).toBe(
      100n,
    );
    expect(minimumPrefixFunding(owner, [transfer('9', owner, owner)]).get(`1:${asset}`)).toBe(9n);
  });
});
