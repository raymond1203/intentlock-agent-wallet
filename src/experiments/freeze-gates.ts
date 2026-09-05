import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';

import { z } from 'zod';

import { BENCHMARK_DATASET_VERSION } from '../benchmark/version.js';
import {
  LlmBaselineProtocolSchema,
  LLM_BASELINE_RESULT_PATH,
  LLM_BASELINE_REVIEW_PACKET_PATH,
  LLM_RATIONALE_REVIEW_PATH,
  type LlmBaselineExpectedCase,
} from '../baselines/llm-baseline-input.js';
import { LlmVerifierConfigSchema } from '../baselines/llm-verifier.js';

export {
  LlmBaselineProtocolSchema,
  LLM_BASELINE_CONFIG_PATH,
  LLM_BASELINE_PROTOCOL_PATH,
  LLM_BASELINE_RESULT_PATH,
  LLM_BASELINE_REVIEW_PACKET_PATH,
  LLM_RATIONALE_REVIEW_PATH,
} from '../baselines/llm-baseline-input.js';

const GitCommitSchema = z.string().regex(/^[a-f0-9]{40}$/);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const FreezeDryRunIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,99}$/);
export const LLM_AI_RATIONALE_REVIEW_PATH = `experiments/configs/baselines/llm-verifier-20-ai-review-v${BENCHMARK_DATASET_VERSION}.json`;

const LlmReviewIdSchema = z.string().regex(/^R(?:0[1-9]|1[0-9]|20)$/);
const LlmReviewIdsSchema = z
  .array(LlmReviewIdSchema)
  .length(20)
  .refine((ids) => new Set(ids).size === 20, 'LLM review IDs must be unique');

const LlmBaselineOutputSchema = z
  .object({
    reviewId: LlmReviewIdSchema,
    scenarioId: z.string().min(1),
    split: z.string().min(1),
    class: z.string().min(1),
    verdict: z
      .object({
        decision: z.enum(['ALLOW', 'DENY', 'ABSTAIN']),
        rationale: z.string().min(1),
        reasonCodes: z.array(z.string()),
        attempts: z.number().int().positive(),
        rawOutput: z.string().optional(),
      })
      .loose(),
    eligible: z.boolean(),
    expectedDecision: z.enum(['ALLOW', 'DENY', 'ABSTAIN']),
    exactMatch: z.boolean(),
  })
  .loose();

export const LlmBaselineResultSchema = z
  .object({
    schemaVersion: z.literal('0.1'),
    datasetVersion: z.literal(BENCHMARK_DATASET_VERSION),
    codeCommit: GitCommitSchema,
    workingTreeDirty: z.literal(false),
    inputSha256: Sha256Schema,
    evaluationStage: z.literal('PRE_SIGN'),
    seed: z.literal(2026),
    config: LlmVerifierConfigSchema,
    sampleSize: z.literal(20),
    eligibleCount: z.number().int().min(0).max(20),
    exactMatches: z.number().int().min(0).max(20),
    outputs: z.array(LlmBaselineOutputSchema).length(20),
    reviewerStatus: z.literal('PENDING_INDEPENDENT_REVIEW'),
  })
  .loose()
  .superRefine((result, context) => {
    const ids = result.outputs.map((output) => output.reviewId);
    if (!LlmReviewIdsSchema.safeParse(ids).success) {
      context.addIssue({
        code: 'custom',
        path: ['outputs'],
        message: 'LLM baseline outputs must cover R01-R20 exactly once',
      });
    }
    if (result.outputs.filter((output) => output.eligible).length !== result.eligibleCount) {
      context.addIssue({
        code: 'custom',
        path: ['eligibleCount'],
        message: 'eligible count does not match outputs',
      });
    }
    if (result.outputs.filter((output) => output.exactMatch).length !== result.exactMatches) {
      context.addIssue({
        code: 'custom',
        path: ['exactMatches'],
        message: 'exact-match count does not match outputs',
      });
    }
    result.outputs.forEach((output, index) => {
      if (output.exactMatch !== (output.verdict.decision === output.expectedDecision)) {
        context.addIssue({
          code: 'custom',
          path: ['outputs', index, 'exactMatch'],
          message: 'row exact-match flag does not match its decisions',
        });
      }
    });
  });

const LlmBaselineReviewPacketSchema = z
  .object({
    protocolVersion: z.literal('0.1'),
    status: z.literal('PENDING_INDEPENDENT_REVIEW'),
    datasetVersion: z.literal(BENCHMARK_DATASET_VERSION),
    codeCommit: GitCommitSchema,
    workingTreeDirty: z.literal(false),
    inputSha256: Sha256Schema,
    seed: z.literal(2026),
    config: LlmVerifierConfigSchema,
    instructions: z.string().trim().min(1),
    cases: z
      .array(
        z
          .object({
            reviewId: LlmReviewIdSchema,
            input: z.unknown(),
            output: z
              .object({
                decision: z.enum(['ALLOW', 'DENY', 'ABSTAIN']),
                rationale: z.string().min(1),
                violatedFields: z.array(z.string()),
                attempts: z.number().int().positive(),
                rawOutput: z.string().optional(),
              })
              .strict(),
          })
          .strict(),
      )
      .length(20),
  })
  .strict()
  .superRefine((packet, context) => {
    if (!LlmReviewIdsSchema.safeParse(packet.cases.map((entry) => entry.reviewId)).success) {
      context.addIssue({
        code: 'custom',
        path: ['cases'],
        message: 'LLM review packet must cover R01-R20 exactly once',
      });
    }
  });

