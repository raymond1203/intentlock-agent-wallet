import type { EconomicEffect } from '../domain/action-ir.js';

/** Minimum starting balances at every ordered prefix, not merely the net final debit. */
export function minimumPrefixFunding(
  account: string,
  effects: readonly EconomicEffect[],
): Map<string, bigint> {
  const balances = new Map<string, bigint>();
  const needed = new Map<string, bigint>();
  const owner = account.toLowerCase();
  const change = (chain: number, asset: string, amount: bigint) => {
    const key = `${String(chain)}:${asset.toLowerCase()}`;
    const balance = (balances.get(key) ?? 0n) + amount;
    balances.set(key, balance);
    if (-balance > (needed.get(key) ?? 0n)) needed.set(key, -balance);
  };
  for (const e of effects) {
    if (e.kind === 'TRANSFER') {
      if (e.from.toLowerCase() === owner) change(e.chainId, e.asset, -BigInt(e.amount));
      if (e.to.toLowerCase() === owner) change(e.chainId, e.asset, BigInt(e.amount));
    } else if (e.kind === 'SWAP' && e.recipient.toLowerCase() === owner) {
      change(e.chainId, e.assetOut, BigInt(e.minAmountOut));
    } else if (e.kind === 'BRIDGE') {
      change(e.sourceChainId, e.asset, -BigInt(e.amount));
      if (e.recipient.toLowerCase() === owner && e.destinationAsset && e.minAmountOut)
        change(e.destinationChainId, e.destinationAsset, BigInt(e.minAmountOut));
    }
  }
  return needed;
}
