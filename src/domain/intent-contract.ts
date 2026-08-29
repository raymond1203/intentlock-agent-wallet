import { z } from 'zod';

export const EvmAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'expected an EVM address');

export const FunctionSelectorSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{8}$/, 'expected a four-byte function selector');

export const UnsignedIntegerStringSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)$/, 'expected a canonical unsigned integer string');

export const AssetIdSchema = EvmAddressSchema.or(z.literal('native'));

export const TargetPermissionSchema = z
  .object({
    target: EvmAddressSchema,
    selectors: z.array(FunctionSelectorSchema).min(1),
  })
  .strict();

export const ChainScopeSchema = z
  .object({
    chainId: z.number().int().positive(),
    allowedTargets: z.array(TargetPermissionSchema).min(1),
    allowedRecipients: z.array(EvmAddressSchema).min(1),
  })
  .strict();

export const AssetBudgetSchema = z
  .object({
    chainId: z.number().int().positive(),
    asset: AssetIdSchema,
    maxGrossOutflow: UnsignedIntegerStringSchema,
    maxAllowanceExposure: UnsignedIntegerStringSchema.default('0'),
  })
  .strict();

export const SafetyInvariantsSchema = z
  .object({
    chainScopes: z.array(ChainScopeSchema).min(1),
    assetBudgets: z.array(AssetBudgetSchema).min(1),
    maxGasWei: UnsignedIntegerStringSchema,
    maxSlippageBps: z.number().int().min(0).max(10_000),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const GoalBaseSchema = z.object({
  chainId: z.number().int().positive(),
});

export const FinalStateGoalSchema = z.discriminatedUnion('kind', [
  GoalBaseSchema.extend({
    kind: z.literal('MIN_ASSET_BALANCE'),
    asset: AssetIdSchema,
    account: EvmAddressSchema,
    minAmount: UnsignedIntegerStringSchema,
  }).strict(),
  GoalBaseSchema.extend({
    kind: z.literal('MAX_DEBT'),
    asset: AssetIdSchema,
    account: EvmAddressSchema,
    maxAmount: UnsignedIntegerStringSchema,
  }).strict(),
  GoalBaseSchema.extend({
    kind: z.literal('OWNER_IS'),
    collection: EvmAddressSchema,
    tokenId: UnsignedIntegerStringSchema,
    owner: EvmAddressSchema,
  }).strict(),
  GoalBaseSchema.extend({
    kind: z.literal('NO_RESIDUAL_ALLOWANCE'),
    asset: EvmAddressSchema,
    owner: EvmAddressSchema,
    spender: EvmAddressSchema,
  }).strict(),
]);

export const IntentContractSchema = z
  .object({
    version: z.literal('0.1'),
    account: EvmAddressSchema,
    nonce: UnsignedIntegerStringSchema,
    idempotencyKey: z.string().min(1).max(128),
    safety: SafetyInvariantsSchema,
    finalStateGoals: z.array(FinalStateGoalSchema).min(1),
  })
  .strict()
  .superRefine((contract, context) => {
    const chainIds = new Set(contract.safety.chainScopes.map((scope) => scope.chainId));
    const scopeKeys = new Set<number>();
    for (const scope of contract.safety.chainScopes) {
      if (scopeKeys.has(scope.chainId)) {
        context.addIssue({
          code: 'custom',
          message: `duplicate chain scope: ${String(scope.chainId)}`,
          path: ['safety', 'chainScopes'],
        });
      }
      scopeKeys.add(scope.chainId);
    }

    const budgetKeys = new Set<string>();
    for (const [index, budget] of contract.safety.assetBudgets.entries()) {
      if (!chainIds.has(budget.chainId)) {
        context.addIssue({
          code: 'custom',
          message: `budget chain ${String(budget.chainId)} has no chain scope`,
          path: ['safety', 'assetBudgets', index, 'chainId'],
        });
      }
      const key = `${String(budget.chainId)}:${budget.asset.toLowerCase()}`;
      if (budgetKeys.has(key)) {
        context.addIssue({
          code: 'custom',
          message: `duplicate asset budget: ${key}`,
          path: ['safety', 'assetBudgets', index],
        });
      }
      budgetKeys.add(key);
    }

    for (const [index, goal] of contract.finalStateGoals.entries()) {
      if (!chainIds.has(goal.chainId)) {
        context.addIssue({
          code: 'custom',
          message: `goal chain ${String(goal.chainId)} has no chain scope`,
          path: ['finalStateGoals', index, 'chainId'],
        });
      }
    }
  });

export type IntentContract = z.infer<typeof IntentContractSchema>;
export type AssetBudget = z.infer<typeof AssetBudgetSchema>;
export type FinalStateGoal = z.infer<typeof FinalStateGoalSchema>;

export function createIntentContractJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(IntentContractSchema, {
    target: 'draft-2020-12',
    unrepresentable: 'throw',
  });
}
