import { createHash } from 'node:crypto';

import { z } from 'zod';

import { EVALUATION_VARIANTS } from './case-matrix.js';

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const GitCommitSchema = z.string().regex(/^[a-f0-9]{40}$/);

export const TokenPricingSchema = z
  .object({
    input: z.number().nonnegative(),
    cachedInput: z.number().nonnegative(),
    output: z.number().nonnegative(),
  })
  .strict();

const FreezeFieldsSchema = z
  .object({
    gitCommit: GitCommitSchema.nullable(),
    dependencyDigestSha256: Sha256Schema.nullable(),
    datasetDigestSha256: Sha256Schema.nullable(),
    caseManifestDigestSha256: Sha256Schema.nullable(),
    promptDigestSha256: Sha256Schema.nullable(),
    toolSchemaDigestSha256: Sha256Schema.nullable(),
    metricImplementationDigestSha256: Sha256Schema.nullable(),
    protocolConfigDigestSha256: Sha256Schema.nullable(),
    evaluationConfigDigestSha256: Sha256Schema.nullable(),
    implementationDigestSha256: Sha256Schema.nullable(),
    frozenAt: z.iso.datetime().nullable(),
    humanReviewer: z.string().min(1).nullable(),
    humanReviewPath: z.string().min(1).nullable(),
    humanReviewDigestSha256: Sha256Schema.nullable(),
  })
  .strict();

const CommonFrozenEvalConfigSchema = z
  .object({
    protocolVersion: z.literal('0.1'),
    status: z.enum(['CANDIDATE_UNFROZEN', 'FROZEN']),
    freezeIssue: z.number().int().positive(),
    dataset: z
      .object({
        version: z.literal('0.3.0'),
        baseManifest: z.string().min(1),
        caseManifest: z.string().min(1),
        m2Validation: z.string().min(1),
        expectedBaseCases: z.literal(80),
        expectedCuratedCases: z.literal(400),
        hiddenTestClaim: z.literal(false),
        hiddenTestNote: z.string().min(1),
      })
      .strict(),
    caseMatrix: z
      .object({
        seed: z.literal(2026),
        evaluatedAt: z.iso.datetime(),
        casesPerBase: z.literal(5),
        variants: z.tuple([
          z.literal(EVALUATION_VARIANTS[0]),
          z.literal(EVALUATION_VARIANTS[1]),
          z.literal(EVALUATION_VARIANTS[2]),
          z.literal(EVALUATION_VARIANTS[3]),
          z.literal(EVALUATION_VARIANTS[4]),
        ]),
        validityPolicy: z.string().min(1),
      })
      .strict(),
    systems: z
      .array(
        z
          .object({
            id: z.enum([
              'none',
              'guard-mode-emulator',
              'llm-verifier',
              'per-call-policy',
              'intentlock-full',
            ]),
            label: z.string().min(1),
            primary: z.literal(true),
          })
          .loose(),
      )
      .length(5),
    relatedWorkOnly: z.array(z.string().min(1)),
    models: z
      .object({
        primary: z
          .object({
            id: z.string().min(1),
            temperature: z.literal(0),
            maxRetries: z.number().int().min(0).max(3),
            timeoutMs: z.number().int().positive(),
            malformedPolicy: z.enum(['ABSTAIN', 'DENY']),
            pricingUsdPerMillionTokens: TokenPricingSchema,
            pricingSource: z.url(),
            pricingCheckedAt: z.iso.date(),
          })
          .strict(),
        secondary: z.unknown().nullable(),
        secondaryPolicy: z.string().min(1),
      })
      .strict(),
    forks: z
      .array(
        z
          .object({
            chainId: z.number().int().positive(),
            blockNumber: z.number().int().positive(),
            blockHash: z.string().regex(/^0x[a-f0-9]{64}$/),
            rpcEnvVar: z.string().regex(/^[A-Z][A-Z0-9_]+$/),
          })
          .strict(),
      )
      .min(1),
    adaptive: z.record(z.string(), z.unknown()),
    stageComparisons: z.array(z.record(z.string(), z.unknown())).min(1),
    ablations: z.array(z.record(z.string(), z.unknown())).min(1),
    metrics: z
      .object({
        primary: z.literal('offline_counterfactual_unsafe_authorization_rate'),
        secondary: z.array(z.string().min(1)),
        confidenceInterval: z.literal('stratified-bootstrap-95'),
        bootstrapReplicates: z.literal(10_000),
        missingDataPolicy: z.string().min(1),
      })
      .strict(),
    failurePolicy: z
      .object({
        overwriteRun: z.literal(false),
        retriesReuseCaseId: z.literal(true),
        retryResultSelection: z.literal(
          'attempt-1-intention-to-treat-retries-operational-sensitivity-only',
        ),
        maxAttemptsPerCase: z.number().int().min(1).max(5),
        maxTotalRetryAttempts: z.number().int().min(0).max(2_000),
        timeoutDecision: z.literal('ABSTAIN'),
        malformedDecision: z.literal('ABSTAIN'),
      })
      .strict(),
    freeze: FreezeFieldsSchema,
  })
  .strict()
  .superRefine((config, context) => {
    const ids = config.systems.map((system) => system.id);
    if (new Set(ids).size !== 5) {
      context.addIssue({
        code: 'custom',
        path: ['systems'],
        message: 'the five primary system IDs must be unique',
      });
    }
  });

export const FrozenEvalConfigSchema = CommonFrozenEvalConfigSchema;

export const ReadyFrozenEvalConfigSchema = CommonFrozenEvalConfigSchema.safeExtend({
  status: z.literal('FROZEN'),
  freeze: FreezeFieldsSchema.extend({
    gitCommit: GitCommitSchema,
    dependencyDigestSha256: Sha256Schema,
    datasetDigestSha256: Sha256Schema,
    caseManifestDigestSha256: Sha256Schema,
    promptDigestSha256: Sha256Schema,
    toolSchemaDigestSha256: Sha256Schema,
    metricImplementationDigestSha256: Sha256Schema,
    protocolConfigDigestSha256: Sha256Schema,
    evaluationConfigDigestSha256: Sha256Schema,
    implementationDigestSha256: Sha256Schema,
    frozenAt: z.iso.datetime(),
    humanReviewer: z.string().min(1),
    humanReviewPath: z.string().min(1),
    humanReviewDigestSha256: Sha256Schema,
  }),
});

export type FrozenEvalConfig = z.infer<typeof FrozenEvalConfigSchema>;
export type ReadyFrozenEvalConfig = z.infer<typeof ReadyFrozenEvalConfigSchema>;
export type TokenPricing = z.infer<typeof TokenPricingSchema>;

export interface TokenUsageForCost {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

/** Calculates standard-processing USD cost from response token usage. */
export function tokenCostUsd(usage: TokenUsageForCost, pricing: TokenPricing): number {
  if (
    !Number.isSafeInteger(usage.inputTokens) ||
    !Number.isSafeInteger(usage.cachedInputTokens) ||
    !Number.isSafeInteger(usage.outputTokens) ||
    usage.inputTokens < 0 ||
    usage.cachedInputTokens < 0 ||
    usage.outputTokens < 0 ||
    usage.cachedInputTokens > usage.inputTokens
  ) {
    throw new Error('invalid token usage');
  }
  const uncachedInput = usage.inputTokens - usage.cachedInputTokens;
  return (
    (uncachedInput * pricing.input +
      usage.cachedInputTokens * pricing.cachedInput +
      usage.outputTokens * pricing.output) /
    1_000_000
  );
}

export function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
