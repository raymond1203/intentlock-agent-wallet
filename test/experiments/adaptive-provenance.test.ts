import { readFileSync } from 'node:fs';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import {
  assertAdaptiveExecutionContext,
  validateAdaptivePrimaryManifestBinding,
  validateJointAdaptiveFreeze,
} from '../../src/experiments/adaptive-provenance.js';
import type { FreezeDigests } from '../../src/experiments/freeze-digests.js';
import { FrozenEvalConfigSchema } from '../../src/experiments/protocol.js';
import { AblationManifestSchema } from '../../src/experiments/ablations.js';
import {
  EvaluationRunManifestSchema,
  assertPrimaryRunManifestIdentity,
} from '../../src/experiments/run-artifacts.js';

const candidateEvaluation = FrozenEvalConfigSchema.parse(
  parse(readFileSync('experiments/configs/frozen-eval.yaml', 'utf8')),
);
const candidateAblation = AblationManifestSchema.parse(
  JSON.parse(readFileSync('experiments/configs/ablations/manifest.json', 'utf8')),
);

const reviewedSourceCommit = 'a'.repeat(40);
const freezeCommit = 'b'.repeat(40);
const frozenAt = '2026-09-04T00:00:00.000Z';
const humanReviewer = 'independent-reviewer';
const freezeDigests: FreezeDigests = {
  dependencyDigestSha256: '1'.repeat(64),
  datasetDigestSha256: '2'.repeat(64),
  caseManifestDigestSha256: '3'.repeat(64),
  promptDigestSha256: '4'.repeat(64),
  toolSchemaDigestSha256: '5'.repeat(64),
  metricImplementationDigestSha256: '6'.repeat(64),
  protocolConfigDigestSha256: '7'.repeat(64),
  evaluationConfigDigestSha256: '8'.repeat(64),
  implementationDigestSha256: '9'.repeat(64),
};

function frozenInputs() {
  return {
    evaluation: {
      ...candidateEvaluation,
      reviewProtocol: undefined,
      status: 'FROZEN' as const,
      freeze: {
        gitCommit: reviewedSourceCommit,
        frozenAt,
        humanReviewer,
        humanReviewPath: 'experiments/reviews/freeze-approved.json',
        humanReviewDigestSha256: 'f'.repeat(64),
        ...freezeDigests,
      },
    },
    ablation: {
      ...candidateAblation,
      reviewProtocol: undefined,
      status: 'FROZEN' as const,
      freeze: { gitCommit: reviewedSourceCommit, frozenAt, humanReviewer },
    },
  };
}

function primaryManifest() {
  return {
    schemaVersion: '0.1',
    runId: 'primary-20260904',
    protocolVersion: '0.1',
    datasetVersion: '0.4.0',
    createdAt: '2026-09-04T01:00:00.000Z',
    gitCommit: reviewedSourceCommit,
    executionCommit: freezeCommit,
    configPath: 'experiments/configs/frozen-eval.yaml',
    configSha256: 'c'.repeat(64),
    ablationConfigSha256: 'd'.repeat(64),
    caseManifestSha256: 'e'.repeat(64),
    freezeDigests,
    systems: ['NONE', 'GUARD_MODE', 'LLM_VERIFIER', 'PER_CALL_POLICY', 'INTENTLOCK'],
    caseCount: 400,
    expectedSelectedRecords: 2_000,
    retryResultSelection: 'attempt-1-intention-to-treat-retries-operational-sensitivity-only',
    maxAttemptsPerCase: 2,
    maxTotalRetryAttempts: 2_000,
    overwrite: false,
    modelId: 'gpt-test-snapshot',
  };
}

const expectedPrimary = {
  primaryRunId: 'primary-20260904',
  reviewedSourceCommit,
  freezeCommit,
  frozenEvaluationConfigSha256: 'c'.repeat(64),
  frozenAblationConfigSha256: 'd'.repeat(64),
  caseManifestSha256: 'e'.repeat(64),
  freezeDigests,
  modelId: 'gpt-test-snapshot',
  maxAttemptsPerCase: 2,
  maxTotalRetryAttempts: 2_000,
};

