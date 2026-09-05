import { describe, expect, it } from 'vitest';
import { fixtureAddress } from '../../scripts/extended-benchmark.js';
import { lendingObservationToken } from '../../scripts/m2-execution/lending.js';

const manifest = {
  lendingReserves: {
    '1': {
      usdc: {
        aToken: '0x0000000000000000000000000000000000000001',
        variableDebtToken: '0x0000000000000000000000000000000000000002',
      },
    },
    '8453': {
      usdc: {
        aToken: '0x0000000000000000000000000000000000000003',
        variableDebtToken: '0x0000000000000000000000000000000000000004',
      },
    },
  },
} as const;

describe('lending observation attribution', () => {
  it('selects the pinned reserve token only for the pinned Aave pool', () => {
    expect(
      lendingObservationToken(
        manifest,
        1,
        fixtureAddress(1, 'aaveV3Pool'),
        fixtureAddress(1, 'usdc'),
        'POSITION',
      ),
    ).toBe(manifest.lendingReserves['1'].usdc.aToken);
    expect(
      lendingObservationToken(
        manifest,
        8453,
        fixtureAddress(8453, 'aaveV3Pool'),
        fixtureAddress(8453, 'usdc'),
        'DEBT',
      ),
    ).toBe(manifest.lendingReserves['8453'].usdc.variableDebtToken);
  });

  it('fails closed for a different protocol, chain, asset, or missing reserve', () => {
    expect(() =>
      lendingObservationToken(
        manifest,
        1,
        '0x00000000000000000000000000000000000000ff',
        fixtureAddress(1, 'usdc'),
        'DEBT',
      ),
    ).toThrow('unsupported lending observation protocol');
    expect(() =>
      lendingObservationToken(
        manifest,
        10,
        '0x00000000000000000000000000000000000000ff',
        fixtureAddress(1, 'usdc'),
        'DEBT',
      ),
    ).toThrow('unsupported lending observation chain');
    expect(() =>
      lendingObservationToken(
        manifest,
        1,
        fixtureAddress(1, 'aaveV3Pool'),
        '0x00000000000000000000000000000000000000ff',
        'DEBT',
      ),
    ).toThrow('unsupported lending observation asset');
    expect(() =>
      lendingObservationToken(
        { ...manifest, lendingReserves: { ...manifest.lendingReserves, '1': {} } },
        1,
        fixtureAddress(1, 'aaveV3Pool'),
        fixtureAddress(1, 'usdc'),
        'DEBT',
      ),
    ).toThrow('missing lending reserve manifest entry');
  });
});