export const LlmHumanRationaleReviewSchema = z
  .object({
    protocolVersion: z.literal('0.1'),
    datasetVersion: z.literal(BENCHMARK_DATASET_VERSION),
    status: z.literal('COMPLETE'),
    reviewerPseudonym: z.string().regex(/^[A-Za-z0-9_-]{2,64}$/),
    reviewerType: z.literal('HUMAN'),
    independenceAttestation: z.literal(true),
    reviewedAt: z.iso.datetime(),
    reviewedCommit: GitCommitSchema,
    inputSha256: Sha256Schema,
    configSha256: Sha256Schema,
    resultSha256: Sha256Schema,
    reviewPacketSha256: Sha256Schema,
    cases: z
      .array(
        z
          .object({
            reviewId: LlmReviewIdSchema,
            modelDecision: z.enum(['ALLOW', 'DENY', 'ABSTAIN']),
            rationaleSupported: z.boolean(),
            oracleLeakage: z.boolean(),
            correctedDecision: z.enum(['ALLOW', 'DENY', 'ABSTAIN']),
            notes: z.string().trim().min(1).max(2_000),
          })
          .strict(),
      )
      .length(20),
  })
  .strict()
  .superRefine((review, context) => {
    if (!LlmReviewIdsSchema.safeParse(review.cases.map((entry) => entry.reviewId)).success) {
      context.addIssue({
        code: 'custom',
        path: ['cases'],
        message: 'LLM rationale review must cover R01-R20 exactly once',
      });
    }
  });

export const LlmAiRationaleReviewSchema = z
  .object({
    ...LlmHumanRationaleReviewSchema.shape,
    protocolVersion: z.literal('0.2'),
    reviewMode: z.literal('SOLO_AI_ASSISTED'),
    status: z.literal('COMPLETE_AI_ASSISTED'),
    reviewerType: z.literal('AI'),
    independenceAttestation: z.literal(false),
    finalAuthorApproval: z.literal('PENDING'),
  })
  .strict()
  .superRefine((review, context) => {
    if (!LlmReviewIdsSchema.safeParse(review.cases.map((entry) => entry.reviewId)).success) {
      context.addIssue({
        code: 'custom',
        path: ['cases'],
        message: 'AI rationale review must cover R01-R20 exactly once',
      });
    }
  });

export const LlmRationaleReviewSchema = z.union([
  LlmHumanRationaleReviewSchema,
  LlmAiRationaleReviewSchema,
]);

