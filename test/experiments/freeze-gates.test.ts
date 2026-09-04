import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  FREEZE_REVIEW_CASE_IDS,
  FROZEN_ABLATION_CONFIG_PATH,
  FROZEN_EVALUATION_CONFIG_PATH,
  FreezeReviewRecordSchema,
  deriveM2Completion,
  resolveRepoRelativeJson,
  validateApprovedFreezeReview,
  validateFreezeReviewCaseManifest,
  validateFreezeTransition,
  validateM2ReadyForFreeze,
} from '../../src/experiments/freeze-gates.js';

const head = 'a'.repeat(40);
const tree = 'b'.repeat(40);
const approvedReview = {
  schemaVersion: '0.2',
  status: 'APPROVED',
  reviewedCommit: head,
  reviewerPseudonym: 'reviewer-a',
  reviewerType: 'HUMAN',
  independenceAttestation: true,
  reviewedAt: '2026-09-04T00:00:00.000Z',
  dryRunEvidence: {
    outputDirectory: 'experiments/results/freeze-dry-runs/freeze-review-test',
    runId: 'freeze-review-test',
    candidateCommit: head,
    candidateTree: tree,
    manifestSha256: 'c'.repeat(64),
    casesJsonlSha256: 'd'.repeat(64),
    summarySha256: 'e'.repeat(64),
  },
  dryRunCases: 20,
  reviewedCaseIds: [...FREEZE_REVIEW_CASE_IDS],
  reproducedCases: FREEZE_REVIEW_CASE_IDS.map((caseId) => ({
    caseId,
    reproduced: true as const,
    result: 'MATCHED_EXPECTATION' as const,
    notes: 'Reproduced from the frozen case input.',
  })),
  checks: {
    protocolConfigReviewed: true,
    implementationScopeReviewed: true,
    caseManifestReviewed: true,
    m2CompletionReviewed: true,
    retryPolicyReviewed: true,
  },
  notes: 'Independent review completed against the recorded candidate commit.',
} as const;

const completedM2 = {
  datasetVersion: '0.3.0',
  baseCount: 80,
  executedBaseCount: 80,
  strictAuthoredFixtureExecutedBaseCount: 80,
  cleanCommittedExecutedBaseCount: 80,
  executionFinalGoalPassCount: 80,
  strictAuthoredFixtureFinalGoalPassCount: 80,
  baseReferencePass: 80,
  baseReferenceLabelDisagreements: [],
  executionEvidenceStatus: 'COMPLETE',
  independentReviewEvidence: {
    recordStatus: 'RECORDS_COMPLETE',
    submissionCount: 2,
    blockers: [],
  },
  completionCriteria: { executionComplete: true, referenceOracleComplete: true },
  independentReviewStatus: 'COMPLETE',
  m2Complete: true,
};

