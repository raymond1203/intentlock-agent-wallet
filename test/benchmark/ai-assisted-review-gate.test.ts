import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import {
  AI_BENCHMARK_REVIEW_PATH,
  AiAssistedReviewSchema,
  evaluateAiAssistedReviewGate,
  evaluateReviewGate,
  REVIEW_PROTOCOL_PATH,
  ReviewProtocolSchema,
  reviewDigest,
} from '../../src/benchmark/review-gate.js';

const protocol: unknown = JSON.parse(await readFile(REVIEW_PROTOCOL_PATH, 'utf8'));
const review: unknown = JSON.parse(await readFile(AI_BENCHMARK_REVIEW_PATH, 'utf8'));
const parsedReview = AiAssistedReviewSchema.parse(review);
const packet: unknown = JSON.parse(
  await readFile('benchmark/reviews/double-review-20.json', 'utf8'),
);
const requirements = {
  datasetVersion: '0.4.0',
  packetSha256: reviewDigest(packet),
  reviewIds: Array.from({ length: 20 }, (_, index) => `D${String(index + 1).padStart(2, '0')}`),
};

describe('explicit solo AI-assisted benchmark review', () => {
  it('binds the actual 20-case assessment while preserving adverse judgments and author pending', () => {
    const result = evaluateAiAssistedReviewGate(requirements, protocol, review);
    expect(result).toMatchObject({
      recordStatus: 'COMPLETE_AI_ASSISTED',
      reviewerType: 'AI',
      independenceAttestation: false,
      finalAuthorApproval: 'PENDING',
      independentHumanReviewClaim: false,
      caseCount: 20,
      blockers: [],
    });
    expect(result.concerns.some((entry) => entry.reviewId === 'D01')).toBe(true);
    expect(result.concerns.some((entry) => entry.reviewId === 'D20')).toBe(true);
  });

  it('never satisfies the existing dual-human gate', () => {
    expect(evaluateReviewGate(requirements, [review, review]).status).toBe('PENDING');
    expect(
      evaluateAiAssistedReviewGate(
        requirements,
        { schemaVersion: '0.1', mode: 'DUAL_HUMAN' },
        review,
      ).recordStatus,
    ).toBe('PENDING');
    expect(evaluateAiAssistedReviewGate(requirements, undefined, review).recordStatus).toBe(
      'PENDING',
    );
  });

  it.each([
    { reviewerType: 'HUMAN' },
    { independenceAttestation: true },
    { finalAuthorApproval: 'APPROVED' },
    { sourceLabelsVisible: false },
    { status: 'PENDING' },
    { datasetVersion: '0.3.0' },
    { packetSha256: 'a'.repeat(64) },
    { cases: parsedReview.cases.slice(1) },
    { cases: [...parsedReview.cases.slice(1), parsedReview.cases[1]] },
  ])('fails closed for fabricated approval, stale binding or incomplete cases: %j', (change) => {
    expect(
      evaluateAiAssistedReviewGate(requirements, protocol, { ...parsedReview, ...change })
        .recordStatus,
    ).toBe('PENDING');
  });

  it('rejects arbitrary review paths and claims of independent human approval', () => {
    const selected = ReviewProtocolSchema.parse(protocol);
    expect(
      ReviewProtocolSchema.safeParse({ ...selected, benchmarkAiReviewPath: '../review.json' })
        .success,
    ).toBe(false);
    expect(
      ReviewProtocolSchema.safeParse({ ...selected, independentHumanReviewClaim: true }).success,
    ).toBe(false);
  });
});
