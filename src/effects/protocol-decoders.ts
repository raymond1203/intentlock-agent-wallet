import { decodeFunctionData, parseAbi, type Address } from 'viem';
import type { EconomicEffect } from '../domain/action-ir.js';
import {
  selectorFromData,
  unknownResult,
  type DecodeContext,
  type EffectDecodeResult,
} from './types.js';

// Source commits and supported subsets are pinned in docs/effects/protocol-decoders.md.
export const ACROSS_V3_ABI = parseAbi([
  'function depositV3(address depositor,address recipient,address inputToken,address outputToken,uint256 inputAmount,uint256 outputAmount,uint256 destinationChainId,address exclusiveRelayer,uint32 quoteTimestamp,uint32 fillDeadline,uint32 exclusivityDeadline,bytes message) payable',
]);
export const CCTP_V1_ABI = parseAbi([
  'function depositForBurn(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken) returns (uint64)',
]);
export const AAVE_V3_ABI = parseAbi([
  'function supply(address asset,uint256 amount,address onBehalfOf,uint16 referralCode)',
  'function borrow(address asset,uint256 amount,uint256 interestRateMode,uint16 referralCode,address onBehalfOf)',
  'function repay(address asset,uint256 amount,uint256 interestRateMode,address onBehalfOf) returns (uint256)',
  'function withdraw(address asset,uint256 amount,address to) returns (uint256)',
]);

export interface BridgeRoute {
  sourceChainId: number;
  destinationChainId: number;
  inputToken: Address;
  outputToken: Address;
  /** Amounts may only be subtracted for a pinned same-asset, same-decimal route. */
  sameUnits: true;
  cctpDomain?: number;
}
export interface LendingReserve {
  chainId: number;
  pool: Address;
  asset: Address;
  aToken: Address;
  /** Required to resolve capped repay/withdraw amounts, including uint256.max. */
  suppliedBalance?: string;
  debtBalance?: string;
}
export interface ProtocolDecoderOptions {
  bridgeRoutes?: readonly BridgeRoute[];
  lendingReserves?: readonly LendingReserve[];
}
const equal = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
const UINT_MAX = (1n << 256n) - 1n;
function base(context: DecodeContext, suffix: string) {
  return {
    id: `${(context.callPath ?? []).join('.')}:${suffix}`,
    phase: 'PREDICTED' as const,
    provenance: {
      callPath: [...(context.callPath ?? [])],
      target: context.target,
      selector: selectorFromData(context.data),
      source: 'CALLDATA' as const,
      ...(context.codehash ? { codehash: context.codehash } : {}),
    },
  };
}

export function decodeAcrossV3(
  context: DecodeContext,
  options: ProtocolDecoderOptions,
): EffectDecodeResult {
  try {
    if (BigInt(context.valueWei ?? '0') !== 0n) throw new Error('native deposit unsupported');
    const { args } = decodeFunctionData({ abi: ACROSS_V3_ABI, data: context.data });
    const [
      depositor,
      recipient,
      inputToken,
      outputToken,
      amount,
      output,
      destination,
      ,
      ,
      deadline,
      ,
      message,
    ] = args;
    const route = options.bridgeRoutes?.find(
      (r) =>
        r.sourceChainId === context.chainId &&
        BigInt(r.destinationChainId) === destination &&
        equal(r.inputToken, inputToken) &&
        equal(r.outputToken, outputToken),
    );
    if (
      !route ||
      !equal(depositor, context.caller) ||
      message !== '0x' ||
      output > amount ||
      output === 0n
    ) {
      throw new Error('unsupported route, depositor, message, or amount');
    }
    return {
      status: 'COMPLETE',
      effects: [
        {
          ...base(context, 'bridge'),
          kind: 'BRIDGE',
          sourceChainId: context.chainId,
          destinationChainId: route.destinationChainId,
          asset: inputToken,
          destinationAsset: outputToken,
          amount: amount.toString(),
          minAmountOut: output.toString(),
          maxFee: (amount - output).toString(),
          recipient,
          deadline: String(deadline),
        },
      ],
    };
  } catch {
    return unknownResult(context, 'unsupported or malformed Across V3 deposit');
  }
}

