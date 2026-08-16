import { z } from 'zod';

const AddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'expected an EVM address');
const UnsignedIntegerStringSchema = z
  .string()
  .regex(/^\d+$/, 'expected an unsigned integer string');

export const AssetBudgetSchema = z
  .object({
    asset: AddressSchema.or(z.literal('native')),
    maxGrossOutflow: UnsignedIntegerStringSchema,
  })
  .strict();

export const IntentContractSchema = z
  .object({
    version: z.literal('0.1'),
    chainId: z.number().int().positive(),
    allowedTargets: z.array(AddressSchema).min(1),
    assetBudgets: z.array(AssetBudgetSchema).min(1),
    maxGasWei: UnsignedIntegerStringSchema,
    expiresAt: z.string().datetime({ offset: true }),
    nonce: z.string().min(1),
  })
  .strict();

export type IntentContract = z.infer<typeof IntentContractSchema>;