describe('evaluation freeze gates', () => {
  it('derives M2 completion only from all execution, oracle, and review evidence', () => {
    const evidence = {
      baseCount: 80,
      executedBaseCount: 80,
      strictAuthoredFixtureExecutedBaseCount: 80,
      cleanCommittedExecutedBaseCount: 80,
      executionEvidenceStatus: 'CLEAN_COMMITTED_CANDIDATE',
      executionFinalGoalPassCount: 80,
      strictAuthoredFixtureFinalGoalPassCount: 80,
      baseReferencePass: 80,
      baseReferenceLabelDisagreementCount: 0,
      reviewGateStatus: 'RECORDS_COMPLETE',
    } as const;
    expect(deriveM2Completion(evidence)).toEqual({
      executionComplete: true,
      referenceOracleComplete: true,
      independentReviewStatus: 'COMPLETE',
      m2Complete: true,
    });
    expect(deriveM2Completion({ ...evidence, reviewGateStatus: 'PENDING' }).m2Complete).toBe(false);
    expect(
      deriveM2Completion({ ...evidence, strictAuthoredFixtureFinalGoalPassCount: 79 }).m2Complete,
    ).toBe(false);
    expect(
      deriveM2Completion({ ...evidence, baseReferenceLabelDisagreementCount: 1 }).m2Complete,
    ).toBe(false);
  });

  it('requires real human approval for the exact candidate and at least twenty dry runs', () => {
    expect(validateApprovedFreezeReview(approvedReview, head, tree)).toMatchObject({
      status: 'APPROVED',
      reviewedCommit: head,
      dryRunCases: 20,
    });
    expect(() =>
      validateApprovedFreezeReview(
        {
          ...approvedReview,
          reviewedCommit: 'b'.repeat(40),
          dryRunEvidence: { ...approvedReview.dryRunEvidence, candidateCommit: 'b'.repeat(40) },
        },
        head,
      ),
    ).toThrow('candidate HEAD');
    expect(() => validateApprovedFreezeReview(approvedReview, head, 'f'.repeat(40))).toThrow(
      'candidate tree',
    );
    expect(() =>
      validateApprovedFreezeReview(
        {
          ...approvedReview,
          dryRunEvidence: { ...approvedReview.dryRunEvidence, candidateCommit: 'f'.repeat(40) },
        },
        head,
      ),
    ).toThrow('reviewed commit');
    expect(() =>
      validateApprovedFreezeReview({ ...approvedReview, dryRunCases: 19 }, head),
    ).toThrow();
    const withoutDryRunEvidence: Record<string, unknown> = { ...approvedReview };
    delete withoutDryRunEvidence.dryRunEvidence;
    expect(() => validateApprovedFreezeReview(withoutDryRunEvidence, head)).toThrow();
    expect(() =>
      validateApprovedFreezeReview({ ...approvedReview, schemaVersion: '0.1' }, head),
    ).toThrow();
    expect(() =>
      validateApprovedFreezeReview(
        {
          ...approvedReview,
          dryRunEvidence: {
            ...approvedReview.dryRunEvidence,
            outputDirectory: 'experiments/results/freeze-dry-runs/nested/freeze-review-test',
          },
        },
        head,
      ),
    ).toThrow('direct child');
    expect(() =>
      validateApprovedFreezeReview(
        {
          ...approvedReview,
          reproducedCases: approvedReview.reproducedCases.map((reviewCase, index) =>
            index === 0 ? { ...reviewCase, reproduced: false } : reviewCase,
          ),
        },
        head,
      ),
    ).toThrow();
  });

  it('binds the reviewed IDs to the preregistered workflow/variant-stratified manifest cases', () => {
    const manifest = JSON.parse(readFileSync('experiments/configs/case-manifest.json', 'utf8')) as {
      entries: unknown[];
    };
    expect(() => {
      validateFreezeReviewCaseManifest(FREEZE_REVIEW_CASE_IDS, manifest.entries);
    }).not.toThrow();
    expect(() => {
      validateFreezeReviewCaseManifest(
        [...FREEZE_REVIEW_CASE_IDS.slice(0, -1), 'MISSING--BENIGN_DRIFT'],
        manifest.entries,
      );
    }).toThrow('absent from the case manifest');
  });

  it('permits only the direct A-to-B six-file freeze transition', () => {
    const executionCommit = 'b'.repeat(40);
    const dryRunEvidenceDirectory = approvedReview.dryRunEvidence.outputDirectory;
    const changedPaths = [
      FROZEN_EVALUATION_CONFIG_PATH,
      FROZEN_ABLATION_CONFIG_PATH,
      'experiments/reviews/reviewer-a.json',
      `${dryRunEvidenceDirectory}/manifest.json`,
      `${dryRunEvidenceDirectory}/cases.jsonl`,
      `${dryRunEvidenceDirectory}/summary.json`,
    ];
    expect(
      validateFreezeTransition({
        reviewedCommit: head,
        executionCommit,
        parentCommits: [head],
        changedPaths,
        humanReviewPath: 'experiments/reviews/reviewer-a.json',
        dryRunEvidenceDirectory,
      }),
    ).toMatchObject({ reviewedCommit: head, executionCommit });
    expect(() =>
      validateFreezeTransition({
        reviewedCommit: head,
        executionCommit,
        parentCommits: [head],
        changedPaths: [...changedPaths, 'src/experiments/metrics.ts'],
        humanReviewPath: 'experiments/reviews/reviewer-a.json',
        dryRunEvidenceDirectory,
      }),
    ).toThrow('may change only');
    expect(() =>
      validateFreezeTransition({
        reviewedCommit: head,
        executionCommit,
        parentCommits: [head],
        changedPaths: changedPaths.filter(
          (path) => !path.startsWith(`${dryRunEvidenceDirectory}/`),
        ),
        humanReviewPath: 'experiments/reviews/reviewer-a.json',
        dryRunEvidenceDirectory,
      }),
    ).toThrow('three dry-run artifacts');
    expect(() =>
      validateFreezeTransition({
        reviewedCommit: head,
        executionCommit,
        parentCommits: ['c'.repeat(40)],
        changedPaths,
        humanReviewPath: 'experiments/reviews/reviewer-a.json',
        dryRunEvidenceDirectory,
      }),
    ).toThrow('only direct parent');
  });

  it('requires complete clean M2 execution and complete independent review', () => {
    expect(validateM2ReadyForFreeze(completedM2)).toMatchObject({ m2Complete: true });
    expect(() =>
      validateM2ReadyForFreeze({ ...completedM2, independentReviewStatus: 'PENDING' }),
    ).toThrow('M2 is not freeze-ready');
    expect(() =>
      validateM2ReadyForFreeze({ ...completedM2, cleanCommittedExecutedBaseCount: 79 }),
    ).toThrow('M2 is not freeze-ready');
  });

  it('rejects the repository current pending M2 state and pending review template', () => {
    const currentM2: unknown = JSON.parse(
      readFileSync('experiments/configs/m2-validation.json', 'utf8'),
    );
    const reviewTemplate: unknown = JSON.parse(
      readFileSync('experiments/configs/freeze-review.template.json', 'utf8'),
    );
    expect(() => validateM2ReadyForFreeze(currentM2)).toThrow('M2 is not freeze-ready');
    expect(FreezeReviewRecordSchema.parse(reviewTemplate)).toMatchObject({
      status: 'PENDING',
      dryRunCases: 0,
    });
    expect(() => validateApprovedFreezeReview(reviewTemplate, head)).toThrow();
  });

  it('refuses absolute and traversal paths', () => {
    expect(() => resolveRepoRelativeJson(process.cwd(), '../review.json')).toThrow();
    expect(() => resolveRepoRelativeJson(process.cwd(), 'C:/review.json')).toThrow();
    expect(resolveRepoRelativeJson(process.cwd(), 'experiments/reviews/review.json').path).toBe(
      'experiments/reviews/review.json',
    );
  });
});
