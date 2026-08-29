import { decodeEventLog, decodeFunctionData, parseAbi, type Hex } from 'viem';

import type { EconomicEffect } from '../domain/action-ir.js';
import {
  selectorFromData,
  type DecodeContext,
  type EffectDecodeResult,
  unknownResult,
} from './types.js';

export const ERC20_ABI = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
]);

function provenance(context: DecodeContext) {
  return {
    callPath: [...(context.callPath ?? [])],
    target: context.target,
    selector: selectorFromData(context.data),
    ...(context.codehash ? { codehash: context.codehash } : {}),
    source: context.phase === 'OBSERVED' ? ('RECEIPT' as const) : ('CALLDATA' as const),
  };
}

export function decodeErc20Calldata(context: DecodeContext): EffectDecodeResult {
  try {
    const decoded = decodeFunctionData({ abi: ERC20_ABI, data: context.data });
    let effect: EconomicEffect;
    switch (decoded.functionName) {
      case 'transfer': {
        const [to, amount] = decoded.args;
        effect = {
          id: `erc20-transfer:${(context.callPath ?? []).join('.') || 'root'}`,
          phase: context.phase ?? 'PREDICTED',
          provenance: provenance(context),
          kind: 'TRANSFER',
          chainId: context.chainId,
          asset: context.target,
          from: context.caller,
          to,
          amount: amount.toString(),
        };
        break;
      }
      case 'transferFrom': {
        const [from, to, amount] = decoded.args;
        effect = {
          id: `erc20-transfer-from:${(context.callPath ?? []).join('.') || 'root'}`,
          phase: context.phase ?? 'PREDICTED',
          provenance: provenance(context),
          kind: 'TRANSFER',
          chainId: context.chainId,
          asset: context.target,
          from,
          to,
          amount: amount.toString(),
        };
        break;
      }
      case 'approve': {
        const [spender, amount] = decoded.args;
        effect = {
          id: `erc20-approval:${(context.callPath ?? []).join('.') || 'root'}`,
          phase: context.phase ?? 'PREDICTED',
          provenance: provenance(context),
          kind: 'APPROVAL',
          chainId: context.chainId,
          asset: context.target,
          owner: context.caller,
          spender,
          amount: amount.toString(),
        };
        break;
      }
    }
    return { status: 'COMPLETE', effects: [effect] };
  } catch {
    return unknownResult(context, 'unsupported or malformed ERC-20 calldata');
  }
}

export interface Erc20LogInput {
  chainId: number;
  token: `0x${string}`;
  topics: readonly Hex[];
  data: Hex;
  logIndex: number;
  codehash?: `0x${string}`;
}

export function decodeErc20Log(input: Erc20LogInput): EffectDecodeResult {
  const context: DecodeContext = {
    chainId: input.chainId,
    target: input.token,
    caller: input.token,
    data: '0x00000000',
    ...(input.codehash ? { codehash: input.codehash } : {}),
    callPath: [input.logIndex],
    phase: 'OBSERVED',
  };
  try {
    const decoded = decodeEventLog({
      abi: ERC20_ABI,
      data: input.data,
      topics: input.topics as [signature: Hex, ...args: Hex[]],
      strict: true,
    });
    if (decoded.eventName === 'Transfer') {
      return {
        status: 'COMPLETE',
        effects: [
          {
            id: `erc20-transfer-log:${String(input.logIndex)}`,
            phase: 'OBSERVED',
            provenance: provenance(context),
            kind: 'TRANSFER',
            chainId: input.chainId,
            asset: input.token,
            from: decoded.args.from,
            to: decoded.args.to,
            amount: decoded.args.value.toString(),
          },
        ],
      };
    }
    return {
      status: 'COMPLETE',
      effects: [
        {
          id: `erc20-approval-log:${String(input.logIndex)}`,
          phase: 'OBSERVED',
          provenance: provenance(context),
          kind: 'APPROVAL',
          chainId: input.chainId,
          asset: input.token,
          owner: decoded.args.owner,
          spender: decoded.args.spender,
          amount: decoded.args.value.toString(),
        },
      ],
    };
  } catch {
    return unknownResult(context, 'unsupported or malformed ERC-20 log');
  }
}
