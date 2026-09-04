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
