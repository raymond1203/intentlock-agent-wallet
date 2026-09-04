import { z } from 'zod';

import { BENCHMARK_DATASET_VERSION } from '../benchmark/version.js';
import { AdaptiveEpisodeResultSchema } from './adaptive.js';
import { ReadyAblationManifestSchema, type AblationManifestSchema } from './ablations.js';
import { FreezeDigestsSchema, type FreezeDigests } from './freeze-digests.js';
import {
  FROZEN_ABLATION_CONFIG_PATH,
  FROZEN_EVALUATION_CONFIG_PATH,
  RepoRelativeJsonPathSchema,
} from './freeze-gates.js';
import { EvaluationRecordSchema } from './metrics.js';
import { ReadyFrozenEvalConfigSchema, type FrozenEvalConfigSchema } from './protocol.js';
import {
  EvaluationRunManifestSchema,
  PRIMARY_EVALUATION_SYSTEMS,
  type EvaluationRunManifest,
} from './run-artifacts.js';

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const GitCommitSchema = z.string().regex(/^[a-f0-9]{40}$/);

export const ADAPTIVE_SELECTION_CONFIG_PATH =
  'experiments/configs/adaptive-selection-v0.1.json' as const;
export const ADAPTIVE_FIXTURE_PATH = 'benchmark/fixtures/manifest.json' as const;
export const ADAPTIVE_COMPARISON_DESIGN = 'NON_PAIRED_NON_CAUSAL' as const;

export const AdaptiveRunManifestSchema = z
  .object({
    schemaVersion: z.literal('0.2'),
    runId: z.string().regex(/^adaptive-[a-zA-Z0-9._-]{3,70}$/),
    protocolVersion: z.literal('0.1'),
    datasetVersion: z.literal(BENCHMARK_DATASET_VERSION),
    createdAt: z.iso.datetime(),
    evaluatedAt: z.iso.datetime(),
    reviewedSourceCommit: GitCommitSchema,
    freezeCommit: GitCommitSchema,
    executionCommit: GitCommitSchema,
    freezeCommitIsAncestor: z.literal(true),
    frozenEvaluationConfigPath: z.literal(FROZEN_EVALUATION_CONFIG_PATH),
    frozenEvaluationConfigSha256: Sha256Schema,
    frozenAblationConfigPath: z.literal(FROZEN_ABLATION_CONFIG_PATH),
    frozenAblationConfigSha256: Sha256Schema,
    primaryRunId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,79}$/),
    primaryRunManifestSha256: Sha256Schema,
    primaryRawSha256: Sha256Schema,
    primarySelectedResultsSha256: Sha256Schema,
    primaryStaticIntentLockSha256: Sha256Schema,
    caseManifestPath: RepoRelativeJsonPathSchema,
    caseManifestSha256: Sha256Schema,
    selectionConfigPath: z.literal(ADAPTIVE_SELECTION_CONFIG_PATH),
    selectionConfigSha256: Sha256Schema,
    fixturePath: z.literal(ADAPTIVE_FIXTURE_PATH),
    fixtureSha256: Sha256Schema,
    selectedInputSha256: Sha256Schema,
    freezeDigests: FreezeDigestsSchema,
    humanReviewPath: RepoRelativeJsonPathSchema,
    humanReviewDigestSha256: Sha256Schema,
    m2ValidationPath: RepoRelativeJsonPathSchema,
    m2ValidationDigestSha256: Sha256Schema,
    rootSeed: z.literal(2026),
    episodeCount: z.literal(40),
    maxReplans: z.literal(3),
    executionEnvironment: z.literal('OFFLINE_SCRIPTED_SIGNER_BOUNDARY_FAKE_EXECUTOR'),
    networkRequests: z.literal(false),
    mainnetTransactions: z.literal(false),
    forkExecution: z.literal(false),
    modelAdaptiveEvidence: z.literal(false),
    simulationMode: z.literal('DECODED_EFFECT_RECEIPT_OFFLINE'),
    postStateMode: z.literal('NOT_OBSERVED'),
    claimScope: z.literal('OFFLINE_SCRIPTED_SIGNER_BOUNDARY_ONLY'),
    attackerMode: z.literal('DETERMINISTIC_SCRIPTED_NO_MODEL'),
    comparisonArtifact: z.literal('comparison.json'),
    comparisonDesign: z.literal(ADAPTIVE_COMPARISON_DESIGN),
    overwrite: z.literal(false),
  })
  .strict();
export type AdaptiveRunManifest = z.infer<typeof AdaptiveRunManifestSchema>;

const AdaptiveComparisonRowSchema = z
  .object({
    relationship: z.literal(ADAPTIVE_COMPARISON_DESIGN),
    equivalentCaseClaim: z.literal(false),
    sameAuthoredBaseScenarioIdOnly: z.literal(true),
    baseScenarioId: z.string().min(1),
    family: z.string().min(1),
    attackType: z.string().min(1),
    seed: z.number().int().nonnegative(),
    frozenStaticIntentLock: z
      .object({
        caseId: z.string().min(1),
        variant: z.literal('BENIGN_ORIGINAL'),
        primaryResultSha256: Sha256Schema,
        record: EvaluationRecordSchema,
      })
      .strict(),
    adaptiveSignerBoundary: z
      .object({
        episodeId: z.string().min(1),
        outcome: AdaptiveEpisodeResultSchema.shape.outcome,
        attemptedPlans: z.number().int().positive(),
        signerInvocations: z.number().int().nonnegative(),
        claimScope: z.literal('OFFLINE_SCRIPTED_SIGNER_BOUNDARY_ONLY'),
        attackerMode: z.literal('DETERMINISTIC_SCRIPTED_NO_MODEL'),
        postStateObservation: z.literal('NOT_OBSERVED'),
        structuralVerdict: z
          .enum(['PROVEN_VIOLATION', 'NO_VIOLATION', 'INSUFFICIENT_EVIDENCE', 'NOT_AUTHORIZED'])
          .nullable(),
      })
      .strict(),
  })
  .strict();

