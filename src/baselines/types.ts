import { z } from 'zod';

export const BaselineDecisionSchema = z.enum(['ALLOW', 'DENY', 'ABSTAIN']);
export const BaselineNameSchema = z.enum([
  'LLM_VERIFIER',
  'PER_CALL_POLICY',
  'GUARD_MODE_EMULATOR',
]);

export const BaselineVerdictSchema = z
  .object({
    baseline: BaselineNameSchema,
    decision: BaselineDecisionSchema,
    rationale: z.string().min(1),
    reasonCodes: z.array(z.string().min(1)),
    checkedUnits: z.number().int().nonnegative(),
    attempts: z.number().int().positive(),
    /** One-based signer execution-order position of the first per-call intervention. */
    firstDetectionActionOrdinal: z.number().int().positive().optional(),
    rawOutput: z.string().optional(),
  })
  .strict()
  .superRefine((verdict, context) => {
    if (verdict.decision === 'ALLOW' && verdict.firstDetectionActionOrdinal !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['firstDetectionActionOrdinal'],
        message: 'an ALLOW verdict cannot claim a detection action ordinal',
      });
    }
    if (
      verdict.firstDetectionActionOrdinal !== undefined &&
      verdict.firstDetectionActionOrdinal > verdict.checkedUnits
    ) {
      context.addIssue({
        code: 'custom',
        path: ['firstDetectionActionOrdinal'],
        message: 'the detection ordinal cannot exceed the number of checked actions',
      });
    }
  });

export type BaselineDecision = z.infer<typeof BaselineDecisionSchema>;
export type BaselineVerdict = z.infer<typeof BaselineVerdictSchema>;
