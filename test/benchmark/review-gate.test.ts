import { describe, expect, it } from 'vitest';
import { evaluateReviewGate, reviewDigest } from '../../src/benchmark/review-gate.js';

const requirements = {
  datasetVersion: '0.2.0',
  packetSha256: 'a'.repeat(64),
  reviewIds: ['D01', 'D02'],
};
const answers = {
  alignment: 'ALIGNED',
  intermediateDecision: 'ALLOW',
  finalStateDecision: 'PASS',
  evidenceAdequate: true,
};
function submission(reviewer: string) {
  return {
    protocolVersion: '0.2',
    datasetVersion: '0.2.0',
    packetSha256: requirements.packetSha256,
    reviewer,
    reviewerType: 'HUMAN',
    submittedAt: '2026-09-03T00:00:00Z',
    status: 'SUBMITTED',
    cases: requirements.reviewIds.map((reviewId) => ({
      reviewId,
      ...answers,
      notes: 'Independent assessment.',
    })),
  };
}
describe('M2 independent review record gate', () => {
  it('never treats no submissions or a pending template as complete', () => {
    expect(evaluateReviewGate(requirements, []).status).toBe('PENDING');
    expect(
      evaluateReviewGate(requirements, [{ ...submission('A1'), reviewer: null, status: 'PENDING' }])
        .status,
    ).toBe('PENDING');
  });
  it('accepts matching complete records but does not assert identity verification', () => {
    expect(evaluateReviewGate(requirements, [submission('A1'), submission('B1')])).toMatchObject({
      status: 'RECORDS_COMPLETE',
      identityAndIndependence: 'SELF_ATTESTED_NOT_MACHINE_VERIFIED',
      disagreements: [],
    });
  });
  it.each(['reviewerType', 'packetSha256', 'datasetVersion', 'submittedAt'])(
    'rejects invalid or stale %s',
    (field) => {
      expect(
        evaluateReviewGate(requirements, [
          { ...submission('A1'), [field]: 'INVALID' },
          submission('B1'),
        ]).status,
      ).toBe('PENDING');
    },
  );
  it('rejects duplicated reviewers, cases, or additional submissions', () => {
    const a = submission('A1');
    expect(evaluateReviewGate(requirements, [a, a]).status).toBe('PENDING');
    expect(evaluateReviewGate(requirements, [a, submission('B1'), submission('C1')]).status).toBe(
      'PENDING',
    );
    expect(
      evaluateReviewGate(requirements, [
        { ...a, cases: [a.cases[0], a.cases[0]] },
        submission('B1'),
      ]).status,
    ).toBe('PENDING');
  });
  it('requires traceable adjudication for every differing judgment', () => {
    const a = submission('A1');
    const b = submission('B1');
    const first = b.cases[0];
    if (!first) throw new Error('missing test case');
    first.intermediateDecision = 'DENY';
    const records = [a, b];
    expect(evaluateReviewGate(requirements, records).disagreements).toEqual([
      { reviewId: 'D01', fields: ['intermediateDecision'] },
    ]);
    const adjudication = {
      packetSha256: requirements.packetSha256,
      submissionSha256s: records.map(reviewDigest),
      cases: [
        {
          reviewId: 'D01',
          resolution: answers,
          rationale: 'Both reviewers checked the bounded amount.',
          agreedBy: ['A1', 'B1'],
        },
      ],
    };
    expect(evaluateReviewGate(requirements, records, adjudication).status).toBe('RECORDS_COMPLETE');
    expect(
      evaluateReviewGate(requirements, records, {
        ...adjudication,
        submissionSha256s: ['b'.repeat(64), 'c'.repeat(64)],
      }).status,
    ).toBe('PENDING');
    expect(
      evaluateReviewGate(requirements, records, {
        ...adjudication,
        cases: [{ ...adjudication.cases[0], agreedBy: ['A1', 'A1'] }],
      }).status,
    ).toBe('PENDING');
  });
});
