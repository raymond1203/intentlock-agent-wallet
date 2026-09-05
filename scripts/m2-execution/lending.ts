import type { Address } from 'viem';
import { fixtureAddress } from '../extended-benchmark.js';

export interface LendingReserveManifest {
  lendingReserves: {
    '1': Record<string, { aToken: Address; variableDebtToken: Address }>;
    '8453': Record<string, { aToken: Address; variableDebtToken: Address }>;
  };
}

export function lendingObservationToken(
  manifest: LendingReserveManifest,
  chainId: number,
  protocol: string,
  asset: string,
  field: 'DEBT' | 'POSITION',
): Address {
  if (chainId !== 1 && chainId !== 8453) throw new Error('unsupported lending observation chain');
  if (protocol.toLowerCase() !== fixtureAddress(chainId, 'aaveV3Pool').toLowerCase())
    throw new Error('unsupported lending observation protocol');
  const reserveKey = ['usdc', 'weth'].find(
    (name) => fixtureAddress(chainId, name).toLowerCase() === asset.toLowerCase(),
  );
  if (!reserveKey) throw new Error('unsupported lending observation asset');
  const reserve = manifest.lendingReserves[String(chainId) as '1' | '8453'][reserveKey];
  if (!reserve) throw new Error('missing lending reserve manifest entry');
  return field === 'DEBT' ? reserve.variableDebtToken : reserve.aToken;
}
