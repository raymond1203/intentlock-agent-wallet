import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';

import { z } from 'zod';

const GitCommitSchema = z.string().regex(/^[a-f0-9]{40}$/);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const FreezeDryRunIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,99}$/);

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
    datasetVersion: z.literal('0.3.0'),
    baseCount: z.literal(80),
    executedBaseCount: z.number().int().nonnegative(),
    strictAuthoredFixtureExecutedBaseCount: z.number().int().nonnegative(),
    cleanCommittedExecutedBaseCount: z.number().int().nonnegative(),
    executionFinalGoalPassCount: z.number().int().nonnegative(),
    strictAuthoredFixtureFinalGoalPassCount: z.number().int().nonnegative(),
    baseReferencePass: z.number().int().nonnegative(),
    baseReferenceLabelDisagreements: z.array(z.string()),
    executionEvidenceStatus: z.string().min(1),
    independentReviewEvidence: z
      .object({
        recordStatus: z.string().min(1),
        submissionCount: z.number().int().nonnegative(),
        blockers: z.array(z.string()),
      })
      .loose(),
    completionCriteria: z.object({
      executionComplete: z.boolean(),
      referenceOracleComplete: z.boolean(),
    }),
    independentReviewStatus: z.string().min(1),
    m2Complete: z.boolean(),
  })
  .loose();

export type M2FreezeValidation = z.infer<typeof M2FreezeValidationSchema>;

export interface M2CompletionEvidence {
  baseCount: number;
  executedBaseCount: number;
  strictAuthoredFixtureExecutedBaseCount: number;
  cleanCommittedExecutedBaseCount: number;
  executionEvidenceStatus: string;
  executionFinalGoalPassCount: number;
  strictAuthoredFixtureFinalGoalPassCount: number;
  baseReferencePass: number;
  baseReferenceLabelDisagreementCount: number;
  reviewGateStatus: 'PENDING' | 'RECORDS_COMPLETE';
}

/**
 * Derives completion only from published execution provenance, authored-oracle checks,
 * and machine-validated human review records. It intentionally cannot attest reviewer
 * identity or independence beyond the submitted records.
 */
export function deriveM2Completion(evidence: M2CompletionEvidence): {
  executionComplete: boolean;
  referenceOracleComplete: boolean;
  independentReviewStatus: 'PENDING' | 'COMPLETE';
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
    evidence.baseReferencePass === evidence.baseCount &&
    evidence.baseReferenceLabelDisagreementCount === 0;
  const independentReviewStatus =
    evidence.reviewGateStatus === 'RECORDS_COMPLETE' ? 'COMPLETE' : 'PENDING';
  return {
    executionComplete,
    referenceOracleComplete,
    independentReviewStatus,
    m2Complete:
      executionComplete && referenceOracleComplete && independentReviewStatus === 'COMPLETE',
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

export function validateM2ReadyForFreeze(input: unknown): M2FreezeValidation {
  const validation = M2FreezeValidationSchema.parse(input);
  const executionComplete = ['COMPLETE', 'CLEAN_COMMITTED_CANDIDATE'].includes(
    validation.executionEvidenceStatus,
  );
  if (
    !validation.m2Complete ||
    !executionComplete ||
    validation.independentReviewStatus !== 'COMPLETE' ||
    validation.executedBaseCount !== validation.baseCount ||
    validation.strictAuthoredFixtureExecutedBaseCount !== validation.baseCount ||
    validation.cleanCommittedExecutedBaseCount !== validation.baseCount ||
    validation.executionFinalGoalPassCount !== validation.baseCount ||
    validation.strictAuthoredFixtureFinalGoalPassCount !== validation.baseCount ||
    validation.baseReferencePass !== validation.baseCount ||
    validation.baseReferenceLabelDisagreements.length !== 0 ||
    validation.independentReviewEvidence.recordStatus !== 'RECORDS_COMPLETE' ||
    validation.independentReviewEvidence.submissionCount !== 2 ||
    validation.independentReviewEvidence.blockers.length !== 0 ||
    !validation.completionCriteria.executionComplete ||
    !validation.completionCriteria.referenceOracleComplete
  ) {
    throw new Error(
      'M2 is not freeze-ready: require complete clean execution and reference/oracle checks for all 80 authored fixtures plus COMPLETE independent review records',
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
