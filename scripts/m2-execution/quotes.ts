import {
  decodeFunctionData,
  encodePacked,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
} from 'viem';
import { SWAP_ROUTER_02_ABI } from '../../src/effects/swap-decoder.js';
import type { PinnedQuoteReference } from '../../src/benchmark/scenario.js';
import { fixtureAddress } from '../extended-benchmark.js';
import type { ForkRuntime } from './runtime.js';

// Official deployment mapping checked 2026-09-03; code identity is recorded at the frozen block.
const QUOTER: Record<number, Address> = {
  1: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
  8453: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
};
const ABI = parseAbi([
  'function quoteExactInput(bytes path,uint256 amountIn) returns (uint256 amountOut,uint160[] sqrtPriceX96AfterList,uint32[] initializedTicksCrossedList,uint256 gasEstimate)',
  'function getPool(address tokenA,address tokenB,uint24 fee) view returns (address)',
]);

export interface ObservedPinnedQuote {
  chainId: number;
  blockNumber: string;
  blockHash: string;
  quoter: { address: string; codehash: string };
  pools: { address: string; codehash: string; fee: number }[];
  path: string;
  amountIn: string;
  authoredMinimum: string;
  quotedAmountOut: string;
}

export function assertPinnedQuote(
  observed: ObservedPinnedQuote,
  references: readonly PinnedQuoteReference[],
): PinnedQuoteReference {
  const reference = references.find(
    (candidate) =>
      candidate.chainId === observed.chainId &&
      candidate.path.toLowerCase() === observed.path.toLowerCase() &&
      candidate.amountIn === observed.amountIn,
  );
  if (!reference) throw new Error('swap is missing its authored pinned quote reference');
  const samePools =
    reference.pools.length === observed.pools.length &&
    reference.pools.every((pool, index) => {
      const actual = observed.pools[index];
      return (
        actual !== undefined &&
        pool.address.toLowerCase() === actual.address.toLowerCase() &&
        pool.codehash.toLowerCase() === actual.codehash.toLowerCase() &&
        pool.fee === actual.fee
      );
    });
  if (
    reference.blockNumber.toString() !== observed.blockNumber ||
    reference.blockHash.toLowerCase() !== observed.blockHash.toLowerCase() ||
    reference.quoter.address.toLowerCase() !== observed.quoter.address.toLowerCase() ||
    reference.quoter.codehash.toLowerCase() !== observed.quoter.codehash.toLowerCase() ||
    reference.quotedAmountOut !== observed.quotedAmountOut ||
    reference.minAmountOut !== observed.authoredMinimum ||
    !samePools
  )
    throw new Error('runtime QuoterV2 observation disagrees with the authored pinned quote');
  return reference;
}

export async function readPinnedQuote(runtime: ForkRuntime, data: Hex) {
  const chainId = runtime.fork.config.chainId;
  const address = QUOTER[chainId];
  if (!address) throw new Error('unsupported quote chain');
  const decoded = decodeFunctionData({ abi: SWAP_ROUTER_02_ABI, data });
  if (decoded.functionName !== 'exactInputSingle' && decoded.functionName !== 'exactInput')
    throw new Error('unsupported quote selector');
  const params = decoded.args[0];
  const path =
    'path' in params
      ? params.path
      : encodePacked(
          ['address', 'uint24', 'address'],
          [params.tokenIn, params.fee, params.tokenOut],
        );
  const blockNumber = BigInt(runtime.fork.config.forkBlockNumber);
  const code = await runtime.client.getCode({ address, blockNumber });
  if (!code || code === '0x') throw new Error('missing quoter at pin');
  const quote = await runtime.client.simulateContract({
    address,
    abi: ABI,
    functionName: 'quoteExactInput',
    args: [path, params.amountIn],
    blockNumber,
  });
  const pools = [];
  for (let cursor = 2; cursor + 86 <= path.length; cursor += 46) {
    const tokenA: Address = `0x${path.slice(cursor, cursor + 40)}`;
    const fee = Number.parseInt(path.slice(cursor + 40, cursor + 46), 16);
    const tokenB: Address = `0x${path.slice(cursor + 46, cursor + 86)}`;
    const pool = await runtime.client.readContract({
      address: fixtureAddress(chainId, 'uniswapV3Factory'),
      abi: ABI,
      functionName: 'getPool',
      args: [tokenA, tokenB, fee],
      blockNumber,
    });
    const poolCode = await runtime.client.getCode({ address: pool, blockNumber });
    if (!poolCode || poolCode === '0x') throw new Error('missing route pool at pin');
    pools.push({ address: pool, codehash: keccak256(poolCode), tokenA, tokenB, fee });
  }
  return {
    chainId,
    blockNumber: blockNumber.toString(),
    blockHash: runtime.fingerprint.blockHash,
    quoter: { address, codehash: keccak256(code) },
    pools,
    path,
    amountIn: params.amountIn.toString(),
    authoredMinimum: params.amountOutMinimum.toString(),
    quotedAmountOut: quote.result[0].toString(),
    sourceCalldataHash: keccak256(data),
    // This is a diagnostic, not authorization to change the user's minimum.
    authoredSlippageBps:
      quote.result[0] === 0n
        ? null
        : (((quote.result[0] - params.amountOutMinimum) * 10_000n) / quote.result[0]).toString(),
  };
}
