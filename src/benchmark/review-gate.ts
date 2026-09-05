import { createHash } from 'node:crypto';
import { z } from 'zod';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const pseudonym = z.string().regex(/^[a-zA-Z0-9_-]{2,64}$/);
const ReviewValuesSchema = z
  .object({
    alignment: z.enum(['ALIGNED', 'MISALIGNED', 'UNCERTAIN']),
    intermediateDecision: z.enum(['ALLOW', 'DENY', 'ABSTAIN']),
    finalStateDecision: z.enum(['PASS', 'VIOLATION', 'INSUFFICIENT_EVIDENCE', 'DISAGREEMENT']),
    evidenceAdequate: z.boolean(),
  })
  .strict();
export const HumanReviewSubmissionSchema = z
  .object({
    protocolVersion: z.literal('0.2'),
    datasetVersion: z.string().min(1),
    packetSha256: sha,
    reviewer: pseudonym,
    reviewerType: z.literal('HUMAN'),
    submittedAt: z.iso.datetime(),
    status: z.literal('SUBMITTED'),
    cases: z
      .array(
        ReviewValuesSchema.extend({
          reviewId: z.string().min(1),
          notes: z.string().trim().min(1),
        }).strict(),
      )
      .min(1),
  })
  .strict();
export const AdjudicationsSchema = z
  .object({
    packetSha256: sha,
    submissionSha256s: z.array(sha).length(2),
    cases: z.array(
      z
        .object({
          reviewId: z.string().min(1),
          resolution: ReviewValuesSchema,
          rationale: z.string().trim().min(1),
          agreedBy: z.array(pseudonym).length(2),
        })
        .strict(),
    ),
  })
  .strict();
export function reviewDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export interface ReviewRequirements {
  datasetVersion: string;
  packetSha256: string;
  reviewIds: string[];
}

export const REVIEW_PROTOCOL_PATH = 'experiments/configs/review-protocol.json';
export const AI_BENCHMARK_REVIEW_PATH = 'benchmark/reviews/ai-assisted-review-v0.4.0.json';
export const AI_LLM_REVIEW_PATH =
  'experiments/configs/baselines/llm-verifier-20-ai-review-v0.4.0.json';

/** Solo review is an explicit methodological choice, never an implicit missing-review fallback. */
export const ReviewProtocolSchema = z.discriminatedUnion('mode', [
  z.object({ schemaVersion: z.literal('0.1'), mode: z.literal('DUAL_HUMAN') }).strict(),
  z
    .object({
      schemaVersion: z.literal('0.1'),
      mode: z.literal('SOLO_AI_ASSISTED'),
      benchmarkAiReviewPath: z.literal(AI_BENCHMARK_REVIEW_PATH),
      llmAiReviewPath: z.literal(AI_LLM_REVIEW_PATH),
      finalAuthorApproval: z.literal('PENDING'),
      independentHumanReviewClaim: z.literal(false),
    })
    .strict(),
]);

export const AiAssistedReviewSchema = z
  .object({
    protocolVersion: z.literal('0.1'),
    reviewMode: z.literal('SOLO_AI_ASSISTED'),
    datasetVersion: z.string().min(1),
    packetSha256: sha,
    reviewer: pseudonym,
    reviewerType: z.literal('AI'),
    independenceAttestation: z.literal(false),
    sourceLabelsVisible: z.literal(true),
    reviewedAt: z.iso.datetime(),
    status: z.literal('COMPLETE_AI_ASSISTED'),
    finalAuthorApproval: z.literal('PENDING'),
    scope: z.literal('CONTRACT_CONDITIONED_REPRODUCIBILITY'),
    methodology: z.string().trim().min(40),
    limitations: z.array(z.string().trim().min(1)).min(1),
    cases: z
      .array(
        ReviewValuesSchema.extend({
          reviewId: z.string().min(1),
          notes: z.string().trim().min(20),
        }).strict(),
      )
      .min(1),
  })
  .strict();

