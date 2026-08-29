import {
  decodeAbiParameters,
  decodeFunctionData,
  keccak256,
  parseAbi,
  parseAbiParameters,
  type Hex,
} from 'viem';

import { flattenEffects, type CallFrame, type EconomicEffect } from '../domain/action-ir.js';
import { decodeErc20Calldata } from './erc20-decoder.js';
import { decodePermit2Calldata } from './permit2-decoder.js';
import { decodeSwapRouterCalldata, SWAP_ROUTER_02_ABI } from './swap-decoder.js';
import { type DecodeContext, selectorFromData, unknownResult } from './types.js';

export const ERC7821_ABI = parseAbi([
  'function execute(bytes32 mode, bytes executionData) payable',
]);
const ERC7821_CALLS = parseAbiParameters('(address to, uint256 value, bytes data)[]');
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export type DecoderContractKind = 'ERC20' | 'PERMIT2' | 'SWAP_ROUTER_02' | 'ERC7821';

export interface DecoderContract {
  kind: DecoderContractKind;
  codehash?: `0x${string}`;
}

export interface BatchDecoderOptions {
  contracts: Readonly<Record<string, DecoderContract>>;
  observedCodehashes?: Readonly<Record<string, `0x${string}`>>;
  requireCodehash?: boolean;
  maxDepth?: number;
  maxCalls?: number;
  maxCalldataBytes?: number;
  quotedAmountOut?: string;
}

export interface BatchDecodeResult {
  status: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';
  root: CallFrame;
  effects: EconomicEffect[];
}

interface DecodeBudget {
  calls: number;
}

function unknownFrame(context: DecodeContext, reason: string): CallFrame {
  const result = unknownResult(context, reason);
  return {
    chainId: context.chainId,
    target: context.target,
    selector: selectorFromData(context.data),
    valueWei: context.valueWei ?? '0',
    calldataHash: keccak256(context.data),
    ...(context.codehash ? { codehash: context.codehash } : {}),
    decodeStatus: 'UNKNOWN',
    effects: result.effects,
    children: [],
  };
}

function frame(
  context: DecodeContext,
  effects: EconomicEffect[],
  children: CallFrame[] = [],
): CallFrame {
  const decodeStatus = children.some((child) => child.decodeStatus !== 'COMPLETE')
    ? 'PARTIAL'
    : 'COMPLETE';
  return {
    chainId: context.chainId,
    target: context.target,
    selector: selectorFromData(context.data),
    valueWei: context.valueWei ?? '0',
    calldataHash: keccak256(context.data),
    ...(context.codehash ? { codehash: context.codehash } : {}),
    decodeStatus,
    effects,
    children,
  };
}

function normalizedRegistry(options: BatchDecoderOptions): Map<string, DecoderContract> {
  return new Map(
    Object.entries(options.contracts).map(([address, contract]) => [
      address.toLowerCase(),
      contract,
    ]),
  );
}

function observedCodehash(
  options: BatchDecoderOptions,
  address: string,
): `0x${string}` | undefined {
  const entry = Object.entries(options.observedCodehashes ?? {}).find(
    ([candidate]) => candidate.toLowerCase() === address.toLowerCase(),
  );
  return entry?.[1];
}

function isSupported7821Mode(mode: Hex): boolean {
  return mode.startsWith('0x01000000000000000000') || mode.startsWith('0x01000000000078210001');
}

function decodeRouter(
  context: DecodeContext,
  options: BatchDecoderOptions,
  registry: Map<string, DecoderContract>,
  budget: DecodeBudget,
  depth: number,
  inheritedDeadline?: string,
): CallFrame {
  let decoded: ReturnType<typeof decodeFunctionData>;
  try {
    decoded = decodeFunctionData({ abi: SWAP_ROUTER_02_ABI, data: context.data });
  } catch {
    return unknownFrame(context, 'unsupported or malformed SwapRouter02 calldata');
  }
  if (decoded.functionName === 'exactInputSingle' || decoded.functionName === 'exactInput') {
    const result = decodeSwapRouterCalldata(context, options.quotedAmountOut, inheritedDeadline);
    return result.status === 'COMPLETE'
      ? frame(context, result.effects)
      : unknownFrame(context, 'unsupported SwapRouter02 swap');
  }
  if (decoded.functionName !== 'multicall') {
    return unknownFrame(context, 'unsupported SwapRouter02 function');
  }

  const args: readonly unknown[] = decoded.args;
  const callsCandidate = args.length === 1 ? args[0] : args[1];
  const first = args[0];
  const deadline = typeof first === 'bigint' ? first.toString() : inheritedDeadline;
  if (
    !Array.isArray(callsCandidate) ||
    !callsCandidate.every(
      (candidate): candidate is Hex =>
        typeof candidate === 'string' && /^0x[0-9a-fA-F]*$/.test(candidate),
    )
  ) {
    return unknownFrame(context, 'malformed router multicall');
  }
  const calls: readonly Hex[] = callsCandidate;
  const children = calls.map((data, index) =>
    decodeFrame(
      {
        ...context,
        data,
        callPath: [...(context.callPath ?? []), index],
      },
      options,
      registry,
      budget,
      depth + 1,
      deadline,
    ),
  );
  return frame(context, [], children);
}

