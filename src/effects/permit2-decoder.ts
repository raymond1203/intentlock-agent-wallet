import { decodeFunctionData, parseAbi, toFunctionSelector } from 'viem';
import { z } from 'zod';

import { EvmAddressSchema, UnsignedIntegerStringSchema } from '../domain/intent-contract.js';
import {
  type DecodeContext,
  type EffectDecodeResult,
  selectorFromData,
  unknownResult,
} from './types.js';

const MAX_UINT48 = (1n << 48n) - 1n;
const MAX_UINT160 = (1n << 160n) - 1n;

const Uint48StringSchema = UnsignedIntegerStringSchema.refine(
  (value) => BigInt(value) <= MAX_UINT48,
  'expected uint48',
);
const Uint160StringSchema = UnsignedIntegerStringSchema.refine(
  (value) => BigInt(value) <= MAX_UINT160,
  'expected uint160',
);

export const PermitSingleTypedDataSchema = z
  .object({
    chainId: z.number().int().positive(),
    verifyingContract: EvmAddressSchema,
    owner: EvmAddressSchema,
    details: z
      .object({
        token: EvmAddressSchema,
        amount: Uint160StringSchema,
        expiration: Uint48StringSchema,
        nonce: Uint48StringSchema,
      })
      .strict(),
    spender: EvmAddressSchema,
    sigDeadline: UnsignedIntegerStringSchema,
  })
  .strict();

export type PermitSingleTypedData = z.infer<typeof PermitSingleTypedDataSchema>;

export const PERMIT2_ABI = parseAbi([
  'function permit(address owner, ((address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline) permitSingle, bytes signature)',
  'function permitTransferFrom(((address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, (address to, uint256 requestedAmount) transferDetails, address owner, bytes signature)',
]);

const PERMIT_SELECTOR = toFunctionSelector(
  'permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)',
);

function permitEffect(
  input: PermitSingleTypedData,
  callPath: readonly number[] = [],
  source: 'CALLDATA' | 'RECEIPT' = 'CALLDATA',
) {
  return {
    id: `permit2-approval:${callPath.join('.') || 'root'}`,
    phase: source === 'RECEIPT' ? ('OBSERVED' as const) : ('PREDICTED' as const),
    provenance: {
      callPath: [...callPath],
      target: input.verifyingContract,
      selector: PERMIT_SELECTOR,
      source,
    },
    kind: 'APPROVAL' as const,
    chainId: input.chainId,
    asset: input.details.token,
    owner: input.owner,
    spender: input.spender,
    amount: input.details.amount,
    expiration: input.details.expiration,
    signatureDeadline: input.sigDeadline,
    nonce: input.details.nonce,
  };
}

export function decodePermit2TypedData(input: unknown): EffectDecodeResult {
  const parsed = PermitSingleTypedDataSchema.safeParse(input);
  if (!parsed.success) {
    const candidate = input as Partial<PermitSingleTypedData>;
    const context: DecodeContext = {
      chainId: candidate.chainId ?? 1,
      target: (candidate.verifyingContract ??
        '0x0000000000000000000000000000000000000000') as `0x${string}`,
      caller: (candidate.owner ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
      data: PERMIT_SELECTOR,
    };
    return unknownResult(context, 'invalid Permit2 PermitSingle typed data');
  }
  return { status: 'COMPLETE', effects: [permitEffect(parsed.data)] };
}

export function decodePermit2Calldata(context: DecodeContext): EffectDecodeResult {
  try {
    const decoded = decodeFunctionData({ abi: PERMIT2_ABI, data: context.data });
    const baseProvenance = {
      callPath: [...(context.callPath ?? [])],
      target: context.target,
      selector: selectorFromData(context.data),
      ...(context.codehash ? { codehash: context.codehash } : {}),
      source: 'CALLDATA' as const,
    };
    if (decoded.functionName === 'permit') {
      const [owner, permitSingle] = decoded.args;
      const input: PermitSingleTypedData = {
        chainId: context.chainId,
        verifyingContract: context.target,
        owner,
        details: {
          token: permitSingle.details.token,
          amount: permitSingle.details.amount.toString(),
          expiration: permitSingle.details.expiration.toString(),
          nonce: permitSingle.details.nonce.toString(),
        },
        spender: permitSingle.spender,
        sigDeadline: permitSingle.sigDeadline.toString(),
      };
      const effect = permitEffect(input, context.callPath);
      effect.provenance = baseProvenance;
      return { status: 'COMPLETE', effects: [effect] };
    }

    const [permit, transferDetails, owner] = decoded.args;
    return {
      status: 'COMPLETE',
      effects: [
        {
          id: `permit2-signature-exposure:${(context.callPath ?? []).join('.') || 'root'}`,
          phase: 'PREDICTED',
          provenance: baseProvenance,
          kind: 'APPROVAL',
          chainId: context.chainId,
          asset: permit.permitted.token,
          owner,
          spender: context.caller,
          amount: permit.permitted.amount.toString(),
          signatureDeadline: permit.deadline.toString(),
          nonce: permit.nonce.toString(),
        },
        {
          id: `permit2-signature-transfer:${(context.callPath ?? []).join('.') || 'root'}`,
          phase: 'PREDICTED',
          provenance: baseProvenance,
          kind: 'TRANSFER',
          chainId: context.chainId,
          asset: permit.permitted.token,
          from: owner,
          to: transferDetails.to,
          amount: transferDetails.requestedAmount.toString(),
        },
      ],
    };
  } catch {
    return unknownResult(context, 'unsupported or malformed Permit2 calldata');
  }
}