/** Completion means the disclosed AI assessment exists; it does not mean its judgments all pass. */
export function evaluateAiAssistedReviewGate(
  requirements: ReviewRequirements,
  protocolInput: unknown,
  reviewInput?: unknown,
) {
  const blockers: string[] = [];
  const protocol = ReviewProtocolSchema.safeParse(protocolInput);
  if (!protocol.success || protocol.data.mode !== 'SOLO_AI_ASSISTED')
    blockers.push('explicit-solo-ai-assisted-protocol-required');
  const review = AiAssistedReviewSchema.safeParse(reviewInput);
  if (!review.success) blockers.push('ai-review:invalid-or-incomplete');
  if (
    !requirements.reviewIds.length ||
    new Set(requirements.reviewIds).size !== requirements.reviewIds.length
  )
    blockers.push('requirements:invalid-case-set');
  if (review.success) {
    if (
      review.data.packetSha256 !== requirements.packetSha256 ||
      review.data.datasetVersion !== requirements.datasetVersion
    )
      blockers.push('ai-review:stale-packet-or-dataset');
    const ids = review.data.cases.map((entry) => entry.reviewId);
    if (
      new Set(ids).size !== ids.length ||
      ids.length !== requirements.reviewIds.length ||
      requirements.reviewIds.some((id) => !ids.includes(id))
    )
      blockers.push('ai-review:case-set-mismatch');
  }
  return {
    recordStatus: blockers.length ? ('PENDING' as const) : ('COMPLETE_AI_ASSISTED' as const),
    reviewerType: 'AI' as const,
    independenceAttestation: false as const,
    independentHumanReviewClaim: false as const,
    finalAuthorApproval: 'PENDING' as const,
    scope: 'CONTRACT_CONDITIONED_REPRODUCIBILITY' as const,
    submissionCount: review.success ? 1 : 0,
    submissionSha256: review.success ? reviewDigest(reviewInput) : null,
    caseCount: review.success ? review.data.cases.length : 0,
    concerns: review.success
      ? review.data.cases
          .filter(
            (entry) =>
              entry.alignment !== 'ALIGNED' ||
              entry.intermediateDecision !== 'ALLOW' ||
              entry.finalStateDecision !== 'PASS' ||
              !entry.evidenceAdequate,
          )
          .map((entry) => ({ reviewId: entry.reviewId, notes: entry.notes }))
      : [],
    limitations: review.success ? review.data.limitations : [],
    blockers,
  };
}
/** Validates records, not human identity or independence. Those remain human attestations. */
export function evaluateReviewGate(
  requirements: ReviewRequirements,
  inputs: unknown[],
  adjudications?: unknown,
) {
  const blockers: string[] = [];
  if (
    !requirements.reviewIds.length ||
    new Set(requirements.reviewIds).size !== requirements.reviewIds.length
  )
    blockers.push('requirements:invalid-case-set');
  const submissions: z.infer<typeof HumanReviewSubmissionSchema>[] = [];
  inputs.forEach((input, index) => {
    const parsed = HumanReviewSubmissionSchema.safeParse(input);
    if (!parsed.success) blockers.push(`submission:${String(index)}:invalid-or-incomplete`);
    else submissions.push(parsed.data);
  });
  if (submissions.length !== 2) blockers.push('exactly-two-complete-human-submissions-required');
  const reviewers = submissions.map((s) => s.reviewer);
  if (new Set(reviewers).size !== reviewers.length) blockers.push('reviewers-must-be-distinct');
  for (const s of submissions) {
    if (
      s.packetSha256 !== requirements.packetSha256 ||
      s.datasetVersion !== requirements.datasetVersion
    )
      blockers.push(`${s.reviewer}:stale-packet-or-dataset`);
    const ids = s.cases.map((c) => c.reviewId);
    if (
      new Set(ids).size !== ids.length ||
      ids.length !== requirements.reviewIds.length ||
      requirements.reviewIds.some((id) => !ids.includes(id))
    )
      blockers.push(`${s.reviewer}:case-set-mismatch`);
  }
  const fields = [
    'alignment',
    'intermediateDecision',
    'finalStateDecision',
    'evidenceAdequate',
  ] as const;
  const disagreements = requirements.reviewIds.flatMap((id) => {
    const a = submissions[0]?.cases.find((c) => c.reviewId === id);
    const b = submissions[1]?.cases.find((c) => c.reviewId === id);
    if (!a || !b) return [];
    const differing = fields.filter((field) => a[field] !== b[field]);
    return differing.length ? [{ reviewId: id, fields: differing }] : [];
  });
  const submissionHashes = inputs.map(reviewDigest).sort();
  const parsedAdjudication =
    adjudications === undefined ? undefined : AdjudicationsSchema.safeParse(adjudications);
  if (parsedAdjudication && !parsedAdjudication.success) blockers.push('adjudication:invalid');
  if (parsedAdjudication?.success) {
    const a = parsedAdjudication.data;
    if (
      a.packetSha256 !== requirements.packetSha256 ||
      JSON.stringify([...a.submissionSha256s].sort()) !== JSON.stringify(submissionHashes)
    )
      blockers.push('adjudication:stale-packet-or-submissions');
    if (new Set(a.cases.map((c) => c.reviewId)).size !== a.cases.length)
      blockers.push('adjudication:duplicate-case');
    for (const c of a.cases) {
      if (!disagreements.some((d) => d.reviewId === c.reviewId))
        blockers.push(`adjudication:unexpected:${c.reviewId}`);
      if (
        new Set(c.agreedBy).size !== 2 ||
        JSON.stringify([...c.agreedBy].sort()) !== JSON.stringify([...reviewers].sort())
      )
        blockers.push(`adjudication:both-reviewers-required:${c.reviewId}`);
    }
  }
  for (const d of disagreements)
    if (
      !parsedAdjudication?.success ||
      !parsedAdjudication.data.cases.some((c) => c.reviewId === d.reviewId)
    )
      blockers.push(`adjudication:missing:${d.reviewId}`);
  return {
    status: blockers.length ? ('PENDING' as const) : ('RECORDS_COMPLETE' as const),
    identityAndIndependence: 'SELF_ATTESTED_NOT_MACHINE_VERIFIED' as const,
    reviewers,
    submissionSha256s: submissionHashes,
    disagreements,
    blockers,
  };
}
