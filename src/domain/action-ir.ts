import { z } from 'zod';

import {
  AssetIdSchema,
  EvmAddressSchema,
  FunctionSelectorSchema,
  UnsignedIntegerStringSchema,
} from './intent-contract.js';

const Bytes32Schema = z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'expected 32-byte hex');

export const EffectProvenanceSchema = z
  .object({
    callPath: z.array(z.number().int().nonnegative()),
    target: EvmAddressSchema,
    selector: FunctionSelectorSchema,
    codehash: Bytes32Schema.optional(),
    source: z.enum(['CALLDATA', 'SIMULATION', 'RECEIPT']),
  })
  .strict();

const EffectBaseSchema = z.object({
  id: z.string().min(1),
  phase: z.enum(['PREDICTED', 'OBSERVED']),
  provenance: EffectProvenanceSchema,
});

export const EconomicEffectSchema = z.discriminatedUnion('kind', [
  EffectBaseSchema.extend({
    kind: z.literal('TRANSFER'),
    chainId: z.number().int().positive(),
    asset: AssetIdSchema,
    from: EvmAddressSchema,
    to: EvmAddressSchema,
    amount: UnsignedIntegerStringSchema,
  }).strict(),
  EffectBaseSchema.extend({
    kind: z.literal('APPROVAL'),
    chainId: z.number().int().positive(),
    asset: EvmAddressSchema,
    owner: EvmAddressSchema,
    spender: EvmAddressSchema,
    amount: UnsignedIntegerStringSchema,
    expiration: UnsignedIntegerStringSchema.optional(),
    signatureDeadline: UnsignedIntegerStringSchema.optional(),
    nonce: UnsignedIntegerStringSchema.optional(),
  }).strict(),
  EffectBaseSchema.extend({
    kind: z.literal('SWAP'),
    chainId: z.number().int().positive(),
    assetIn: AssetIdSchema,
    assetOut: AssetIdSchema,
    amountIn: UnsignedIntegerStringSchema,
    quotedAmountOut: UnsignedIntegerStringSchema.optional(),
    minAmountOut: UnsignedIntegerStringSchema,
    recipient: EvmAddressSchema,
    deadline: UnsignedIntegerStringSchema.optional(),
  }).strict(),
  EffectBaseSchema.extend({
    kind: z.literal('BRIDGE'),
    sourceChainId: z.number().int().positive(),
    destinationChainId: z.number().int().positive(),
    asset: AssetIdSchema,
    amount: UnsignedIntegerStringSchema,
    maxFee: UnsignedIntegerStringSchema,
    recipient: EvmAddressSchema,
  }).strict(),
  EffectBaseSchema.extend({
    kind: z.literal('DEBT'),
    chainId: z.number().int().positive(),
    protocol: EvmAddressSchema,
    account: EvmAddressSchema,
    asset: AssetIdSchema,
    delta: z.string().regex(/^-?(0|[1-9]\d*)$/, 'expected a canonical signed integer string'),
  }).strict(),
  EffectBaseSchema.extend({
    kind: z.literal('OWNERSHIP'),
    chainId: z.number().int().positive(),
    collection: EvmAddressSchema,
    tokenId: UnsignedIntegerStringSchema,
    from: EvmAddressSchema,
    to: EvmAddressSchema,
  }).strict(),
  EffectBaseSchema.extend({
    kind: z.literal('GAS'),
    chainId: z.number().int().positive(),
    payer: EvmAddressSchema,
    maxFeeWei: UnsignedIntegerStringSchema,
  }).strict(),
  EffectBaseSchema.extend({
    kind: z.literal('UNKNOWN'),
    chainId: z.number().int().positive(),
    reason: z.string().min(1),
    rawSelector: FunctionSelectorSchema.optional(),
  }).strict(),
]);

export interface CallFrame {
  chainId: number;
  target: string;
  selector: string;
  valueWei: string;
  calldataHash: string;
  codehash?: string | undefined;
  decodeStatus: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';
  effects: EconomicEffect[];
  children: CallFrame[];
}

export const CallFrameSchema: z.ZodType<CallFrame> = z.lazy(() =>
  z
    .object({
      chainId: z.number().int().positive(),
      target: EvmAddressSchema,
      selector: FunctionSelectorSchema,
      valueWei: UnsignedIntegerStringSchema,
      calldataHash: Bytes32Schema,
      codehash: Bytes32Schema.optional(),
      decodeStatus: z.enum(['COMPLETE', 'PARTIAL', 'UNKNOWN']),
      effects: z.array(EconomicEffectSchema),
      children: z.array(CallFrameSchema),
    })
    .strict(),
);

export const ActionIRSchema = z
  .object({
    version: z.literal('0.1'),
    intentHash: Bytes32Schema,
    root: CallFrameSchema,
  })
  .strict();

export type EconomicEffect = z.infer<typeof EconomicEffectSchema>;
export type ActionIR = z.infer<typeof ActionIRSchema>;

export interface EffectTotals {
  grossOutflow: ReadonlyMap<string, bigint>;
  netDelta: ReadonlyMap<string, bigint>;
  allowanceExposure: ReadonlyMap<string, bigint>;
  gasWei: bigint;
  hasUnknown: boolean;
}

function effectKey(chainId: number, asset: string): string {
  return `${String(chainId)}:${asset.toLowerCase()}`;
}

function add(map: Map<string, bigint>, key: string, amount: bigint): void {
  map.set(key, (map.get(key) ?? 0n) + amount);
}

export function flattenEffects(frame: CallFrame): EconomicEffect[] {
  return [frame.effects, ...frame.children.map(flattenEffects)].flat(2);
}

export function aggregateEffects(
  effects: readonly EconomicEffect[],
  account: string,
): EffectTotals {
  const normalizedAccount = account.toLowerCase();
  const grossOutflow = new Map<string, bigint>();
  const netDelta = new Map<string, bigint>();
  const allowanceExposure = new Map<string, bigint>();
  let gasWei = 0n;
  let hasUnknown = false;

  for (const effect of effects) {
    switch (effect.kind) {
      case 'TRANSFER': {
        const key = effectKey(effect.chainId, effect.asset);
        const amount = BigInt(effect.amount);
        if (effect.from.toLowerCase() === normalizedAccount) {
          add(grossOutflow, key, amount);
          add(netDelta, key, -amount);
        }
        if (effect.to.toLowerCase() === normalizedAccount) add(netDelta, key, amount);
        break;
      }
      case 'APPROVAL':
        if (effect.owner.toLowerCase() === normalizedAccount) {
          allowanceExposure.set(effectKey(effect.chainId, effect.asset), BigInt(effect.amount));
        }
        break;
      case 'BRIDGE':
        add(grossOutflow, effectKey(effect.sourceChainId, effect.asset), BigInt(effect.amount));
        break;
      case 'GAS':
        if (effect.payer.toLowerCase() === normalizedAccount) gasWei += BigInt(effect.maxFeeWei);
        break;
      case 'UNKNOWN':
        hasUnknown = true;
        break;
      case 'DEBT':
      case 'OWNERSHIP':
      case 'SWAP':
        break;
    }
  }

  return { grossOutflow, netDelta, allowanceExposure, gasWei, hasUnknown };
}

export function createActionIrJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(ActionIRSchema, {
    target: 'draft-2020-12',
    unrepresentable: 'throw',
  });
}
