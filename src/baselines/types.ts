import { z } from 'zod';

export const BaselineDecisionSchema = z.enum(['ALLOW', 'DENY', 'ABSTAIN']);
export const BaselineNameSchema = z.enum(['LLM_VERIFIER', 'PER_CALL_POLICY']);

export const BaselineVerdictSchema = z
  .object({
    baseline: BaselineNameSchema,
    decision: BaselineDecisionSchema,
    rationale: z.string().min(1),
    reasonCodes: z.array(z.string().min(1)),
    checkedUnits: z.number().int().nonnegative(),
    attempts: z.number().int().positive(),
    rawOutput: z.string().optional(),
  })
  .strict();

export type BaselineDecision = z.infer<typeof BaselineDecisionSchema>;
export type BaselineVerdict = z.infer<typeof BaselineVerdictSchema>;
