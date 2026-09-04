import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { parse } from 'yaml';
import { z } from 'zod';

import { IntentLockMetaMaskAdapter } from '../src/adapters/metamask/adapter.js';
import { BenchmarkScenarioSchema, type BenchmarkScenario } from '../src/benchmark/scenario.js';
import {
  AdaptiveEpisodeResultSchema,
  AdaptiveSelectionConfigSchema,
  DeterministicFakeWalletExecutor,
  assertAdaptiveTranscriptSafe,
  createIndependentStructuralIntentOracle,
  createAdaptiveAttackSurface,
  createDeterministicAdaptiveAttacker,
  createPinnedDecoderOptions,
  runAdaptiveEpisode,
  type AdaptiveAction,
  type AdaptiveEpisodeResult,
  type AdaptiveSelectionConfig,
} from '../src/experiments/adaptive.js';
import {
  ADAPTIVE_COMPARISON_DESIGN,
  ADAPTIVE_FIXTURE_PATH,
  ADAPTIVE_SELECTION_CONFIG_PATH,
  AdaptiveComparisonDocumentSchema,
  AdaptiveRunManifestSchema,
  assertAdaptiveExecutionContext,
  validateAdaptivePrimaryManifestBinding,
  validateJointAdaptiveFreeze,
} from '../src/experiments/adaptive-provenance.js';
import {
  AblationManifestSchema,
  ReadyAblationManifestSchema,
} from '../src/experiments/ablations.js';
import { verifyCaseManifest } from '../src/experiments/case-manifest.js';
import { createEvaluationCaseMatrix } from '../src/experiments/case-matrix.js';
import {
  computeFreezeDigests,
  differingFreezeDigests,
  freezeDigestsFromConfig,
} from '../src/experiments/freeze-digests.js';
import {
  FROZEN_ABLATION_CONFIG_PATH,
  FROZEN_EVALUATION_CONFIG_PATH,
  resolveRepoRelativeJson,
  sha256Source,
  validateFreezeTransition,
  validateM2ReadyForFreeze,
} from '../src/experiments/freeze-gates.js';
import {
  FrozenEvalConfigSchema,
  ReadyFrozenEvalConfigSchema,
} from '../src/experiments/protocol.js';
import {
  EvaluationAttemptSchema,
  assertPrimaryArtifactsTrackedAtHead,
  assertPrimaryEvaluationMatrixBinding,
  selectEvaluationAttempts,
  type EvaluationAttempt,
} from '../src/experiments/run-artifacts.js';
import { validateFreezeReviewEvidenceFromRepository } from './freeze-review-evidence.js';

const CONFIG_PATH = ADAPTIVE_SELECTION_CONFIG_PATH;
const RESULTS_ROOT = 'experiments/results';

function argument(name: string): string | undefined {
  return process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
}

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function gitPathTrackedAtHead(path: string): boolean {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', path], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function gitCommitParents(commit: string): string[] {
  const revision = git('rev-list', '--parents', '-n', '1', commit).split(/\s+/);
  const [listedCommit, ...parents] = revision;
  if (listedCommit !== commit) throw new Error(`could not resolve commit ${commit}`);
  return parents;
}

function gitCommitChangedPaths(commit: string): string[] {
  return git('diff-tree', '--no-commit-id', '--name-only', '--no-renames', '-r', commit)
    .split(/\r?\n/)
    .filter(Boolean);
}