describe('adaptive run provenance gates', () => {
  it('binds solo AI freeze identity and rejects a human/AI mode mismatch', () => {
    const { evaluation, ablation } = frozenInputs();
    const reviewProtocol = {
      schemaVersion: '0.1',
      mode: 'SOLO_AI_ASSISTED',
      independentHumanReviewClaim: false,
      finalAuthorApproval: 'PENDING',
    } as const;
    const soloEvaluation = {
      ...evaluation,
      reviewProtocol,
      freeze: {
        ...evaluation.freeze,
        humanReviewer: null,
        humanReviewPath: null,
        humanReviewDigestSha256: null,
        aiReview: {
          reviewerPseudonym: 'ai-check',
          reviewPath: 'experiments/reviews/ai.json',
          reviewDigestSha256: 'f'.repeat(64),
        },
      },
    };
    const soloAblation = {
      ...ablation,
      reviewProtocol,
      freeze: { ...ablation.freeze, humanReviewer: null, aiReviewer: 'ai-check' },
    };
    expect(
      validateJointAdaptiveFreeze(soloEvaluation, soloAblation).evaluation.reviewProtocol?.mode,
    ).toBe('SOLO_AI_ASSISTED');
    expect(() => validateJointAdaptiveFreeze(soloEvaluation, ablation)).toThrow();
    expect(() =>
      validateJointAdaptiveFreeze(soloEvaluation, {
        ...soloAblation,
        freeze: { ...soloAblation.freeze, aiReviewer: 'different-ai' },
      }),
    ).toThrow();
    const soloPrimary = { ...primaryManifest(), reviewProtocol };
    expect(() => validateAdaptivePrimaryManifestBinding(soloPrimary, expectedPrimary)).toThrow();
    expect(
      validateAdaptivePrimaryManifestBinding(soloPrimary, {
        ...expectedPrimary,
        reviewMode: 'SOLO_AI_ASSISTED',
      }).reviewProtocol?.mode,
    ).toBe('SOLO_AI_ASSISTED');
  });

  it('rejects candidate/unfrozen evaluation and ablation inputs', () => {
    const frozen = frozenInputs();
    expect(() =>
      validateJointAdaptiveFreeze(
        { ...candidateEvaluation, status: 'CANDIDATE_UNFROZEN' },
        frozen.ablation,
      ),
    ).toThrow();
    expect(() =>
      validateJointAdaptiveFreeze(frozen.evaluation, {
        ...candidateAblation,
        status: 'CANDIDATE_UNFROZEN',
      }),
    ).toThrow();
  });

  it('requires the two manifests to carry the same human-reviewed freeze envelope', () => {
    const { evaluation, ablation } = frozenInputs();
    expect(validateJointAdaptiveFreeze(evaluation, ablation)).toMatchObject({
      evaluation: { status: 'FROZEN' },
      ablation: { status: 'FROZEN' },
    });
    expect(() =>
      validateJointAdaptiveFreeze(evaluation, {
        ...ablation,
        freeze: { ...ablation.freeze, humanReviewer: 'different-reviewer' },
      }),
    ).toThrow(/jointly frozen/);
  });

  it('rejects dirty worktrees and an execution commit outside the freeze lineage', () => {
    expect(() => {
      assertAdaptiveExecutionContext({ dirtyWorktree: true, freezeCommitIsAncestor: true });
    }).toThrow(/clean committed worktree/);
    expect(() => {
      assertAdaptiveExecutionContext({ dirtyWorktree: false, freezeCommitIsAncestor: false });
    }).toThrow(/not an ancestor/);
  });

  it('binds the primary run to the raw jointly frozen ablation config hash', () => {
    expect(
      validateAdaptivePrimaryManifestBinding(primaryManifest(), expectedPrimary),
    ).toMatchObject({ runId: expectedPrimary.primaryRunId, executionCommit: freezeCommit });
    expect(() =>
      validateAdaptivePrimaryManifestBinding(
        { ...primaryManifest(), ablationConfigSha256: '0'.repeat(64) },
        expectedPrimary,
      ),
    ).toThrow(/provenance/);
  });

  it('rejects a primary manifest whose runId does not name its requested directory', () => {
    const manifest = EvaluationRunManifestSchema.parse(primaryManifest());
    expect(() => {
      assertPrimaryRunManifestIdentity(manifest, manifest.runId);
    }).not.toThrow();
    expect(() => {
      assertPrimaryRunManifestIdentity(manifest, 'different-primary-run');
    }).toThrow(/runId does not match/);
  });
});