export const AdaptiveComparisonDocumentSchema = z
  .object({
    schemaVersion: z.literal('0.1'),
    runId: AdaptiveRunManifestSchema.shape.runId,
    createdAt: z.iso.datetime(),
    design: z.literal(ADAPTIVE_COMPARISON_DESIGN),
    interpretation: z.literal(
      'Descriptive contrast only. Rows share an authored base-scenario ID but are not paired or equivalent experimental cases, so no causal effect is estimated.',
    ),
    evidenceLimits: z
      .object({
        equivalentCases: z.literal(false),
        causalComparison: z.literal(false),
        modelAdaptiveEvidence: z.literal(false),
        forkExecutionEvidence: z.literal(false),
        productionMetaMaskEvidence: z.literal(false),
      })
      .strict(),
    sources: z
      .object({
        reviewedSourceCommit: GitCommitSchema,
        freezeCommit: GitCommitSchema,
        executionCommit: GitCommitSchema,
        primaryRunId: z.string().min(1),
        primaryRunManifestSha256: Sha256Schema,
        primaryRawSha256: Sha256Schema,
        primarySelectedResultsSha256: Sha256Schema,
        primaryStaticIntentLockSha256: Sha256Schema,
        adaptiveSelectionConfigSha256: Sha256Schema,
      })
      .strict(),
    selection: z
      .object({
        adaptiveSelectionConfigPath: z.literal(ADAPTIVE_SELECTION_CONFIG_PATH),
        staticSelection: z.literal(
          'PRIMARY_ATTEMPT_1_INTENTLOCK_BENIGN_ORIGINAL_BY_BASE_SCENARIO_ID',
        ),
        rowCount: z.literal(40),
      })
      .strict(),
    rows: z.array(AdaptiveComparisonRowSchema).length(40),
  })
  .strict();
export type AdaptiveComparisonDocument = z.infer<typeof AdaptiveComparisonDocumentSchema>;

type FrozenEvalInput = z.input<typeof FrozenEvalConfigSchema>;
type AblationManifestInput = z.input<typeof AblationManifestSchema>;

export function validateJointAdaptiveFreeze(
  evaluationInput: FrozenEvalInput,
  ablationInput: AblationManifestInput,
): {
  evaluation: z.output<typeof ReadyFrozenEvalConfigSchema>;
  ablation: z.output<typeof ReadyAblationManifestSchema>;
} {
  const evaluation = ReadyFrozenEvalConfigSchema.parse(evaluationInput);
  const ablation = ReadyAblationManifestSchema.parse(ablationInput);
  if (
    ablation.freeze.gitCommit !== evaluation.freeze.gitCommit ||
    ablation.freeze.frozenAt !== evaluation.freeze.frozenAt ||
    ablation.freeze.humanReviewer !== evaluation.freeze.humanReviewer
  ) {
    throw new Error('evaluation and ablation manifests were not jointly frozen');
  }
  return { evaluation, ablation };
}

export function assertAdaptiveExecutionContext(options: {
  dirtyWorktree: boolean;
  freezeCommitIsAncestor: boolean;
}): void {
  if (options.dirtyWorktree) {
    throw new Error('adaptive evaluation requires a clean committed worktree');
  }
  if (!options.freezeCommitIsAncestor) {
    throw new Error(
      'the primary freeze commit is not an ancestor of the adaptive execution commit',
    );
  }
}

export interface AdaptivePrimaryBindingExpectation {
  primaryRunId: string;
  reviewedSourceCommit: string;
  freezeCommit: string;
  frozenEvaluationConfigSha256: string;
  frozenAblationConfigSha256: string;
  caseManifestSha256: string;
  freezeDigests: FreezeDigests;
  modelId: string;
  maxAttemptsPerCase: number;
  maxTotalRetryAttempts: number;
}

export function validateAdaptivePrimaryManifestBinding(
  manifestInput: unknown,
  expected: AdaptivePrimaryBindingExpectation,
): EvaluationRunManifest {
  const manifest = EvaluationRunManifestSchema.parse(manifestInput);
  const sameDigests =
    JSON.stringify(manifest.freezeDigests) === JSON.stringify(expected.freezeDigests);
  if (
    manifest.runId !== expected.primaryRunId ||
    manifest.gitCommit !== expected.reviewedSourceCommit ||
    manifest.executionCommit !== expected.freezeCommit ||
    manifest.configPath !== FROZEN_EVALUATION_CONFIG_PATH ||
    manifest.configSha256 !== expected.frozenEvaluationConfigSha256 ||
    manifest.ablationConfigSha256 !== expected.frozenAblationConfigSha256 ||
    manifest.caseManifestSha256 !== expected.caseManifestSha256 ||
    !sameDigests ||
    JSON.stringify(manifest.systems) !== JSON.stringify(PRIMARY_EVALUATION_SYSTEMS) ||
    manifest.modelId !== expected.modelId ||
    manifest.maxAttemptsPerCase !== expected.maxAttemptsPerCase ||
    manifest.maxTotalRetryAttempts !== expected.maxTotalRetryAttempts
  ) {
    throw new Error('primary run provenance does not match the jointly frozen adaptive inputs');
  }
  return manifest;
}