function gitIsAncestor(ancestor: string, descendant: string): boolean {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function parseAttempts(source: string): EvaluationAttempt[] {
  if (!source.trim()) return [];
  return source
    .trim()
    .split(/\r?\n/)
    .map((line) => EvaluationAttemptSchema.parse(JSON.parse(line)));
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function defaultRunId(): string {
  return `adaptive-${new Date()
    .toISOString()
    .replaceAll(/[-:.TZ]/g, '')
    .slice(0, 14)}`;
}

interface LoadedScenario {
  scenario: BenchmarkScenario;
  path: string;
  source: string;
}

async function loadBaseScenarios(): Promise<Map<string, LoadedScenario>> {
  const root = 'benchmark/scenarios/base';
  const result = new Map<string, LoadedScenario>();
  for (const directory of (await readdir(root)).sort()) {
    const directoryPath = `${root}/${directory}`;
    if (!(await stat(directoryPath)).isDirectory()) continue;
    for (const filename of (await readdir(directoryPath))
      .filter((name) => name.endsWith('.json'))
      .sort()) {
      const path = `${directoryPath}/${filename}`;
      const source = await readFile(path, 'utf8');
      const scenario = BenchmarkScenarioSchema.parse(JSON.parse(source));
      if (result.has(scenario.id)) throw new Error(`duplicate base scenario ${scenario.id}`);
      result.set(scenario.id, { scenario, path, source });
    }
  }
  if (result.size !== 80)
    throw new Error(`expected 80 base scenarios, found ${String(result.size)}`);
  return result;
}

function validateSelection(
  config: AdaptiveSelectionConfig,
  scenarios: ReadonlyMap<string, LoadedScenario>,
): void {
  for (const family of config.families) {
    for (const entry of family.episodes) {
      const selected = scenarios.get(entry.baseScenarioId);
      if (!selected) throw new Error(`selected base scenario ${entry.baseScenarioId} is missing`);
      if (!family.workflows.includes(selected.scenario.workflow)) {
        throw new Error(`${entry.baseScenarioId} is outside declared family ${family.family}`);
      }
    }
  }

  const lending = config.families.find((family) => family.family === 'LENDING');
  if (!lending) throw new Error('LENDING selection family is missing');
  const lendingPrimaryChains = lending.episodes.map((entry) => {
    const action = scenarios.get(entry.baseScenarioId)?.scenario.trace.actions[0];
    if (!action) throw new Error(`${entry.baseScenarioId} has no action`);
    return action.chainId;
  });
  if (
    lendingPrimaryChains.filter((chainId) => chainId === 1).length !== 4 ||
    lendingPrimaryChains.filter((chainId) => chainId === 8453).length !== 4
  ) {
    throw new Error('LENDING must select four Ethereum and four Base episodes');
  }

  const crossChain = config.families.find((family) => family.family === 'CROSS_CHAIN');
  if (!crossChain) throw new Error('CROSS_CHAIN selection family is missing');
  for (const entry of crossChain.episodes) {
    const chainIds = new Set(
      scenarios.get(entry.baseScenarioId)?.scenario.trace.actions.map((action) => action.chainId),
    );
    if (!chainIds.has(1) || !chainIds.has(8453)) {
      throw new Error(`${entry.baseScenarioId} does not cover both frozen chains`);
    }
  }
}

const PendingHumanReviewSchema = z
  .object({
    reviewId: z.string().min(1),
    episodeId: z.string().min(1),
    family: z.string().min(1),
    baseScenarioId: z.string().min(1),
    attackType: z.string().min(1),
    seed: z.number().int().nonnegative(),
    committedInputPath: z.string().min(1),
    selectionConfigPath: z.literal(CONFIG_PATH),
    transcriptArtifact: z.literal('episodes.jsonl'),
    observedOutcome: z.enum(['ATTACK_SUCCESS', 'SAFE_BLOCK', 'NORMAL_FAILURE', 'INCONCLUSIVE']),
    status: z.literal('PENDING'),
    reviewer: z.null(),
    reviewedAt: z.null(),
    verdict: z.null(),
    notes: z.null(),
  })
  .strict();

const PendingHumanReviewPacketSchema = z
  .object({
    schemaVersion: z.literal('0.1'),
    status: z.literal('PENDING_HUMAN_REVIEW'),
    completedReviews: z.literal(0),
    requiredReviews: z.literal(10),
    instructions: z.string().min(1),
    entries: z.array(PendingHumanReviewSchema).length(10),
  })
  .strict();

const configSource = await readFile(resolve(CONFIG_PATH), 'utf8');
const config = AdaptiveSelectionConfigSchema.parse(JSON.parse(configSource));
const scenarios = await loadBaseScenarios();
validateSelection(config, scenarios);
const fixtureSource = await readFile(ADAPTIVE_FIXTURE_PATH, 'utf8');
const fixtureManifest: unknown = JSON.parse(fixtureSource);
const selectedInputs = config.families.flatMap((family) =>
  family.episodes.map((entry) => {
    const selected = scenarios.get(entry.baseScenarioId);
    if (!selected) throw new Error(`missing selected scenario ${entry.baseScenarioId}`);
    return `${selected.path}\0${sha256(selected.source)}`;
  }),
);
const repositoryRoot = resolve('.');
const frozenEvaluationSource = await readFile(resolve(FROZEN_EVALUATION_CONFIG_PATH), 'utf8');
const frozenAblationSource = await readFile(resolve(FROZEN_ABLATION_CONFIG_PATH), 'utf8');
const candidateEvaluation = FrozenEvalConfigSchema.parse(parse(frozenEvaluationSource));
const candidateAblation = AblationManifestSchema.parse(JSON.parse(frozenAblationSource));
const matrix = createEvaluationCaseMatrix([...scenarios.values()].map((entry) => entry.scenario));
const caseManifestSource = await readFile(
  resolve(candidateEvaluation.dataset.caseManifest),
  'utf8',
);
verifyCaseManifest(JSON.parse(caseManifestSource), matrix);

const readyEvaluation = ReadyFrozenEvalConfigSchema.safeParse(candidateEvaluation);
const readyAblation = ReadyAblationManifestSchema.safeParse(candidateAblation);
const jointlyFrozen =
  readyEvaluation.success &&
  readyAblation.success &&
  readyEvaluation.data.freeze.gitCommit === readyAblation.data.freeze.gitCommit &&
  readyEvaluation.data.freeze.frozenAt === readyAblation.data.freeze.frozenAt &&
  readyEvaluation.data.freeze.humanReviewer === readyAblation.data.freeze.humanReviewer;
const primaryRunId = argument('--primary-run-id');

if (process.argv.includes('--validate-inputs') && (!jointlyFrozen || !primaryRunId)) {
  const blockingReasons = [
    ...(candidateEvaluation.status !== 'FROZEN'
      ? [`evaluation config is ${candidateEvaluation.status}`]
      : []),
    ...(candidateAblation.status !== 'FROZEN'
      ? [`ablation config is ${candidateAblation.status}`]
      : []),
    ...(candidateEvaluation.status === 'FROZEN' &&
    candidateAblation.status === 'FROZEN' &&
    !jointlyFrozen
      ? ['evaluation and ablation freeze envelopes do not match']
      : []),
    ...(!primaryRunId ? ['--primary-run-id is required for execution'] : []),
  ];
  console.log(
    JSON.stringify({
      status: 'INPUTS_VALID_NOT_RUNNABLE',
      frozenEvaluationStatus: candidateEvaluation.status,
      frozenAblationStatus: candidateAblation.status,
      jointlyFrozen,
      runnableAdaptive: false,
      blockingReasons,
      baseScenarios: scenarios.size,
      primaryCases: matrix.caseCount,
      adaptiveEpisodes: selectedInputs.length,
      families: config.families.length,
      humanReviewPackets: config.families
        .flatMap((family) => family.episodes)
        .filter((entry) => entry.humanReview).length,
      networkRequests: false,
      mainnetTransactions: false,
      forkExecution: false,
      modelAdaptiveEvidence: false,
      claimScope: config.claimScope,
      attackerMode: config.attackerMode,
      postStateObservation: config.postStateObservation,
    }),
  );
  process.exit(0);
}

if (!primaryRunId || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,79}$/.test(primaryRunId)) {
  throw new Error('--primary-run-id is required');
}
const { evaluation: frozenEvaluation } = validateJointAdaptiveFreeze(
  candidateEvaluation,
  candidateAblation,
);
const executionCommit = git('rev-parse', 'HEAD');
const primaryRoot = resolve(RESULTS_ROOT, primaryRunId);
assertPrimaryArtifactsTrackedAtHead(primaryRunId, gitPathTrackedAtHead);
const primaryManifestSource = await readFile(resolve(primaryRoot, 'manifest.json'), 'utf8');
const preliminaryPrimaryManifest: unknown = JSON.parse(primaryManifestSource);
const primaryRawSource = await readFile(resolve(primaryRoot, 'raw.jsonl'), 'utf8');
const expectedFreezeDigests = freezeDigestsFromConfig(frozenEvaluation);
if (!expectedFreezeDigests) throw new Error('frozen digest envelope is incomplete');
const actualFreezeDigests = await computeFreezeDigests(frozenEvaluation);
const changedFreezeDigests = differingFreezeDigests(expectedFreezeDigests, actualFreezeDigests);
if (changedFreezeDigests.length > 0) {
  throw new Error(`frozen inputs changed: ${changedFreezeDigests.join(', ')}`);
}
const preliminaryExecutionCommit = z
  .object({ executionCommit: z.string().regex(/^[a-f0-9]{40}$/) })
  .loose()
  .parse(preliminaryPrimaryManifest).executionCommit;
const humanReviewLocation = resolveRepoRelativeJson(
  repositoryRoot,
  frozenEvaluation.freeze.humanReviewPath,
);
const humanReviewSource = await readFile(humanReviewLocation.absolutePath, 'utf8');
if (sha256Source(humanReviewSource) !== frozenEvaluation.freeze.humanReviewDigestSha256) {
  throw new Error('frozen human review digest changed');
}
const { review } = await validateFreezeReviewEvidenceFromRepository({
  repositoryRoot,
  reviewInput: JSON.parse(humanReviewSource),
  reviewedCommit: frozenEvaluation.freeze.gitCommit,
  requireTrackedArtifacts: true,
});
validateFreezeTransition({
  reviewedCommit: frozenEvaluation.freeze.gitCommit,
  executionCommit: preliminaryExecutionCommit,
  parentCommits: gitCommitParents(preliminaryExecutionCommit),
  changedPaths: gitCommitChangedPaths(preliminaryExecutionCommit),
  humanReviewPath: frozenEvaluation.freeze.humanReviewPath,
  dryRunEvidenceDirectory: review.dryRunEvidence.outputDirectory,
});
assertAdaptiveExecutionContext({
  dirtyWorktree: Boolean(git('status', '--porcelain')),
  freezeCommitIsAncestor: gitIsAncestor(preliminaryExecutionCommit, executionCommit),
});

const m2ValidationLocation = resolveRepoRelativeJson(
  repositoryRoot,
  frozenEvaluation.dataset.m2Validation,
);
const m2ValidationSource = await readFile(m2ValidationLocation.absolutePath, 'utf8');
validateM2ReadyForFreeze(JSON.parse(m2ValidationSource));

const primaryManifest = validateAdaptivePrimaryManifestBinding(preliminaryPrimaryManifest, {
  primaryRunId,
  reviewedSourceCommit: frozenEvaluation.freeze.gitCommit,
  freezeCommit: preliminaryExecutionCommit,
  frozenEvaluationConfigSha256: sha256(frozenEvaluationSource),
  frozenAblationConfigSha256: sha256(frozenAblationSource),
  caseManifestSha256: sha256(caseManifestSource),
  freezeDigests: expectedFreezeDigests,
  modelId: frozenEvaluation.models.primary.id,
  maxAttemptsPerCase: frozenEvaluation.failurePolicy.maxAttemptsPerCase,
  maxTotalRetryAttempts: frozenEvaluation.failurePolicy.maxTotalRetryAttempts,
});
const selectedPrimary = selectEvaluationAttempts(parseAttempts(primaryRawSource), {
  maxAttemptsPerCase: primaryManifest.maxAttemptsPerCase,
  maxTotalRetryAttempts: primaryManifest.maxTotalRetryAttempts,
});
if (selectedPrimary.length !== 2_000) {
  throw new Error('primary run does not contain exactly 2,000 selected intention-to-treat rows');
}
assertPrimaryEvaluationMatrixBinding({
  attempts: selectedPrimary,
  primaryRunId,
  entries: matrix.entries,
  scenarios: matrix.scenarios,
});

const selectedResultSource = selectedPrimary
  .map((attempt) => JSON.stringify(attempt.result))
  .join('\n');
const staticIntentLockByBaseId = new Map(
  selectedPrimary
    .filter(
      (attempt) =>
        attempt.result.record.system === 'INTENTLOCK' &&
        attempt.result.variant === 'BENIGN_ORIGINAL',
    )
    .map((attempt) => [attempt.result.record.baseScenarioId, attempt]),
);
const adaptiveBaseIds = config.families.flatMap((family) =>
  family.episodes.map((selection) => selection.baseScenarioId),
);
const selectedStaticIntentLock = adaptiveBaseIds.map((baseScenarioId) => {
  const attempt = staticIntentLockByBaseId.get(baseScenarioId);
  if (!attempt) throw new Error(`missing static IntentLock row for ${baseScenarioId}`);
  return attempt;
});
if (new Set(selectedStaticIntentLock.map((attempt) => attempt.result.record.caseId)).size !== 40) {
  throw new Error('adaptive comparison static IntentLock selection is not forty unique rows');
}
const selectedStaticIntentLockSource = selectedStaticIntentLock
  .map((attempt) => JSON.stringify(attempt.result))
  .join('\n');

if (process.argv.includes('--validate-inputs')) {
  console.log(
    JSON.stringify({
      status: 'INPUTS_VALID_RUNNABLE',
      frozenEvaluationStatus: candidateEvaluation.status,
      frozenAblationStatus: candidateAblation.status,
      jointlyFrozen: true,
      runnableAdaptive: true,
      primaryRunId,
      primarySelectedRecords: selectedPrimary.length,
      staticComparisonRows: selectedStaticIntentLock.length,
      adaptiveEpisodes: selectedInputs.length,
      claimScope: config.claimScope,
      comparisonDesign: ADAPTIVE_COMPARISON_DESIGN,
    }),
  );
  process.exit(0);
}

const runId = argument('--run-id') ?? defaultRunId();
if (!/^adaptive-[a-zA-Z0-9._-]{3,70}$/.test(runId)) {
  throw new Error('--run-id must start with adaptive- and contain only safe path characters');
}
const runRoot = resolve(RESULTS_ROOT, runId);
// A repeated run ID is rejected. Partial runs remain immutable evidence and must not be resumed.
await mkdir(runRoot, { recursive: false });
const manifest = AdaptiveRunManifestSchema.parse({
  schemaVersion: '0.2',
  runId,
  protocolVersion: config.protocolVersion,
  datasetVersion: config.datasetVersion,
  createdAt: new Date().toISOString(),
  evaluatedAt: config.evaluatedAt,
  reviewedSourceCommit: frozenEvaluation.freeze.gitCommit,
  freezeCommit: preliminaryExecutionCommit,
  executionCommit,
  freezeCommitIsAncestor: true,
  frozenEvaluationConfigPath: FROZEN_EVALUATION_CONFIG_PATH,
  frozenEvaluationConfigSha256: sha256(frozenEvaluationSource),
  frozenAblationConfigPath: FROZEN_ABLATION_CONFIG_PATH,
  frozenAblationConfigSha256: sha256(frozenAblationSource),
  primaryRunId,
  primaryRunManifestSha256: sha256(primaryManifestSource),
  primaryRawSha256: sha256(primaryRawSource),
  primarySelectedResultsSha256: sha256(selectedResultSource),
  primaryStaticIntentLockSha256: sha256(selectedStaticIntentLockSource),
  caseManifestPath: frozenEvaluation.dataset.caseManifest,
  caseManifestSha256: sha256(caseManifestSource),
  selectionConfigPath: CONFIG_PATH,
  selectionConfigSha256: sha256(configSource),
  fixturePath: ADAPTIVE_FIXTURE_PATH,
  fixtureSha256: sha256(fixtureSource),
  selectedInputSha256: sha256(selectedInputs.join('\n')),
  freezeDigests: expectedFreezeDigests,
  humanReviewPath: humanReviewLocation.path,
  humanReviewDigestSha256: sha256(humanReviewSource),
  m2ValidationPath: m2ValidationLocation.path,
  m2ValidationDigestSha256: sha256(m2ValidationSource),
  rootSeed: config.rootSeed,
  episodeCount: 40,
  maxReplans: config.maxReplans,
  executionEnvironment: config.executionEnvironment,
  networkRequests: false,
  mainnetTransactions: false,
  forkExecution: false,
  modelAdaptiveEvidence: false,
  simulationMode: 'DECODED_EFFECT_RECEIPT_OFFLINE',
  postStateMode: 'NOT_OBSERVED',
  claimScope: config.claimScope,
  attackerMode: config.attackerMode,
  comparisonArtifact: 'comparison.json',
  comparisonDesign: ADAPTIVE_COMPARISON_DESIGN,
  overwrite: false,
});
await writeFile(resolve(runRoot, 'manifest.json'), json(manifest), { flag: 'wx' });

const episodeResults: AdaptiveEpisodeResult[] = [];
const reviewSelections: Array<{
  result: AdaptiveEpisodeResult;
  inputPath: string;
}> = [];
let episodeIndex = 0;
for (const family of config.families) {
  for (const selection of family.episodes) {
    const loaded = scenarios.get(selection.baseScenarioId);
    if (!loaded) throw new Error(`missing selected scenario ${selection.baseScenarioId}`);
    const scenario = loaded.scenario;
    const surface = createAdaptiveAttackSurface(scenario);
    const decoderFor = (action: AdaptiveAction) =>
      createPinnedDecoderOptions(scenario, fixtureManifest, action);
    const wallet = new DeterministicFakeWalletExecutor(
      scenario.intent.account as `0x${string}`,
      decoderFor,
    );
    const adapter = new IntentLockMetaMaskAdapter(wallet);
    const result = await runAdaptiveEpisode({
      episodeId: `ADAPT-${String(episodeIndex + 1).padStart(2, '0')}-${scenario.id}`,
      baseScenarioId: scenario.id,
      family: family.family,
      attackType: selection.attackType,
      seed: selection.seed,
      maxReplans: config.maxReplans,
      attacker: createDeterministicAdaptiveAttacker(surface),
      assessAuthorizedEffects: createIndependentStructuralIntentOracle({
        intent: scenario.intent,
        decoderFor,
      }),
      guard: {
        execute(action) {
          return adapter.execute({
            contract: scenario.intent,
            action: {
              chainId: action.chainId,
              target: action.target as `0x${string}`,
              data: action.data as `0x${string}`,
              valueWei: action.valueWei,
            },
            decoder: decoderFor(action),
            evaluatedAt: config.evaluatedAt,
            simulationStatus: 'SUCCESS',
          });
        },
      },
    });
    AdaptiveEpisodeResultSchema.parse(result);
    assertAdaptiveTranscriptSafe(result.transcript);
    episodeResults.push(result);
    await appendFile(resolve(runRoot, 'episodes.jsonl'), `${JSON.stringify(result)}\n`, 'utf8');
    if (selection.humanReview) reviewSelections.push({ result, inputPath: loaded.path });
    episodeIndex += 1;
  }
}

const comparisonRows = episodeResults.map((result, index) => {
  const primaryAttempt = selectedStaticIntentLock[index];
  if (!primaryAttempt || primaryAttempt.result.record.baseScenarioId !== result.baseScenarioId) {
    throw new Error(`static/adaptive selection order differs at episode ${String(index + 1)}`);
  }
  return {
    relationship: ADAPTIVE_COMPARISON_DESIGN,
    equivalentCaseClaim: false,
    sameAuthoredBaseScenarioIdOnly: true,
    baseScenarioId: result.baseScenarioId,
    family: result.family,
    attackType: result.attackType,
    seed: result.seed,
    frozenStaticIntentLock: {
      caseId: primaryAttempt.result.record.caseId,
      variant: 'BENIGN_ORIGINAL' as const,
      primaryResultSha256: sha256(JSON.stringify(primaryAttempt.result)),
      record: primaryAttempt.result.record,
    },
    adaptiveSignerBoundary: {
      episodeId: result.episodeId,
      outcome: result.outcome,
      attemptedPlans: result.attemptedPlans,
      signerInvocations: result.signerInvocations,
      claimScope: result.claimScope,
      attackerMode: result.attackerMode,
      postStateObservation: result.postStateObservation,
      structuralVerdict: result.classification?.verdict ?? null,
    },
  };
});
const comparison = AdaptiveComparisonDocumentSchema.parse({
  schemaVersion: '0.1',
  runId,
  createdAt: new Date().toISOString(),
  design: ADAPTIVE_COMPARISON_DESIGN,
  interpretation:
    'Descriptive contrast only. Rows share an authored base-scenario ID but are not paired or equivalent experimental cases, so no causal effect is estimated.',
  evidenceLimits: {
    equivalentCases: false,
    causalComparison: false,
    modelAdaptiveEvidence: false,
    forkExecutionEvidence: false,
    productionMetaMaskEvidence: false,
  },
  sources: {
    reviewedSourceCommit: manifest.reviewedSourceCommit,
    freezeCommit: manifest.freezeCommit,
    executionCommit: manifest.executionCommit,
    primaryRunId: manifest.primaryRunId,
    primaryRunManifestSha256: manifest.primaryRunManifestSha256,
    primaryRawSha256: manifest.primaryRawSha256,
    primarySelectedResultsSha256: manifest.primarySelectedResultsSha256,
    primaryStaticIntentLockSha256: manifest.primaryStaticIntentLockSha256,
    adaptiveSelectionConfigSha256: manifest.selectionConfigSha256,
  },
  selection: {
    adaptiveSelectionConfigPath: CONFIG_PATH,
    staticSelection: 'PRIMARY_ATTEMPT_1_INTENTLOCK_BENIGN_ORIGINAL_BY_BASE_SCENARIO_ID',
    rowCount: 40,
  },
  rows: comparisonRows,
});
await writeFile(resolve(runRoot, 'comparison.json'), json(comparison), { flag: 'wx' });

const outcomeCounts = Object.fromEntries(
  ['ATTACK_SUCCESS', 'SAFE_BLOCK', 'NORMAL_FAILURE', 'INCONCLUSIVE'].map((outcome) => [
    outcome,
    episodeResults.filter((result) => result.outcome === outcome).length,
  ]),
);
const summary = {
  schemaVersion: '0.1',
  runId,
  claimScope: config.claimScope,
  attackerMode: config.attackerMode,
  postStateObservation: config.postStateObservation,
  episodeCount: episodeResults.length,
  attemptedPlans: episodeResults.reduce((sum, result) => sum + result.attemptedPlans, 0),
  signerInvocations: episodeResults.reduce((sum, result) => sum + result.signerInvocations, 0),
  outcomes: outcomeCounts,
  comparison: {
    design: ADAPTIVE_COMPARISON_DESIGN,
    rows: comparison.rows.length,
    equivalentCaseClaim: false,
    causalComparison: false,
    modelAdaptiveEvidence: false,
    forkExecutionEvidence: false,
  },
};
await writeFile(resolve(runRoot, 'summary.json'), json(summary), { flag: 'wx' });

const reviewPacket = PendingHumanReviewPacketSchema.parse({
  schemaVersion: '0.1',
  status: 'PENDING_HUMAN_REVIEW',
  completedReviews: 0,
  requiredReviews: 10,
  instructions:
    'Reproduce each committed input with its recorded seed and review only the offline scripted signer-boundary claim. Compare the public transcript, signer invocation, and independent structural original-intent classification; do not infer model-adaptive, fork-execution, or post-state evidence. Fill reviewer fields in a separate submission. This packet contains no completed or inferred human review.',
  entries: reviewSelections.map(({ result, inputPath }, index) => ({
    reviewId: `ADAPT-REVIEW-${String(index + 1).padStart(2, '0')}`,
    episodeId: result.episodeId,
    family: result.family,
    baseScenarioId: result.baseScenarioId,
    attackType: result.attackType,
    seed: result.seed,
    committedInputPath: inputPath,
    selectionConfigPath: CONFIG_PATH,
    transcriptArtifact: 'episodes.jsonl',
    observedOutcome: result.outcome,
    status: 'PENDING',
    reviewer: null,
    reviewedAt: null,
    verdict: null,
    notes: null,
  })),
});
await writeFile(resolve(runRoot, 'human-review-10.packet.json'), json(reviewPacket), {
  flag: 'wx',
});
console.log(JSON.stringify(summary));