export function decodeCctpV1(
  context: DecodeContext,
  options: ProtocolDecoderOptions,
): EffectDecodeResult {
  try {
    if (BigInt(context.valueWei ?? '0') !== 0n) throw new Error('nonpayable');
    const { args } = decodeFunctionData({ abi: CCTP_V1_ABI, data: context.data });
    const [amount, domain, recipient32, token] = args;
    const route = options.bridgeRoutes?.find(
      (r) =>
        r.sourceChainId === context.chainId &&
        r.cctpDomain === domain &&
        equal(r.inputToken, token),
    );
    if (
      !route ||
      !/^0x0{24}[a-fA-F0-9]{40}$/.test(recipient32) ||
      BigInt(recipient32) === 0n ||
      amount === 0n
    ) {
      throw new Error('unknown domain or non-EVM recipient');
    }
    return {
      status: 'COMPLETE',
      effects: [
        {
          ...base(context, 'bridge'),
          kind: 'BRIDGE',
          sourceChainId: context.chainId,
          destinationChainId: route.destinationChainId,
          asset: token,
          destinationAsset: route.outputToken,
          amount: amount.toString(),
          minAmountOut: amount.toString(),
          maxFee: '0',
          recipient: `0x${recipient32.slice(-40)}`,
        },
      ],
    };
  } catch {
    return unknownResult(context, 'unsupported or malformed CCTP V1 deposit');
  }
}

export function decodeAaveV3(
  context: DecodeContext,
  options: ProtocolDecoderOptions,
): EffectDecodeResult {
  try {
    if (BigInt(context.valueWei ?? '0') !== 0n) throw new Error('nonpayable');
    const decoded = decodeFunctionData({ abi: AAVE_V3_ABI, data: context.data });
    const [asset, requested] = decoded.args;
    const reserve = options.lendingReserves?.find(
      (r) =>
        r.chainId === context.chainId && equal(r.pool, context.target) && equal(r.asset, asset),
    );
    if (!reserve || requested === 0n) throw new Error('missing reserve or zero amount');
    let amount = requested;
    let beneficiary: Address;
    let direction: 1 | -1;
    let kind: 'POSITION' | 'DEBT';
    let to = context.caller;
    if (decoded.functionName === 'supply') {
      beneficiary = decoded.args[2];
      direction = 1;
      kind = 'POSITION';
    } else if (decoded.functionName === 'borrow') {
      if (decoded.args[2] !== 2n) throw new Error('unsupported rate mode');
      beneficiary = decoded.args[4];
      direction = 1;
      kind = 'DEBT';
    } else if (decoded.functionName === 'repay') {
      if (decoded.args[2] !== 2n || reserve.debtBalance === undefined)
        throw new Error('debt state required');
      beneficiary = decoded.args[3];
      direction = -1;
      kind = 'DEBT';
      const debt = BigInt(reserve.debtBalance);
      amount = amount < debt ? amount : debt;
    } else {
      if (reserve.suppliedBalance === undefined) throw new Error('position state required');
      const supplied = BigInt(reserve.suppliedBalance);
      if (requested !== UINT_MAX && requested > supplied)
        throw new Error('insufficient supplied balance');
      amount = requested === UINT_MAX ? supplied : requested;
      beneficiary = context.caller;
      to = decoded.args[2];
      direction = -1;
      kind = 'POSITION';
    }
    if (!equal(beneficiary, context.caller) || amount <= 0n || amount === UINT_MAX)
      throw new Error('unsupported delegation or amount');
    const outgoing = decoded.functionName === 'supply' || decoded.functionName === 'repay';
    const effects: EconomicEffect[] = [
      {
        ...base(context, 'transfer'),
        kind: 'TRANSFER',
        chainId: context.chainId,
        asset,
        from: outgoing ? context.caller : reserve.aToken,
        to: outgoing ? reserve.aToken : to,
        amount: amount.toString(),
      },
      {
        ...base(context, kind.toLowerCase()),
        kind,
        chainId: context.chainId,
        protocol: context.target,
        account: beneficiary,
        asset,
        delta: (BigInt(direction) * amount).toString(),
      },
    ];
    return { status: 'COMPLETE', effects };
  } catch {
    return unknownResult(
      context,
      'unsupported or malformed Aave V3 call, or missing reserve state',
    );
  }
}
