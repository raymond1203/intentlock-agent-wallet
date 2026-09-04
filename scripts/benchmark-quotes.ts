import { readFileSync } from 'node:fs';
import { z } from 'zod';

import {
  PinnedQuoteReferenceSchema,
  type PinnedQuoteReference,
} from '../src/benchmark/scenario.js';

const AddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const Bytes32Schema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
const RouteSchema = z
  .object({
    routeId: z.string().min(1),
    chainId: z.number().int().positive(),
    blockNumber: z.number().int().positive(),
    blockHash: Bytes32Schema,
    quoter: z.object({ address: AddressSchema, codehash: Bytes32Schema }).strict(),
    pools: z
      .array(
        z
          .object({
            address: AddressSchema,
            codehash: Bytes32Schema,
            fee: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .min(1),
    path: z.string().regex(/^0x[a-fA-F0-9]+$/),
    quotes: z.record(z.string().regex(/^(0|[1-9]\d*)$/), z.string().regex(/^(0|[1-9]\d*)$/)),
  })
  .strict();

const manifest = z
  .object({
    schemaVersion: z.literal('0.1'),
    datasetVersion: z.literal('0.3.0'),
    source: z.literal('PINNED_QUOTER_V2'),
    maxSlippageBps: z.number().int().min(0).max(10_000),
    routes: z.array(RouteSchema).min(1),
  })
  .strict()
  .parse(JSON.parse(readFileSync('benchmark/fixtures/swap-quotes-v0.3.json', 'utf8')));

export const PINNED_MAX_SLIPPAGE_BPS = manifest.maxSlippageBps;

/** Integer ceiling preserves the stated maximum instead of widening it through round-down. */
export function minimumOutForSlippage(
  quotedAmountOut: bigint,
  maxSlippageBps = PINNED_MAX_SLIPPAGE_BPS,
): bigint {
  if (quotedAmountOut <= 0n) throw new Error('pinned quote must be positive');
  if (!Number.isInteger(maxSlippageBps) || maxSlippageBps < 0 || maxSlippageBps > 10_000)
    throw new Error('invalid slippage bound');
  const numerator = quotedAmountOut * BigInt(10_000 - maxSlippageBps);
  return (numerator + 9_999n) / 10_000n;
}

export function pinnedQuote(chainId: number, path: string, amountIn: bigint): PinnedQuoteReference {
  const route = manifest.routes.find(
    (candidate) =>
      candidate.chainId === chainId && candidate.path.toLowerCase() === path.toLowerCase(),
  );
  if (!route) throw new Error(`missing pinned quote route for chain ${String(chainId)}`);
  const quotedAmountOut = route.quotes[amountIn.toString()];
  if (!quotedAmountOut)
    throw new Error(`missing pinned quote for ${route.routeId}:${amountIn.toString()}`);
  return PinnedQuoteReferenceSchema.parse({
    routeId: route.routeId,
    chainId: route.chainId,
    blockNumber: route.blockNumber,
    blockHash: route.blockHash,
    quoter: route.quoter,
    pools: route.pools,
    path: route.path,
    amountIn: amountIn.toString(),
    quotedAmountOut,
    maxSlippageBps: manifest.maxSlippageBps,
    minAmountOut: minimumOutForSlippage(BigInt(quotedAmountOut)).toString(),
  });
}