export interface LlmBaselineGateInput {
  reviewMode?: 'INDEPENDENT_HUMAN' | 'SOLO_AI_ASSISTED';
  resultPath: string;
  reviewPacketPath: string;
  rationaleReviewPath: string;
  config: unknown;
  configSha256: string;
  protocol: unknown;
  protocolSha256: string;
  result?: unknown;
  resultSha256?: string | undefined;
  reviewPacket?: unknown;
  reviewPacketSha256?: string | undefined;
  rationaleReview?: unknown;
  rationaleReviewSha256?: string | undefined;
  expectedInput?:
    | {
        inputSha256: string;
        cases: readonly LlmBaselineExpectedCase[];
      }
    | undefined;
  executionSourceCommits: readonly string[];
  sourceCommitResolves: (commit: string) => boolean;
  sourceCommitIsAncestor: (commit: string) => boolean;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Validates the locally retained live result and tracked review artifacts without treating a
 * missing human submission as exceptional. Missing, stale, or malformed bindings remain visible
 * as blockers and therefore fail the completion gate closed.
 */
export function evaluateLlmBaselineGate(input: LlmBaselineGateInput) {
  const runBlockers: string[] = [];
  const config = LlmVerifierConfigSchema.safeParse(input.config);
  if (!config.success) runBlockers.push('config:invalid');
  const protocol = LlmBaselineProtocolSchema.safeParse(input.protocol);
  if (!protocol.success) runBlockers.push('protocol:invalid');
  const result =
    input.result === undefined ? undefined : LlmBaselineResultSchema.safeParse(input.result);
  if (result === undefined) runBlockers.push('result:missing');
  else if (!result.success) runBlockers.push('result:invalid');
  const packet =
    input.reviewPacket === undefined
      ? undefined
      : LlmBaselineReviewPacketSchema.safeParse(input.reviewPacket);
  if (packet === undefined) runBlockers.push('review-packet:missing');
  else if (!packet.success) runBlockers.push('review-packet:invalid');

  const expectedInput = input.expectedInput;
  const expectedInputValid =
    expectedInput !== undefined &&
    Sha256Schema.safeParse(expectedInput.inputSha256).success &&
    expectedInput.cases.length === 20 &&
    LlmReviewIdsSchema.safeParse(expectedInput.cases.map((entry) => entry.reviewId)).success &&
    new Set(expectedInput.cases.map((entry) => entry.scenarioId)).size === 20;
  if (!expectedInputValid) runBlockers.push('expected-input:unavailable-or-invalid');

  const executionSourceCommits = [...new Set(input.executionSourceCommits)];
  if (executionSourceCommits.length === 0) {
    runBlockers.push('execution-source-commit:missing');
  } else if (executionSourceCommits.length !== 1) {
    runBlockers.push('execution-source-commit:multiple');
  } else if (!GitCommitSchema.safeParse(executionSourceCommits[0]).success) {
    runBlockers.push('execution-source-commit:invalid');
  }

  if (result?.success) {
    if (config.success && !sameJson(result.data.config, config.data))
      runBlockers.push('result:config-mismatch');
    if (!input.resultSha256 || !Sha256Schema.safeParse(input.resultSha256).success)
      runBlockers.push('result:digest-missing-or-invalid');
    if (!input.sourceCommitResolves(result.data.codeCommit))
      runBlockers.push('result:commit-unresolvable');
    if (!input.sourceCommitIsAncestor(result.data.codeCommit))
      runBlockers.push('result:commit-not-head-ancestor');
    if (executionSourceCommits.length === 1 && result.data.codeCommit !== executionSourceCommits[0])
      runBlockers.push('result:execution-source-commit-mismatch');
    if (expectedInputValid && result.data.inputSha256 !== expectedInput.inputSha256)
      runBlockers.push('result:input-digest-mismatch');
    if (expectedInputValid) {
      result.data.outputs.forEach((output, index) => {
        const expected = expectedInput.cases[index];
        if (
          !expected ||
          output.reviewId !== expected.reviewId ||
          output.scenarioId !== expected.scenarioId ||
          output.split !== expected.split ||
          output.class !== expected.class
        ) {
          runBlockers.push(`result:sample-mismatch:${expected?.reviewId ?? String(index)}`);
        }
        if (
          expected &&
          (output.eligible !== expected.eligible ||
            output.expectedDecision !== expected.expectedDecision ||
            output.exactMatch !== (output.verdict.decision === expected.expectedDecision))
        ) {
          runBlockers.push(`result:score-mismatch:${expected.reviewId}`);
        }
      });
    }
  }
  if (!Sha256Schema.safeParse(input.configSha256).success)
    runBlockers.push('config:digest-invalid');
  if (!Sha256Schema.safeParse(input.protocolSha256).success)
    runBlockers.push('protocol:digest-invalid');
  if (packet?.success) {
    if (!input.reviewPacketSha256 || !Sha256Schema.safeParse(input.reviewPacketSha256).success)
      runBlockers.push('review-packet:digest-missing-or-invalid');
    if (config.success && !sameJson(packet.data.config, config.data))
      runBlockers.push('review-packet:config-mismatch');
    if (expectedInputValid && packet.data.inputSha256 !== expectedInput.inputSha256)
      runBlockers.push('review-packet:input-digest-mismatch');
    if (expectedInputValid) {
      packet.data.cases.forEach((reviewCase, index) => {
        const expected = expectedInput.cases[index];
        if (
          !expected ||
          reviewCase.reviewId !== expected.reviewId ||
          !sameJson(reviewCase.input, expected.input)
        ) {
          runBlockers.push(`review-packet:input-mismatch:${expected?.reviewId ?? String(index)}`);
        }
      });
    }
  }
  if (result?.success && packet?.success) {
    if (
      packet.data.codeCommit !== result.data.codeCommit ||
      packet.data.inputSha256 !== result.data.inputSha256 ||
      !sameJson(packet.data.config, result.data.config)
    ) {
      runBlockers.push('review-packet:run-binding-mismatch');
    }
    const resultById = new Map(result.data.outputs.map((entry) => [entry.reviewId, entry]));
    for (const reviewCase of packet.data.cases) {
      const output = resultById.get(reviewCase.reviewId);
      if (
        !output ||
        reviewCase.output.decision !== output.verdict.decision ||
        reviewCase.output.rationale !== output.verdict.rationale ||
        !sameJson(reviewCase.output.violatedFields, output.verdict.reasonCodes) ||
        reviewCase.output.attempts !== output.verdict.attempts ||
        reviewCase.output.rawOutput !== output.verdict.rawOutput
      ) {
        runBlockers.push(`review-packet:output-mismatch:${reviewCase.reviewId}`);
      }
    }
  }

  const runStatus = runBlockers.length === 0 ? ('COMPLETE' as const) : ('PENDING' as const);
  const rationaleBlockers: string[] = [];
  const rationale =
    input.rationaleReview === undefined
      ? undefined
      : (input.reviewMode === 'SOLO_AI_ASSISTED'
          ? LlmAiRationaleReviewSchema
          : LlmHumanRationaleReviewSchema
        ).safeParse(input.rationaleReview);
  if (rationale === undefined) rationaleBlockers.push('rationale-review:missing');
  else if (!rationale.success) rationaleBlockers.push('rationale-review:invalid');
  if (!input.rationaleReviewSha256) rationaleBlockers.push('rationale-review:digest-missing');
  else if (!Sha256Schema.safeParse(input.rationaleReviewSha256).success)
    rationaleBlockers.push('rationale-review:digest-invalid');
  if (runStatus !== 'COMPLETE') rationaleBlockers.push('baseline-run:not-complete');
  if (rationale?.success && result?.success) {
    if (
      rationale.data.reviewedCommit !== result.data.codeCommit ||
      rationale.data.inputSha256 !== result.data.inputSha256 ||
      rationale.data.configSha256 !== input.configSha256 ||
      rationale.data.resultSha256 !== input.resultSha256 ||
      rationale.data.reviewPacketSha256 !== input.reviewPacketSha256
    ) {
      rationaleBlockers.push('rationale-review:artifact-binding-mismatch');
    }
  }
  if (rationale?.success && packet?.success) {
    const packetById = new Map(packet.data.cases.map((entry) => [entry.reviewId, entry]));
    for (const reviewCase of rationale.data.cases) {
      if (packetById.get(reviewCase.reviewId)?.output.decision !== reviewCase.modelDecision) {
        rationaleBlockers.push(`rationale-review:model-decision-mismatch:${reviewCase.reviewId}`);
      }
    }
  }
  const rationaleReviewStatus =
    rationaleBlockers.length === 0
      ? input.reviewMode === 'SOLO_AI_ASSISTED'
        ? ('COMPLETE_AI_ASSISTED' as const)
        : ('COMPLETE' as const)
      : ('PENDING' as const);

  return {
    resultPath: input.resultPath,
    reviewPacketPath: input.reviewPacketPath,
    rationaleReviewPath: input.rationaleReviewPath,
    expectedDatasetVersion: BENCHMARK_DATASET_VERSION,
    runStatus,
    codeCommit: result?.success ? result.data.codeCommit : null,
    workingTreeDirty: result?.success ? result.data.workingTreeDirty : null,
    sampleSize: result?.success ? result.data.sampleSize : 0,
    inputSha256: result?.success ? result.data.inputSha256 : null,
    configSha256: input.configSha256,
    protocolSha256: input.protocolSha256,
    resultSha256: input.resultSha256 ?? null,
    reviewPacketSha256: input.reviewPacketSha256 ?? null,
    runBlockers: [...new Set(runBlockers)],
    rationaleReview: {
      status: rationaleReviewStatus,
      reviewerPseudonym: rationale?.success ? rationale.data.reviewerPseudonym : null,
      reviewerType: rationale?.success ? rationale.data.reviewerType : null,
      independenceAttestation: rationale?.success ? rationale.data.independenceAttestation : null,
      reviewedAt: rationale?.success ? rationale.data.reviewedAt : null,
      reviewedCommit: rationale?.success ? rationale.data.reviewedCommit : null,
      caseCount: rationale?.success ? rationale.data.cases.length : 0,
      submissionSha256: input.rationaleReviewSha256 ?? null,
      blockers: [...new Set(rationaleBlockers)],
    },
  };
}

export const FreezeDryRunEvidenceDirectorySchema = z
  .string()
  .regex(
    /^experiments\/results\/freeze-dry-runs\/[A-Za-z0-9][A-Za-z0-9._-]{2,99}$/,
    'freeze dry-run evidence must be a direct child of experiments/results/freeze-dry-runs',
  );

export const FreezeDryRunEvidenceBindingSchema = z
  .object({
    outputDirectory: FreezeDryRunEvidenceDirectorySchema,
    runId: FreezeDryRunIdSchema,
    candidateCommit: GitCommitSchema,
    candidateTree: GitCommitSchema,
    manifestSha256: Sha256Schema,
    casesJsonlSha256: Sha256Schema,
    summarySha256: Sha256Schema,
  })
  .strict()
  .superRefine((binding, context) => {
    if (binding.outputDirectory.split('/').at(-1) !== binding.runId) {
      context.addIssue({
        code: 'custom',
        path: ['outputDirectory'],
        message: 'freeze dry-run directory name must equal its run ID',
      });
    }
  });

export const FROZEN_EVALUATION_CONFIG_PATH = 'experiments/configs/frozen-eval.yaml';
export const FROZEN_ABLATION_CONFIG_PATH = 'experiments/configs/ablations/manifest.json';

export const RepoRelativeJsonPathSchema = z
  .string()
  .regex(/^[A-Za-z0-9._/-]+\.json$/)
  .refine((value) => !value.split('/').includes('..'), 'path traversal is not allowed')
  .refine((value) => !value.startsWith('/'), 'an absolute path is not allowed');

/** Four cases per variant and two or three per workflow, covering all seven workflows. */
export const FREEZE_REVIEW_CASE_IDS = [
  'TR-01--BENIGN_ORIGINAL',
  'AP-01--BENIGN_ORIGINAL',
  'SS-01--BENIGN_ORIGINAL',
  'BS-01--BENIGN_ORIGINAL',
  'BR-01--ADVERSARIAL_SCOPE',
  'LE-01--ADVERSARIAL_SCOPE',
  'BA-01--ADVERSARIAL_SCOPE',
  'TR-02--ADVERSARIAL_SCOPE',
  'AP-02--ADVERSARIAL_BUDGET',
  'SS-02--ADVERSARIAL_BUDGET',
  'BS-02--ADVERSARIAL_BUDGET',
  'BR-02--ADVERSARIAL_BUDGET',
  'LE-02--ADVERSARIAL_COMPOSITION',
  'BA-02--ADVERSARIAL_COMPOSITION',
  'TR-03--ADVERSARIAL_COMPOSITION',
  'AP-03--ADVERSARIAL_COMPOSITION',
  'SS-03--BENIGN_DRIFT',
  'BS-03--BENIGN_DRIFT',
  'BR-03--BENIGN_DRIFT',
  'LE-03--BENIGN_DRIFT',
] as const;

const FreezeReviewCaseIdSchema = z.enum(FREEZE_REVIEW_CASE_IDS);
const ReviewedCaseIdsSchema = z
  .array(FreezeReviewCaseIdSchema)
  .length(FREEZE_REVIEW_CASE_IDS.length)
  .refine((ids) => new Set(ids).size === FREEZE_REVIEW_CASE_IDS.length, 'case IDs must be unique');
const ReproducedCaseSchema = z
  .object({
    caseId: FreezeReviewCaseIdSchema,
    reproduced: z.boolean(),
    result: z.enum(['MATCHED_EXPECTATION', 'MISMATCHED_EXPECTATION', 'INCONCLUSIVE']),
    notes: z.string().trim().min(1).max(1_000),
  })
  .strict();
const ReproducedCasesSchema = z
  .array(ReproducedCaseSchema)
  .length(FREEZE_REVIEW_CASE_IDS.length)
  .refine(
    (cases) => new Set(cases.map((reviewCase) => reviewCase.caseId)).size === cases.length,
    'reproduced case IDs must be unique',
  );
const ApprovedReproducedCasesSchema = z
  .array(
    ReproducedCaseSchema.extend({
      reproduced: z.literal(true),
      result: z.literal('MATCHED_EXPECTATION'),
    }),
  )
  .length(FREEZE_REVIEW_CASE_IDS.length)
  .refine(
    (cases) => new Set(cases.map((reviewCase) => reviewCase.caseId)).size === cases.length,
    'reproduced case IDs must be unique',
  );

const ReviewChecksSchema = z
  .object({
    protocolConfigReviewed: z.boolean(),
    implementationScopeReviewed: z.boolean(),
    caseManifestReviewed: z.boolean(),
    m2CompletionReviewed: z.boolean(),
    retryPolicyReviewed: z.boolean(),
  })
  .strict();

export const FreezeReviewRecordSchema = z
  .object({
    schemaVersion: z.literal('0.2'),
    status: z.enum(['PENDING', 'APPROVED']),
    reviewedCommit: GitCommitSchema.nullable(),
    reviewerPseudonym: z.string().min(3).max(64),
    reviewerType: z.literal('HUMAN'),
    independenceAttestation: z.boolean(),
    reviewedAt: z.iso.datetime().nullable(),
    dryRunEvidence: FreezeDryRunEvidenceBindingSchema.nullable(),
    dryRunCases: z.number().int().nonnegative(),
    reviewedCaseIds: ReviewedCaseIdsSchema,
    reproducedCases: ReproducedCasesSchema,
    checks: ReviewChecksSchema,
    notes: z.string().min(1).max(4_000),
  })
  .strict();

export const ApprovedFreezeReviewRecordSchema = FreezeReviewRecordSchema.safeExtend({
  status: z.literal('APPROVED'),
  reviewedCommit: GitCommitSchema,
  independenceAttestation: z.literal(true),
  reviewedAt: z.iso.datetime(),
  dryRunEvidence: FreezeDryRunEvidenceBindingSchema,
  dryRunCases: z.literal(FREEZE_REVIEW_CASE_IDS.length),
  reviewedCaseIds: ReviewedCaseIdsSchema,
  reproducedCases: ApprovedReproducedCasesSchema,
  checks: ReviewChecksSchema.extend({
    protocolConfigReviewed: z.literal(true),
    implementationScopeReviewed: z.literal(true),
    caseManifestReviewed: z.literal(true),
    m2CompletionReviewed: z.literal(true),
    retryPolicyReviewed: z.literal(true),
  }),
}).superRefine((review, context) => {
  if (review.reviewedCommit !== review.dryRunEvidence.candidateCommit) {
    context.addIssue({
      code: 'custom',
      path: ['dryRunEvidence', 'candidateCommit'],
      message: 'dry-run candidate commit must equal the reviewed commit',
    });
  }
});

export type ApprovedFreezeReviewRecord = z.infer<typeof ApprovedFreezeReviewRecordSchema>;

export const SoloFreezeReviewRecordSchema = z
  .object({
    ...FreezeReviewRecordSchema.shape,
    schemaVersion: z.literal('0.3'),
    reviewMode: z.literal('SOLO_AI_ASSISTED'),
    status: z.enum(['PENDING', 'COMPLETE_AI_ASSISTED']),
    reviewerType: z.literal('AI'),
    independenceAttestation: z.literal(false),
    finalAuthorApproval: z.literal('PENDING'),
    independentHumanReviewClaim: z.literal(false),
  })
  .strict();

export const CompletedSoloFreezeReviewRecordSchema = SoloFreezeReviewRecordSchema.safeExtend({
  status: z.literal('COMPLETE_AI_ASSISTED'),
  reviewedCommit: GitCommitSchema,
  reviewedAt: z.iso.datetime(),
  dryRunEvidence: FreezeDryRunEvidenceBindingSchema,
  dryRunCases: z.literal(FREEZE_REVIEW_CASE_IDS.length),
  reproducedCases: ApprovedReproducedCasesSchema,
  checks: ApprovedFreezeReviewRecordSchema.shape.checks,
}).superRefine((review, context) => {
  if (review.reviewedCommit !== review.dryRunEvidence.candidateCommit) {
    context.addIssue({
      code: 'custom',
      path: ['dryRunEvidence', 'candidateCommit'],
      message: 'dry-run candidate commit must equal the reviewed commit',
    });
  }
});

export const AnyFreezeReviewRecordSchema = z.union([
  FreezeReviewRecordSchema,
  SoloFreezeReviewRecordSchema,
]);
export const AcceptedFreezeReviewRecordSchema = z.union([
  ApprovedFreezeReviewRecordSchema,
  CompletedSoloFreezeReviewRecordSchema,
]);
export type AcceptedFreezeReviewRecord = z.infer<typeof AcceptedFreezeReviewRecordSchema>;

/** AI review can authorize reproducibility runs only under an explicit solo protocol. */
export function validateFreezeReviewForProtocol(
  input: unknown,
  expectedCommit: string,
  expectedTree: string | undefined,
  reviewMode: 'INDEPENDENT_HUMAN' | 'SOLO_AI_ASSISTED' = 'INDEPENDENT_HUMAN',
): AcceptedFreezeReviewRecord {
  if (reviewMode === 'INDEPENDENT_HUMAN') {
    return validateApprovedFreezeReview(input, expectedCommit, expectedTree);
  }
  const review = CompletedSoloFreezeReviewRecordSchema.parse(input);
  if (review.reviewedCommit !== expectedCommit) {
    throw new Error('AI freeze review must target the exact candidate HEAD');
  }
  if (expectedTree !== undefined && review.dryRunEvidence.candidateTree !== expectedTree) {
    throw new Error('AI freeze review must target the exact candidate tree');
  }
  return review;
}

export function validateFreezeReviewCaseManifest(
  reviewedCaseIds: readonly string[],
  entriesInput: unknown,
): void {
  const entries = z
    .array(
      z
        .object({
          caseId: z.string().min(1),
          workflow: z.string().min(1),
          variant: z.string().min(1),
        })
        .loose(),
    )
    .parse(entriesInput);
  const reviewed = reviewedCaseIds.map((caseId) => {
    const entry = entries.find((candidate) => candidate.caseId === caseId);
    if (!entry) throw new Error(`freeze review case is absent from the case manifest: ${caseId}`);
    return entry;
  });
  if (new Set(reviewed.map((entry) => entry.caseId)).size !== FREEZE_REVIEW_CASE_IDS.length) {
    throw new Error('freeze review case IDs are not unique');
  }
  const variantCounts = new Map<string, number>();
  const workflowCounts = new Map<string, number>();
  for (const entry of reviewed) {
    variantCounts.set(entry.variant, (variantCounts.get(entry.variant) ?? 0) + 1);
    workflowCounts.set(entry.workflow, (workflowCounts.get(entry.workflow) ?? 0) + 1);
  }
  if (variantCounts.size !== 5 || [...variantCounts.values()].some((count) => count !== 4)) {
    throw new Error('freeze review cases must contain exactly four cases per evaluation variant');
  }
  const workflowDistribution = [...workflowCounts.values()].sort((left, right) => left - right);
  if (JSON.stringify(workflowDistribution) !== JSON.stringify([2, 3, 3, 3, 3, 3, 3])) {
    throw new Error('freeze review cases must be balanced across all seven workflows');
  }
}

export const M2FreezeValidationSchema = z
  .object({
    reviewProtocol: z
      .union([
        z.object({ schemaVersion: z.literal('0.1'), mode: z.literal('DUAL_HUMAN') }).strict(),
        z
          .object({
            schemaVersion: z.literal('0.1'),
            mode: z.literal('SOLO_AI_ASSISTED'),
            finalAuthorApproval: z.literal('PENDING'),
            independentHumanReviewClaim: z.literal(false),
          })
          .loose(),
      ])
      .optional(),
    aiAssistedReviewEvidence: z
      .object({
        recordStatus: z.enum(['PENDING', 'COMPLETE_AI_ASSISTED']),
        reviewerType: z.literal('AI'),
        independenceAttestation: z.literal(false),
        independentHumanReviewClaim: z.literal(false),
        finalAuthorApproval: z.literal('PENDING'),
        scope: z.literal('CONTRACT_CONDITIONED_REPRODUCIBILITY'),
        submissionCount: z.number().int().nonnegative(),
        submissionSha256: Sha256Schema.nullable(),
        caseCount: z.number().int().nonnegative(),
        blockers: z.array(z.string()),
      })
      .loose()
      .optional(),
    experimentReady: z.boolean().optional(),
    datasetVersion: z.literal(BENCHMARK_DATASET_VERSION),
    baseCount: z.literal(80),
    executedBaseCount: z.number().int().nonnegative(),
    strictAuthoredFixtureExecutedBaseCount: z.number().int().nonnegative(),
    cleanCommittedExecutedBaseCount: z.number().int().nonnegative(),
    executionFinalGoalPassCount: z.number().int().nonnegative(),
    strictAuthoredFixtureFinalGoalPassCount: z.number().int().nonnegative(),
    baseReferencePass: z.number().int().nonnegative(),
    baseReferenceLabelDisagreements: z.array(z.string()),
    syntheticReferenceCheckedCount: z.number().int().nonnegative(),
    syntheticReferenceDisagreementCount: z.number().int().nonnegative(),
    executionEvidenceStatus: z.string().min(1),
    independentReviewEvidence: z
      .object({
        recordStatus: z.string().min(1),
        submissionCount: z.number().int().nonnegative(),
        blockers: z.array(z.string()),
      })
      .loose(),
    llmBaselineEvidence: z
      .object({
        resultPath: z.literal(LLM_BASELINE_RESULT_PATH),
        reviewPacketPath: z.literal(LLM_BASELINE_REVIEW_PACKET_PATH),
        rationaleReviewPath: z.enum([LLM_RATIONALE_REVIEW_PATH, LLM_AI_RATIONALE_REVIEW_PATH]),
        expectedDatasetVersion: z.literal(BENCHMARK_DATASET_VERSION),
        runStatus: z.enum(['PENDING', 'COMPLETE']),
        codeCommit: GitCommitSchema.nullable(),
        workingTreeDirty: z.boolean().nullable(),
        sampleSize: z.number().int().nonnegative(),
        inputSha256: Sha256Schema.nullable(),
        configSha256: Sha256Schema,
        protocolSha256: Sha256Schema,
        resultSha256: Sha256Schema.nullable(),
        reviewPacketSha256: Sha256Schema.nullable(),
        runBlockers: z.array(z.string()),
        rationaleReview: z
          .object({
            status: z.enum(['PENDING', 'COMPLETE', 'COMPLETE_AI_ASSISTED']),
            reviewerPseudonym: z
              .string()
              .regex(/^[A-Za-z0-9_-]{2,64}$/)
              .nullable(),
            reviewerType: z.enum(['HUMAN', 'AI']).nullable(),
            independenceAttestation: z.boolean().nullable(),
            reviewedAt: z.iso.datetime().nullable(),
            reviewedCommit: GitCommitSchema.nullable(),
            caseCount: z.number().int().nonnegative(),
            submissionSha256: Sha256Schema.nullable(),
            blockers: z.array(z.string()),
          })
          .loose(),
      })
      .loose(),
    completionCriteria: z.object({
      executionComplete: z.boolean(),
      referenceOracleComplete: z.boolean(),
      llmBaselineComplete: z.boolean(),
    }),
    independentReviewStatus: z.string().min(1),
    m2Complete: z.boolean(),
  })
  .loose();

export type M2FreezeValidation = z.infer<typeof M2FreezeValidationSchema>;

export interface M2CompletionEvidence {
  reviewMode?: 'INDEPENDENT_HUMAN' | 'SOLO_AI_ASSISTED';
  aiBenchmarkReviewStatus?: 'PENDING' | 'COMPLETE_AI_ASSISTED';
  finalAuthorApproval?: 'PENDING';
  baseCount: number;
  executedBaseCount: number;
  strictAuthoredFixtureExecutedBaseCount: number;
  cleanCommittedExecutedBaseCount: number;
  executionEvidenceStatus: string;
  executionFinalGoalPassCount: number;
  strictAuthoredFixtureFinalGoalPassCount: number;
  baseReferencePass: number;
  baseReferenceLabelDisagreementCount: number;
  syntheticReferenceCheckedCount: number;
  syntheticReferenceDisagreementCount: number;
  reviewGateStatus: 'PENDING' | 'RECORDS_COMPLETE';
  llmBaselineRunStatus: 'PENDING' | 'COMPLETE';
  llmRationaleReviewStatus: 'PENDING' | 'COMPLETE' | 'COMPLETE_AI_ASSISTED';
}

/**
 * Derives completion only from published execution provenance, authored-oracle checks,
 * and machine-validated human review records. It intentionally cannot attest reviewer
 * identity or independence beyond the submitted records.
 */
export function deriveM2Completion(evidence: M2CompletionEvidence): {
  executionComplete: boolean;
  referenceOracleComplete: boolean;
  llmBaselineComplete: boolean;
  independentReviewStatus: 'PENDING' | 'COMPLETE';
  experimentReady: boolean;
  m2Complete: boolean;
} {
  const executionComplete =
    evidence.baseCount > 0 &&
    evidence.executionEvidenceStatus === 'CLEAN_COMMITTED_CANDIDATE' &&
    evidence.executedBaseCount === evidence.baseCount &&
    evidence.strictAuthoredFixtureExecutedBaseCount === evidence.baseCount &&
    evidence.cleanCommittedExecutedBaseCount === evidence.baseCount &&
    evidence.executionFinalGoalPassCount === evidence.baseCount &&
    evidence.strictAuthoredFixtureFinalGoalPassCount === evidence.baseCount;
  const referenceOracleComplete =
    evidence.baseCount > 0 &&
    evidence.baseReferencePass === evidence.baseCount &&
    evidence.baseReferenceLabelDisagreementCount === 0 &&
    evidence.syntheticReferenceCheckedCount === evidence.baseCount &&
    evidence.syntheticReferenceDisagreementCount === 0;
  const solo = evidence.reviewMode === 'SOLO_AI_ASSISTED';
  const llmBaselineComplete =
    evidence.llmBaselineRunStatus === 'COMPLETE' &&
    evidence.llmRationaleReviewStatus === (solo ? 'COMPLETE_AI_ASSISTED' : 'COMPLETE');
  const independentReviewStatus =
    !solo && evidence.reviewGateStatus === 'RECORDS_COMPLETE' ? 'COMPLETE' : 'PENDING';
  const experimentReady =
    executionComplete &&
    referenceOracleComplete &&
    llmBaselineComplete &&
    (solo
      ? evidence.aiBenchmarkReviewStatus === 'COMPLETE_AI_ASSISTED' &&
        evidence.finalAuthorApproval === 'PENDING'
      : independentReviewStatus === 'COMPLETE');
  return {
    executionComplete,
    referenceOracleComplete,
    llmBaselineComplete,
    independentReviewStatus,
    experimentReady,
    m2Complete: !solo && experimentReady,
  };
}

export function validateApprovedFreezeReview(
  input: unknown,
  expectedCommit: string,
  expectedTree?: string,
): ApprovedFreezeReviewRecord {
  const review = ApprovedFreezeReviewRecordSchema.parse(input);
  if (review.reviewedCommit !== expectedCommit) {
    throw new Error(
      `freeze review targets ${review.reviewedCommit}, but the candidate HEAD is ${expectedCommit}`,
    );
  }
  if (expectedTree !== undefined && review.dryRunEvidence.candidateTree !== expectedTree) {
    throw new Error(
      `freeze dry-run targets tree ${review.dryRunEvidence.candidateTree}, but the candidate tree is ${expectedTree}`,
    );
  }
  return review;
}

export function validateM2ReadyForFreeze(
  input: unknown,
  expectedReviewMode: 'INDEPENDENT_HUMAN' | 'SOLO_AI_ASSISTED' = 'INDEPENDENT_HUMAN',
): M2FreezeValidation {
  const validation = M2FreezeValidationSchema.parse(input);
  const solo = expectedReviewMode === 'SOLO_AI_ASSISTED';
  const rationale = validation.llmBaselineEvidence.rationaleReview;
  const reviewReady = solo
    ? validation.reviewProtocol?.mode === 'SOLO_AI_ASSISTED' &&
      validation.experimentReady === true &&
      !validation.m2Complete &&
      validation.independentReviewStatus === 'PENDING' &&
      validation.aiAssistedReviewEvidence?.recordStatus === 'COMPLETE_AI_ASSISTED' &&
      validation.aiAssistedReviewEvidence.submissionCount === 1 &&
      validation.aiAssistedReviewEvidence.submissionSha256 !== null &&
      validation.aiAssistedReviewEvidence.caseCount === 20 &&
      validation.aiAssistedReviewEvidence.blockers.length === 0 &&
      validation.llmBaselineEvidence.rationaleReviewPath === LLM_AI_RATIONALE_REVIEW_PATH &&
      rationale.status === 'COMPLETE_AI_ASSISTED' &&
      rationale.reviewerType === 'AI' &&
      rationale.independenceAttestation === false
    : validation.reviewProtocol?.mode !== 'SOLO_AI_ASSISTED' &&
      validation.m2Complete &&
      validation.independentReviewStatus === 'COMPLETE' &&
      validation.independentReviewEvidence.recordStatus === 'RECORDS_COMPLETE' &&
      validation.independentReviewEvidence.submissionCount === 2 &&
      validation.independentReviewEvidence.blockers.length === 0 &&
      validation.llmBaselineEvidence.rationaleReviewPath === LLM_RATIONALE_REVIEW_PATH &&
      rationale.status === 'COMPLETE' &&
      rationale.reviewerType === 'HUMAN' &&
      rationale.independenceAttestation === true;
  const executionComplete = ['COMPLETE', 'CLEAN_COMMITTED_CANDIDATE'].includes(
    validation.executionEvidenceStatus,
  );
  if (
    !reviewReady ||
    !executionComplete ||
    validation.executedBaseCount !== validation.baseCount ||
    validation.strictAuthoredFixtureExecutedBaseCount !== validation.baseCount ||
    validation.cleanCommittedExecutedBaseCount !== validation.baseCount ||
    validation.executionFinalGoalPassCount !== validation.baseCount ||
    validation.strictAuthoredFixtureFinalGoalPassCount !== validation.baseCount ||
    validation.baseReferencePass !== validation.baseCount ||
    validation.baseReferenceLabelDisagreements.length !== 0 ||
    validation.syntheticReferenceCheckedCount !== validation.baseCount ||
    validation.syntheticReferenceDisagreementCount !== 0 ||
    validation.llmBaselineEvidence.runStatus !== 'COMPLETE' ||
    validation.llmBaselineEvidence.codeCommit === null ||
    validation.llmBaselineEvidence.workingTreeDirty !== false ||
    validation.llmBaselineEvidence.sampleSize !== 20 ||
    validation.llmBaselineEvidence.inputSha256 === null ||
    validation.llmBaselineEvidence.resultSha256 === null ||
    validation.llmBaselineEvidence.reviewPacketSha256 === null ||
    validation.llmBaselineEvidence.runBlockers.length !== 0 ||
    validation.llmBaselineEvidence.rationaleReview.reviewerPseudonym === null ||
    validation.llmBaselineEvidence.rationaleReview.reviewedAt === null ||
    validation.llmBaselineEvidence.rationaleReview.reviewedCommit !==
      validation.llmBaselineEvidence.codeCommit ||
    validation.llmBaselineEvidence.rationaleReview.caseCount !== 20 ||
    validation.llmBaselineEvidence.rationaleReview.submissionSha256 === null ||
    validation.llmBaselineEvidence.rationaleReview.blockers.length !== 0 ||
    !validation.completionCriteria.executionComplete ||
    !validation.completionCriteria.referenceOracleComplete ||
    !validation.completionCriteria.llmBaselineComplete
  ) {
    throw new Error(
      'M2 is not freeze-ready: require complete clean execution, reference/oracle checks for all 80 authored fixtures, zero synthetic reference disagreements, a bound v0.4 LLM run with complete rationale review, and review records matching the explicit protocol',
    );
  }
  return validation;
}

export interface FreezeTransitionEvidence {
  reviewedCommit: string;
  executionCommit: string;
  parentCommits: readonly string[];
  changedPaths: readonly string[];
  humanReviewPath: string;
  dryRunEvidenceDirectory: string;
}

/**
 * Validates the non-self-referential A -> B freeze transition. A is the human-reviewed semantic
 * candidate; B must be its direct child and may contain only the two freeze envelopes, immutable
 * human review record, and the review's exact three dry-run artifacts. Semantic digest equality is
 * checked separately by each caller.
 */
export function validateFreezeTransition(evidence: FreezeTransitionEvidence): {
  reviewedCommit: string;
  executionCommit: string;
  changedPaths: string[];
} {
  const reviewedCommit = GitCommitSchema.parse(evidence.reviewedCommit);
  const executionCommit = GitCommitSchema.parse(evidence.executionCommit);
  if (executionCommit === reviewedCommit) {
    throw new Error('freeze transition requires a distinct commit after the reviewed candidate');
  }
  const parents = evidence.parentCommits.map((commit) => GitCommitSchema.parse(commit));
  if (parents.length !== 1 || parents[0] !== reviewedCommit) {
    throw new Error('freeze commit must have the reviewed candidate as its only direct parent');
  }
  const humanReviewPath = RepoRelativeJsonPathSchema.parse(
    evidence.humanReviewPath.replaceAll('\\', '/'),
  );
  const dryRunEvidenceDirectory = FreezeDryRunEvidenceDirectorySchema.parse(
    evidence.dryRunEvidenceDirectory.replaceAll('\\', '/'),
  );
  const changedPaths = evidence.changedPaths.map((path) => path.replaceAll('\\', '/')).sort();
  if (new Set(changedPaths).size !== changedPaths.length) {
    throw new Error('freeze transition contains duplicate changed paths');
  }
  const expectedPaths = [
    FROZEN_ABLATION_CONFIG_PATH,
    FROZEN_EVALUATION_CONFIG_PATH,
    humanReviewPath,
    `${dryRunEvidenceDirectory}/cases.jsonl`,
    `${dryRunEvidenceDirectory}/manifest.json`,
    `${dryRunEvidenceDirectory}/summary.json`,
  ].sort();
  if (JSON.stringify(changedPaths) !== JSON.stringify(expectedPaths)) {
    throw new Error(
      `freeze transition may change only the two freeze manifests, review record, and its three dry-run artifacts; observed ${changedPaths.join(', ')}`,
    );
  }
  return { reviewedCommit, executionCommit, changedPaths };
}

export function sha256Source(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

export function resolveRepoRelativeJson(
  repositoryRoot: string,
  candidatePath: string,
): { path: string; absolutePath: string } {
  const slashPath = candidatePath.replaceAll('\\', '/');
  RepoRelativeJsonPathSchema.parse(slashPath);
  if (isAbsolute(candidatePath)) throw new Error('review path must be repository-relative');
  const absolutePath = resolve(repositoryRoot, slashPath);
  const relativePath = relative(repositoryRoot, absolutePath).replaceAll('\\', '/');
  if (relativePath.startsWith('../') || isAbsolute(relativePath)) {
    throw new Error('review path resolves outside the repository');
  }
  return { path: RepoRelativeJsonPathSchema.parse(relativePath), absolutePath };
}