function decode7821(
  context: DecodeContext,
  options: BatchDecoderOptions,
  registry: Map<string, DecoderContract>,
  budget: DecodeBudget,
  depth: number,
): CallFrame {
  try {
    const decoded = decodeFunctionData({ abi: ERC7821_ABI, data: context.data });
    const [mode, executionData] = decoded.args;
    if (!isSupported7821Mode(mode)) return unknownFrame(context, 'unsupported ERC-7821 mode');
    const [calls] = decodeAbiParameters(ERC7821_CALLS, executionData);
    const children = calls.map((call, index) => {
      const target = call.to.toLowerCase() === ZERO_ADDRESS ? context.target : call.to;
      return decodeFrame(
        {
          chainId: context.chainId,
          target,
          caller: context.caller,
          data: call.data,
          valueWei: call.value.toString(),
          callPath: [...(context.callPath ?? []), index],
        },
        options,
        registry,
        budget,
        depth + 1,
      );
    });
    return frame(context, [], children);
  } catch {
    return unknownFrame(context, 'malformed ERC-7821 executionData');
  }
}

function decodeFrame(
  initialContext: DecodeContext,
  options: BatchDecoderOptions,
  registry: Map<string, DecoderContract>,
  budget: DecodeBudget,
  depth: number,
  inheritedDeadline?: string,
): CallFrame {
  budget.calls += 1;
  if (depth > (options.maxDepth ?? 4)) {
    return unknownFrame(initialContext, 'maximum decode depth exceeded');
  }
  if (budget.calls > (options.maxCalls ?? 32)) {
    return unknownFrame(initialContext, 'maximum decoded call count exceeded');
  }
  if ((initialContext.data.length - 2) / 2 > (options.maxCalldataBytes ?? 131_072)) {
    return unknownFrame(initialContext, 'maximum calldata size exceeded');
  }

  const contract = registry.get(initialContext.target.toLowerCase());
  if (!contract) return unknownFrame(initialContext, 'target has no pinned decoder');
  const actualCodehash = observedCodehash(options, initialContext.target);
  const context = {
    ...initialContext,
    ...(actualCodehash ? { codehash: actualCodehash } : {}),
  };
  if (
    contract.codehash &&
    ((actualCodehash && actualCodehash.toLowerCase() !== contract.codehash.toLowerCase()) ||
      (options.requireCodehash && !actualCodehash))
  ) {
    return unknownFrame(context, 'codehash does not match pinned decoder');
  }

  switch (contract.kind) {
    case 'ERC20': {
      const result = decodeErc20Calldata(context);
      return result.status === 'COMPLETE'
        ? frame(context, result.effects)
        : unknownFrame(context, 'ERC-20 decoder failed');
    }
    case 'PERMIT2': {
      const result = decodePermit2Calldata(context);
      return result.status === 'COMPLETE'
        ? frame(context, result.effects)
        : unknownFrame(context, 'Permit2 decoder failed');
    }
    case 'SWAP_ROUTER_02':
      return decodeRouter(context, options, registry, budget, depth, inheritedDeadline);
    case 'ERC7821':
      return decode7821(context, options, registry, budget, depth);
  }
}

export function decodeBatchCalldata(
  context: DecodeContext,
  options: BatchDecoderOptions,
): BatchDecodeResult {
  const root = decodeFrame(context, options, normalizedRegistry(options), { calls: 0 }, 0);
  return { status: root.decodeStatus, root, effects: flattenEffects(root) };
}
