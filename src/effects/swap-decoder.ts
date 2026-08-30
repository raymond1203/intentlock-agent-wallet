import { decodeFunctionData, parseAbi } from 'viem';

import type { EconomicEffect } from '../domain/action-ir.js';
import {
  type DecodeContext,
  type EffectDecodeResult,
  selectorFromData,
  unknownResult,
} from './types.js';

export const SWAP_ROUTER_02_ABI = parseAbi([
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
  'function exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum) params) payable returns (uint256 amountOut)',
  'function multicall(bytes[] data) payable returns (bytes[] results)',
  'function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)',
  'function multicall(bytes32 previousBlockhash, bytes[] data) payable returns (bytes[] results)',
]);

function pathTokens(path: `0x${string}`): readonly [`0x${string}`, `0x${string}`] | undefined {
  const body = path.slice(2);
  if (body.length < 86 || (body.length - 40) % 46 !== 0) return undefined;
  return [`0x${body.slice(0, 40)}`, `0x${body.slice(-40)}`];
}

export function decodeSwapRouterCalldata(
  context: DecodeContext,
  quotedAmountOut?: string,
  inheritedDeadline?: string,
): EffectDecodeResult {
  try {
    const decoded = decodeFunctionData({ abi: SWAP_ROUTER_02_ABI, data: context.data });
    if (decoded.functionName !== 'exactInputSingle' && decoded.functionName !== 'exactInput') {
      return unknownResult(context, 'router batch requires recursive batch decoder');
    }
    let tokens: readonly [`0x${string}`, `0x${string}`] | undefined;
    let amountIn: bigint;
    let amountOutMinimum: bigint;
    let recipient: `0x${string}`;
    if (decoded.functionName === 'exactInputSingle') {
      const [params] = decoded.args;
      tokens = [params.tokenIn, params.tokenOut];
      amountIn = params.amountIn;
      amountOutMinimum = params.amountOutMinimum;
      recipient = params.recipient;
    } else {
      const [params] = decoded.args;
      tokens = pathTokens(params.path);
      amountIn = params.amountIn;
      amountOutMinimum = params.amountOutMinimum;
      recipient = params.recipient;
    }
    if (!tokens) return unknownResult(context, 'malformed Uniswap v3 path');

    const provenance = {
      callPath: [...(context.callPath ?? [])],
      target: context.target,
      selector: selectorFromData(context.data),
      ...(context.codehash ? { codehash: context.codehash } : {}),
      source: 'CALLDATA' as const,
    };
    const suffix = (context.callPath ?? []).join('.') || 'root';
    const effects: EconomicEffect[] = [
      {
        id: `swap-input:${suffix}`,
        phase: 'PREDICTED',
        provenance,
        kind: 'TRANSFER',
        chainId: context.chainId,
        asset: tokens[0],
        from: context.caller,
        to: context.target,
        amount: amountIn.toString(),
      },
      {
        id: `swap:${suffix}`,
        phase: 'PREDICTED',
        provenance,
        kind: 'SWAP',
        chainId: context.chainId,
        assetIn: tokens[0],
        assetOut: tokens[1],
        amountIn: amountIn.toString(),
        ...(quotedAmountOut ? { quotedAmountOut } : {}),
        minAmountOut: amountOutMinimum.toString(),
        recipient,
        ...(inheritedDeadline ? { deadline: inheritedDeadline } : {}),
      },
    ];
    return { status: 'COMPLETE', effects };
  } catch {
    return unknownResult(context, 'unsupported or malformed SwapRouter02 calldata');
  }
}
