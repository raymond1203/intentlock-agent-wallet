import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { format } from 'prettier';
import { parse } from 'yaml';

import { BenchmarkScenarioSchema, type BenchmarkScenario } from '../src/benchmark/scenario.js';
import { analyzeEvaluationResults } from '../src/experiments/analysis.js';
import {
  AblationManifestSchema,
  AblationRunManifestSchema,
  ReadyAblationManifestSchema,
} from '../src/experiments/ablations.js';
import { AdaptiveSelectionConfigSchema } from '../src/experiments/adaptive.js';
import { EvaluationCaseManifestSchema } from '../src/experiments/case-manifest.js';
import {
  ADAPTIVE_COMPARISON_DESIGN,
  ADAPTIVE_FIXTURE_PATH,
  ADAPTIVE_SELECTION_CONFIG_PATH,
  AdaptiveComparisonDocumentSchema,
  AdaptiveRunManifestSchema,
} from '../src/experiments/adaptive-provenance.js';
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
  architectureSvg,
  errorTaxonomySvg,
  latencySvg,
  securityUtilitySvg,
} from '../src/experiments/figures.js';
import { aggregateEvaluationRecords, evaluationRecordsCsv } from '../src/experiments/metrics.js';
import {
  FrozenEvalConfigSchema,
  getFreezeReviewBinding,
  ReadyFrozenEvalConfigSchema,
  sha256Text,
} from '../src/experiments/protocol.js';
import {
  EvaluationAttemptSchema,
  EvaluationRunManifestSchema,
  PRIMARY_EVALUATION_SYSTEMS,
  selectEvaluationAttempts,
  summarizeEvaluationAttempts,
  type EvaluationAttempt,
} from '../src/experiments/run-artifacts.js';
import {
  analyzeAblationResults,
  analyzeAdaptiveResults,
  assertAblationSummaryMatchesRaw,
  assertAblationReferenceMatchesPrimary,
  assertAdaptiveSummaryMatchesRaw,
  parseAblationRawResults,
  parseAdaptiveEpisodes,
} from '../src/experiments/secondary-analysis.js';
import { validateFreezeReviewEvidenceFromRepository } from './freeze-review-evidence.js';

function argument(name: string): string | undefined {
  return process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
}

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
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

function commitParents(commit: string): string[] {
  const [resolved, ...parents] = git('rev-list', '--parents', '-n', '1', commit).split(/\s+/u);
  if (resolved !== commit) throw new Error(`cannot resolve execution commit ${commit}`);
  return parents;
}

function commitChangedPaths(commit: string): string[] {
  const output = git('diff-tree', '--no-commit-id', '--name-only', '--no-renames', '-r', commit);
  return output ? output.split(/\r?\n/u) : [];
}

function assertTrackedArtifacts(paths: readonly string[]): void {
  for (const path of paths) {
    const normalized = path.replaceAll('\\', '/');
    try {
      execFileSync('git', ['ls-files', '--error-unmatch', '--', normalized], {
        stdio: 'ignore',
      });
      execFileSync('git', ['cat-file', '-e', `HEAD:${normalized}`], { stdio: 'ignore' });
    } catch {
      throw new Error(
        `analysis input must be tracked in the clean analysis source commit: ${normalized}`,
      );
    }
  }
}

function percentage(value: number | null): string {
  return value === null ? 'n/a' : `${(value * 100).toFixed(2)}%`;
}

function signedPercentage(value: number | null): string {
  if (value === null) return 'not estimated';
  const percentageValue = value * 100;
  return `${percentageValue >= 0 ? '+' : ''}${percentageValue.toFixed(2)} pp`;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function parseAttempts(source: string): EvaluationAttempt[] {
  if (!source.trim()) return [];
  return source
    .trim()
    .split(/\r?\n/u)
    .map((line) => EvaluationAttemptSchema.parse(JSON.parse(line)));
}

function safeRunId(value: string | undefined, name: string): string {
  if (!value || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,79}$/.test(value)) {
    throw new Error(`${name} is required and must contain only safe run ID characters`);
  }
  return value;
}

async function baseScenarios(): Promise<
  Map<string, { scenario: BenchmarkScenario; path: string; source: string }>
> {
  const root = 'benchmark/scenarios/base';
  const scenarios = new Map<
    string,
    { scenario: BenchmarkScenario; path: string; source: string }
  >();
  for (const directory of (await readdir(root)).sort()) {
    const directoryPath = `${root}/${directory}`;
    if (!(await stat(directoryPath)).isDirectory()) continue;
    for (const file of (await readdir(directoryPath))
      .filter((name) => name.endsWith('.json'))
      .sort()) {
      const path = `${directoryPath}/${file}`;
      const source = await readFile(path, 'utf8');
      const scenario = BenchmarkScenarioSchema.parse(JSON.parse(source));
      if (scenarios.has(scenario.id)) throw new Error(`duplicate base scenario ${scenario.id}`);
      scenarios.set(scenario.id, { scenario, path, source });
    }
  }
  if (scenarios.size !== 80) {
    throw new Error(`expected 80 base scenarios, found ${String(scenarios.size)}`);
  }
  return scenarios;
}

const validateOnly = process.argv.includes('--validate-inputs');
const primaryRunArgument = argument('--run-id');
const ablationRunArgument = argument('--ablation-run-id');
const adaptiveRunArgument = argument('--adaptive-run-id');
const repositoryRoot = resolve('.');
const frozenEvaluationSource = await readFile(resolve(FROZEN_EVALUATION_CONFIG_PATH), 'utf8');
const frozenAblationSource = await readFile(resolve(FROZEN_ABLATION_CONFIG_PATH), 'utf8');
const candidateEvaluation = FrozenEvalConfigSchema.parse(parse(frozenEvaluationSource));
const candidateAblation = AblationManifestSchema.parse(JSON.parse(frozenAblationSource));
const readyEvaluation = ReadyFrozenEvalConfigSchema.safeParse(candidateEvaluation);
const readyAblation = ReadyAblationManifestSchema.safeParse(candidateAblation);
const jointlyFrozen =
  readyEvaluation.success &&
  readyAblation.success &&
  readyEvaluation.data.freeze.gitCommit === readyAblation.data.freeze.gitCommit &&
  readyEvaluation.data.freeze.frozenAt === readyAblation.data.freeze.frozenAt &&
  readyEvaluation.data.freeze.humanReviewer === readyAblation.data.freeze.humanReviewer &&
  (readyEvaluation.data.freeze.aiReview?.reviewerPseudonym ?? null) ===
    (readyAblation.data.freeze.aiReviewer ?? null) &&
  readyEvaluation.data.reviewProtocol?.mode === readyAblation.data.reviewProtocol?.mode;
const missingRunArguments = [
  ...(primaryRunArgument ? [] : ['--run-id']),
  ...(ablationRunArgument ? [] : ['--ablation-run-id']),
  ...(adaptiveRunArgument ? [] : ['--adaptive-run-id']),
];

if (!jointlyFrozen || missingRunArguments.length > 0) {
  const blockingReasons = [
    ...(candidateEvaluation.status === 'FROZEN'
      ? []
      : [`evaluation config is ${candidateEvaluation.status}`]),
    ...(candidateAblation.status === 'FROZEN'
      ? []
      : [`ablation config is ${candidateAblation.status}`]),
    ...(candidateEvaluation.status === 'FROZEN' &&
    candidateAblation.status === 'FROZEN' &&
    !jointlyFrozen
      ? ['evaluation and ablation freeze envelopes do not match']
      : []),
    ...missingRunArguments.map(
      (name) => `${name} is required for complete primary+secondary analysis`,
    ),
  ];
  if (validateOnly) {
    console.log(
      JSON.stringify({
        status: 'INPUTS_VALID_NOT_RUNNABLE',
        runnableAnalysis: false,
        frozenEvaluationStatus: candidateEvaluation.status,
        frozenAblationStatus: candidateAblation.status,
        jointlyFrozen,
        requiredArtifacts: ['PRIMARY_2000', 'ABLATION_3200', 'ADAPTIVE_40'],
        blockingReasons,
      }),
    );
    process.exit(0);
  }
  throw new Error(`analysis is not runnable: ${blockingReasons.join('; ')}`);
}

const config = readyEvaluation.data;
const ablationConfig = readyAblation.data;
const primaryRunId = safeRunId(primaryRunArgument, '--run-id');
const ablationRunId = safeRunId(ablationRunArgument, '--ablation-run-id');
const adaptiveRunId = safeRunId(adaptiveRunArgument, '--adaptive-run-id');
if (git('status', '--porcelain')) throw new Error('analysis requires a clean committed worktree');
const analysisCommit = git('rev-parse', 'HEAD');

const primaryArtifactPaths = {
  manifest: `experiments/results/${primaryRunId}/manifest.json`,
  raw: `experiments/results/${primaryRunId}/raw.jsonl`,
  summary: `experiments/results/${primaryRunId}/summary.json`,
  summaryCsv: `experiments/results/${primaryRunId}/summary.csv`,
} as const;
const ablationArtifactPaths = {
  manifest: `experiments/results/${ablationRunId}/manifest.json`,
  raw: `experiments/results/${ablationRunId}/ablation-results.jsonl`,
  summary: `experiments/results/${ablationRunId}/summary.json`,
} as const;
const adaptiveArtifactPaths = {
  manifest: `experiments/results/${adaptiveRunId}/manifest.json`,
  episodes: `experiments/results/${adaptiveRunId}/episodes.jsonl`,
  comparison: `experiments/results/${adaptiveRunId}/comparison.json`,
  summary: `experiments/results/${adaptiveRunId}/summary.json`,
  reviewPacket: `experiments/results/${adaptiveRunId}/human-review-10.packet.json`,
} as const;

if (
  ablationConfig.freeze.gitCommit !== config.freeze.gitCommit ||
  ablationConfig.freeze.frozenAt !== config.freeze.frozenAt ||
  ablationConfig.freeze.humanReviewer !== config.freeze.humanReviewer ||
  (ablationConfig.freeze.aiReviewer ?? null) !==
    (config.freeze.aiReview?.reviewerPseudonym ?? null) ||
  ablationConfig.reviewProtocol?.mode !== config.reviewProtocol?.mode
) {
  throw new Error('analysis manifests do not share the same freeze envelope');
}
const expectedDigests = freezeDigestsFromConfig(config);
if (!expectedDigests) throw new Error('analysis config has an incomplete frozen digest envelope');
const changedDigests = differingFreezeDigests(expectedDigests, await computeFreezeDigests(config));
if (changedDigests.length > 0) {
  throw new Error(
    `analysis implementation/config changed after freeze: ${changedDigests.join(', ')}`,
  );
}
const caseManifestSource = await readFile(resolve(config.dataset.caseManifest), 'utf8');
const caseManifestSha256 = sha256Source(caseManifestSource);
const reviewBinding = getFreezeReviewBinding(config);
const reviewLocation = resolveRepoRelativeJson(repositoryRoot, reviewBinding.reviewPath);
const m2Location = resolveRepoRelativeJson(repositoryRoot, config.dataset.m2Validation);
assertTrackedArtifacts([
  FROZEN_EVALUATION_CONFIG_PATH,
  FROZEN_ABLATION_CONFIG_PATH,
  config.dataset.caseManifest,
  reviewLocation.path,
  m2Location.path,
  ADAPTIVE_SELECTION_CONFIG_PATH,
  ADAPTIVE_FIXTURE_PATH,
  ...Object.values(primaryArtifactPaths),
  ...Object.values(ablationArtifactPaths),
  ...Object.values(adaptiveArtifactPaths),
]);
const reviewSource = await readFile(reviewLocation.absolutePath, 'utf8');
if (sha256Source(reviewSource) !== reviewBinding.reviewDigestSha256) {
  throw new Error('analysis review differs from the frozen digest');
}
const { review } = await validateFreezeReviewEvidenceFromRepository({
  repositoryRoot,
  reviewInput: JSON.parse(reviewSource),
  reviewedCommit: config.freeze.gitCommit,
  requireTrackedArtifacts: true,
});
const m2Source = await readFile(m2Location.absolutePath, 'utf8');
validateM2ReadyForFreeze(JSON.parse(m2Source), config.reviewProtocol?.mode ?? 'INDEPENDENT_HUMAN');

const primaryManifestSource = await readFile(resolve(primaryArtifactPaths.manifest), 'utf8');
const primaryRawSource = await readFile(resolve(primaryArtifactPaths.raw), 'utf8');
const primarySummarySource = await readFile(resolve(primaryArtifactPaths.summary), 'utf8');
const primarySummaryCsvSource = await readFile(resolve(primaryArtifactPaths.summaryCsv), 'utf8');
const primaryManifest = EvaluationRunManifestSchema.parse(JSON.parse(primaryManifestSource));
if (primaryManifest.runId !== primaryRunId) {
  throw new Error('primary manifest belongs to a different run');
}
if (
  primaryManifest.configPath !== FROZEN_EVALUATION_CONFIG_PATH ||
  primaryManifest.configSha256 !== sha256Source(frozenEvaluationSource) ||
  primaryManifest.ablationConfigSha256 !== sha256Source(frozenAblationSource) ||
  primaryManifest.caseManifestSha256 !== caseManifestSha256 ||
  primaryManifest.gitCommit !== config.freeze.gitCommit ||
  !sameJson(primaryManifest.freezeDigests, expectedDigests) ||
  !sameJson(primaryManifest.systems, PRIMARY_EVALUATION_SYSTEMS) ||
  primaryManifest.reviewProtocol?.mode !== config.reviewProtocol?.mode
) {
  throw new Error('primary run provenance does not match the jointly frozen analysis inputs');
}
validateFreezeTransition({
  reviewedCommit: primaryManifest.gitCommit,
  executionCommit: primaryManifest.executionCommit,
  parentCommits: commitParents(primaryManifest.executionCommit),
  changedPaths: commitChangedPaths(primaryManifest.executionCommit),
  humanReviewPath: reviewBinding.reviewPath,
  dryRunEvidenceDirectory: review.dryRunEvidence.outputDirectory,
});
if (!gitIsAncestor(primaryManifest.executionCommit, analysisCommit)) {
  throw new Error('analysis commit does not descend from the primary freeze execution commit');
}
const attempts = parseAttempts(primaryRawSource);
const selected = selectEvaluationAttempts(attempts, {
  maxAttemptsPerCase: primaryManifest.maxAttemptsPerCase,
  maxTotalRetryAttempts: primaryManifest.maxTotalRetryAttempts,
});
if (selected.length !== 2_000) throw new Error('primary analysis requires 2,000 selected records');
const caseManifest = EvaluationCaseManifestSchema.parse(JSON.parse(caseManifestSource));
const expectedByCase = new Map(caseManifest.entries.map((entry) => [entry.caseId, entry]));
const expectedCaseIds = new Set(expectedByCase.keys());
for (const system of PRIMARY_EVALUATION_SYSTEMS) {
  const rows = selected.filter((attempt) => attempt.result.record.system === system);
  if (
    rows.length !== 400 ||
    new Set(rows.map((attempt) => attempt.result.record.caseId)).size !== 400 ||
    rows.some((attempt) => !expectedCaseIds.has(attempt.result.record.caseId))
  ) {
    throw new Error(`primary ${system} selection does not match the frozen 400-case manifest`);
  }
  for (const attempt of rows) {
    const entry = expectedByCase.get(attempt.result.record.caseId);
    if (
      !entry ||
      attempt.result.scenarioSha256 !== entry.scenarioSha256 ||
      attempt.result.record.baseScenarioId !== entry.baseScenarioId ||
      attempt.result.record.workflow !== entry.workflow ||
      attempt.result.record.class !== entry.class ||
      attempt.result.record.split !== entry.split ||
      !sameJson(attempt.result.record.chainIds, entry.chainIds) ||
      attempt.result.variant !== entry.variant ||
      attempt.result.mutationOperator !== entry.mutationOperator
    ) {
      throw new Error(
        `primary ${system} row ${attempt.result.record.caseId} differs from the frozen case manifest`,
      );
    }
  }
}
const selectedResultSource = selected.map((attempt) => JSON.stringify(attempt.result)).join('\n');
const primaryIntentLock = selected
  .filter((attempt) => attempt.result.record.system === 'INTENTLOCK')
  .map((attempt) => attempt.result);
const primaryLlmByCase = new Map(
  selected
    .filter((attempt) => attempt.result.record.system === 'LLM_VERIFIER')
    .map((attempt) => [attempt.result.record.caseId, attempt.result]),
);
const attemptProvenance = summarizeEvaluationAttempts(attempts, {
  maxAttemptsPerCase: primaryManifest.maxAttemptsPerCase,
  maxTotalRetryAttempts: primaryManifest.maxTotalRetryAttempts,
});
const primaryRecords = selected.map((attempt) => attempt.result.record);
const expectedPrimarySummary = {
  schemaVersion: '0.1',
  runId: primaryRunId,
  selectedRecords: primaryRecords.length,
  recordedAttempts: attempts.length,
  attemptProvenance,
  aggregates: aggregateEvaluationRecords(primaryRecords),
};
if (!sameJson(JSON.parse(primarySummarySource), expectedPrimarySummary)) {
  throw new Error('primary summary does not exactly reproduce the validated raw attempts');
}
if (primarySummaryCsvSource !== `${evaluationRecordsCsv(primaryRecords)}\n`) {
  throw new Error('primary summary CSV does not exactly reproduce the validated selected records');
}
const primaryAnalysis = analyzeEvaluationResults(selected.map((attempt) => attempt.result));

const ablationManifestSource = await readFile(resolve(ablationArtifactPaths.manifest), 'utf8');
const ablationRawSource = await readFile(resolve(ablationArtifactPaths.raw), 'utf8');
const ablationSummarySource = await readFile(resolve(ablationArtifactPaths.summary), 'utf8');
const ablationManifest = AblationRunManifestSchema.parse(JSON.parse(ablationManifestSource));
if (
  ablationManifest.runId !== ablationRunId ||
  ablationManifest.reviewProtocol?.mode !== config.reviewProtocol?.mode ||
  ablationManifest.primaryRunId !== primaryRunId ||
  ablationManifest.gitCommit !== primaryManifest.gitCommit ||
  ablationManifest.primaryExecutionCommit !== primaryManifest.executionCommit ||
  ablationManifest.primaryRunManifestSha256 !== sha256Source(primaryManifestSource) ||
  ablationManifest.primaryRawSha256 !== sha256Source(primaryRawSource) ||
  ablationManifest.primarySummarySha256 !== sha256Source(primarySummarySource) ||
  ablationManifest.primarySummaryCsvSha256 !== sha256Source(primarySummaryCsvSource) ||
  ablationManifest.primarySelectedResultsSha256 !== sha256Text(selectedResultSource) ||
  ablationManifest.frozenEvalSha256 !== sha256Source(frozenEvaluationSource) ||
  ablationManifest.ablationManifestSha256 !== sha256Source(frozenAblationSource) ||
  ablationManifest.caseManifestSha256 !== caseManifestSha256 ||
  !sameJson(ablationManifest.freezeDigests, expectedDigests)
) {
  throw new Error('ablation run provenance does not match the primary/frozen analysis inputs');
}
if (
  !gitIsAncestor(primaryManifest.executionCommit, ablationManifest.executionCommit) ||
  !gitIsAncestor(ablationManifest.executionCommit, analysisCommit)
) {
  throw new Error('ablation execution commit is outside the validated B-to-analysis lineage');
}
const ablationResults = parseAblationRawResults(ablationRawSource, ablationRunId);
assertAblationReferenceMatchesPrimary(ablationResults, primaryIntentLock);
for (const row of ablationResults) {
  const entry = expectedByCase.get(row.result.record.caseId);
  if (
    !entry ||
    row.result.scenarioSha256 !== entry.scenarioSha256 ||
    row.provenance.scenarioSha256 !== entry.scenarioSha256 ||
    row.provenance.caseManifestSha256 !== caseManifestSha256
  ) {
    throw new Error(
      `ablation frozen-case provenance mismatch for ${row.arm}:${row.result.record.caseId}`,
    );
  }
  if (row.provenance.source === 'FRESH_SCENARIO_EVALUATION') continue;
  const primaryLlm = primaryLlmByCase.get(row.result.record.caseId);
  if (
    !primaryLlm ||
    row.provenance.primaryRunId !== primaryRunId ||
    row.provenance.primaryResultSha256 !== sha256Text(JSON.stringify(primaryLlm))
  ) {
    throw new Error(
      `ablation semantic provenance mismatch for ${row.arm}:${row.result.record.caseId}`,
    );
  }
}
assertAblationSummaryMatchesRaw(JSON.parse(ablationSummarySource), ablationResults);
const ablationAnalysis = analyzeAblationResults(ablationResults);

const adaptiveManifestSource = await readFile(resolve(adaptiveArtifactPaths.manifest), 'utf8');
const adaptiveEpisodeSource = await readFile(resolve(adaptiveArtifactPaths.episodes), 'utf8');
const adaptiveComparisonSource = await readFile(resolve(adaptiveArtifactPaths.comparison), 'utf8');
const adaptiveSummarySource = await readFile(resolve(adaptiveArtifactPaths.summary), 'utf8');
const adaptiveReviewPacketSource = await readFile(
  resolve(adaptiveArtifactPaths.reviewPacket),
  'utf8',
);
const adaptiveManifest = AdaptiveRunManifestSchema.parse(JSON.parse(adaptiveManifestSource));
if (
  adaptiveManifest.runId !== adaptiveRunId ||
  adaptiveManifest.primaryRunId !== primaryRunId ||
  adaptiveManifest.reviewedSourceCommit !== primaryManifest.gitCommit ||
  adaptiveManifest.freezeCommit !== primaryManifest.executionCommit ||
  adaptiveManifest.primaryRunManifestSha256 !== sha256Source(primaryManifestSource) ||
  adaptiveManifest.primaryRawSha256 !== sha256Source(primaryRawSource) ||
  adaptiveManifest.primarySelectedResultsSha256 !== sha256Text(selectedResultSource) ||
  adaptiveManifest.frozenEvaluationConfigSha256 !== sha256Source(frozenEvaluationSource) ||
  adaptiveManifest.frozenAblationConfigSha256 !== sha256Source(frozenAblationSource) ||
  adaptiveManifest.caseManifestSha256 !== caseManifestSha256 ||
  (reviewBinding.reviewerType === 'AI'
    ? adaptiveManifest.aiReviewDigestSha256
    : adaptiveManifest.humanReviewDigestSha256) !== sha256Source(reviewSource) ||
  (reviewBinding.reviewerType === 'AI'
    ? adaptiveManifest.aiReviewPath
    : adaptiveManifest.humanReviewPath) !== reviewBinding.reviewPath ||
  adaptiveManifest.reviewProtocol?.mode !== config.reviewProtocol?.mode ||
  adaptiveManifest.m2ValidationDigestSha256 !== sha256Source(m2Source) ||
  !sameJson(adaptiveManifest.freezeDigests, expectedDigests)
) {
  throw new Error('adaptive run provenance does not match the primary/frozen analysis inputs');
}
if (
  !gitIsAncestor(primaryManifest.executionCommit, adaptiveManifest.executionCommit) ||
  !gitIsAncestor(adaptiveManifest.executionCommit, analysisCommit)
) {
  throw new Error('adaptive execution commit is outside the validated B-to-analysis lineage');
}
const adaptiveSelectionSource = await readFile(ADAPTIVE_SELECTION_CONFIG_PATH, 'utf8');
const adaptiveFixtureSource = await readFile(ADAPTIVE_FIXTURE_PATH, 'utf8');
if (
  adaptiveManifest.selectionConfigSha256 !== sha256Source(adaptiveSelectionSource) ||
  adaptiveManifest.fixtureSha256 !== sha256Source(adaptiveFixtureSource)
) {
  throw new Error('adaptive selection or fixture changed after execution');
}
const adaptiveSelection = AdaptiveSelectionConfigSchema.parse(JSON.parse(adaptiveSelectionSource));
const scenarios = await baseScenarios();
const adaptiveSelections = adaptiveSelection.families.flatMap((family) =>
  family.episodes.map((episode) => ({ ...episode, family: family.family })),
);
const selectedInputSource = adaptiveSelections
  .map((selection) => {
    const scenario = scenarios.get(selection.baseScenarioId);
    if (!scenario) {
      throw new Error(`adaptive selected scenario ${selection.baseScenarioId} is missing`);
    }
    return `${scenario.path}\0${sha256Source(scenario.source)}`;
  })
  .join('\n');
if (adaptiveManifest.selectedInputSha256 !== sha256Text(selectedInputSource)) {
  throw new Error('adaptive selected-input digest differs from the committed selection');
}
const staticIntentLockByBaseId = new Map(
  selected
    .filter(
      (attempt) =>
        attempt.result.record.system === 'INTENTLOCK' &&
        attempt.result.variant === 'BENIGN_ORIGINAL',
    )
    .map((attempt) => [attempt.result.record.baseScenarioId, attempt.result]),
);
const adaptiveStaticRows = adaptiveSelections.map((selection) => {
  const row = staticIntentLockByBaseId.get(selection.baseScenarioId);
  if (!row) throw new Error(`adaptive static row ${selection.baseScenarioId} is missing`);
  return row;
});
const adaptiveStaticSource = adaptiveStaticRows.map((row) => JSON.stringify(row)).join('\n');
if (adaptiveManifest.primaryStaticIntentLockSha256 !== sha256Text(adaptiveStaticSource)) {
  throw new Error('adaptive static-primary selection digest mismatch');
}
const episodes = parseAdaptiveEpisodes(adaptiveEpisodeSource);
for (const [index, episode] of episodes.entries()) {
  const selection = adaptiveSelections[index];
  if (
    !selection ||
    episode.baseScenarioId !== selection.baseScenarioId ||
    episode.family !== selection.family ||
    episode.attackType !== selection.attackType ||
    episode.seed !== selection.seed
  ) {
    throw new Error(`adaptive episode ${String(index + 1)} differs from the frozen selection`);
  }
}
const adaptiveComparison = AdaptiveComparisonDocumentSchema.parse(
  JSON.parse(adaptiveComparisonSource),
);
if (
  adaptiveComparison.sources.reviewedSourceCommit !== adaptiveManifest.reviewedSourceCommit ||
  adaptiveComparison.sources.freezeCommit !== adaptiveManifest.freezeCommit ||
  adaptiveComparison.sources.executionCommit !== adaptiveManifest.executionCommit ||
  adaptiveComparison.sources.primaryRunId !== primaryRunId ||
  adaptiveComparison.sources.primaryRunManifestSha256 !==
    adaptiveManifest.primaryRunManifestSha256 ||
  adaptiveComparison.sources.primaryRawSha256 !== adaptiveManifest.primaryRawSha256 ||
  adaptiveComparison.sources.primarySelectedResultsSha256 !==
    adaptiveManifest.primarySelectedResultsSha256 ||
  adaptiveComparison.sources.primaryStaticIntentLockSha256 !==
    adaptiveManifest.primaryStaticIntentLockSha256 ||
  adaptiveComparison.sources.adaptiveSelectionConfigSha256 !==
    adaptiveManifest.selectionConfigSha256
) {
  throw new Error('adaptive comparison provenance differs from its run manifest');
}
for (const [index, row] of adaptiveComparison.rows.entries()) {
  const primary = adaptiveStaticRows[index];
  if (
    !primary ||
    row.frozenStaticIntentLock.primaryResultSha256 !== sha256Text(JSON.stringify(primary)) ||
    !sameJson(row.frozenStaticIntentLock.record, primary.record)
  ) {
    throw new Error(`adaptive comparison static row ${String(index + 1)} is not primary-bound`);
  }
}
const adaptiveAnalysis = analyzeAdaptiveResults(adaptiveRunId, episodes, adaptiveComparison);
assertAdaptiveSummaryMatchesRaw(
  JSON.parse(adaptiveSummarySource),
  adaptiveRunId,
  episodes,
  adaptiveComparison,
);

if (validateOnly) {
  console.log(
    JSON.stringify({
      status: 'INPUTS_VALID_RUNNABLE',
      runnableAnalysis: true,
      jointlyFrozen: true,
      reviewedSourceCommit: primaryManifest.gitCommit,
      freezeCommit: primaryManifest.executionCommit,
      analysisCommit,
      primary: { runId: primaryRunId, selectedRecords: selected.length },
      ablation: { runId: ablationRunId, records: ablationResults.length },
      adaptive: {
        runId: adaptiveRunId,
        episodes: episodes.length,
        comparisonDesign: ADAPTIVE_COMPARISON_DESIGN,
      },
    }),
  );
  process.exit(0);
}

const primaryRows = primaryAnalysis.systems.map((system) => ({
  system: system.system,
  offlineCounterfactualUnsafeAuthorizationRate: percentage(system.aggregate.unsafeExecutionRate),
  offlineCounterfactualUnsafeAuthorizationRate95: `${percentage(system.unsafeExecutionRate95.lower95)}–${percentage(system.unsafeExecutionRate95.upper95)}`,
  offlineCounterfactualBenignCompletion: percentage(system.aggregate.benignCompletionRate),
  offlineCounterfactualBenignCompletion95: `${percentage(system.benignCompletionRate95.lower95)}–${percentage(system.benignCompletionRate95.upper95)}`,
  falseDenyRate: percentage(system.aggregate.falseDenyRate),
  escalationRate: percentage(system.aggregate.escalationRate),
  confirmationRequests: system.aggregate.confirmationRequests,
  confirmationRequestRate: percentage(system.aggregate.confirmationRequestRate),
  detectionOrdinalCounts: `${String(system.detectionOrdinals.planPreflight)}/${String(system.detectionOrdinals.actionPreSign)}/${String(system.detectionOrdinals.postState)}/${String(system.detectionOrdinals.none)}`,
  meanLatencyMs: system.aggregate.meanLatencyMs.toFixed(3),
  tokenCostUsd: system.aggregate.totalTokenCost.toFixed(6),
}));
const primaryTable = [
  '| System | Offline counterfactual unsafe authorization rate | 95% CI | Offline counterfactual benign completion | 95% CI | False deny | Escalation | Confirmation requests (rate) | Detection ordinals 0 / 1..N / N+1 / none | Mean latency | Token cost |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...primaryRows.map(
    (row) =>
      `| ${row.system} | ${row.offlineCounterfactualUnsafeAuthorizationRate} | ${row.offlineCounterfactualUnsafeAuthorizationRate95} | ${row.offlineCounterfactualBenignCompletion} | ${row.offlineCounterfactualBenignCompletion95} | ${row.falseDenyRate} | ${row.escalationRate} | ${String(row.confirmationRequests)} (${row.confirmationRequestRate}) | ${row.detectionOrdinalCounts} | ${row.meanLatencyMs} ms | $${row.tokenCostUsd} |`,
  ),
  '',
  `Run: \`${primaryRunId}\`; frozen source A: \`${primaryManifest.gitCommit}\`; freeze commit B: \`${primaryManifest.executionCommit}\`; primary intention-to-treat records: ${String(selected.length)}; raw attempts: ${String(attemptProvenance.rawAttempts)}.`,
  '',
  'Evidence mode: offline counterfactual replay. This table is not a fixed-fork transaction UER measurement.',
  '',
].join('\n');
const primaryCsv = [
  [
    'system',
    'offline_counterfactual_unsafe_authorization_rate',
    'offline_counterfactual_unsafe_authorization_rate_lower95',
    'offline_counterfactual_unsafe_authorization_rate_upper95',
    'offline_counterfactual_benign_completion_rate',
    'false_deny_rate',
    'escalation_rate',
    'confirmation_requests',
    'confirmation_request_rate',
    'detection_ordinal_0_plan_preflight',
    'detection_ordinal_action_pre_sign',
    'detection_ordinal_n_plus_1_post_state',
    'detection_ordinal_none',
    'mean_latency_ms',
    'token_cost_usd',
  ].join(','),
  ...primaryAnalysis.systems.map((system) =>
    [
      system.system,
      system.aggregate.unsafeExecutionRate,
      system.unsafeExecutionRate95.lower95,
      system.unsafeExecutionRate95.upper95,
      system.aggregate.benignCompletionRate ?? '',
      system.aggregate.falseDenyRate ?? '',
      system.aggregate.escalationRate,
      system.aggregate.confirmationRequests,
      system.aggregate.confirmationRequestRate,
      system.detectionOrdinals.planPreflight,
      system.detectionOrdinals.actionPreSign,
      system.detectionOrdinals.postState,
      system.detectionOrdinals.none,
      system.aggregate.meanLatencyMs,
      system.aggregate.totalTokenCost,
    ].join(','),
  ),
  '',
].join('\n');

const ablationSections = [
  '# Ablation and stage-comparison results',
  '',
  'All rows are offline counterfactual replay. Only the three rows under “one-factor causal ablations” receive paired causal-ablation estimates against `INTENTLOCK_FULL`.',
  '',
  '## One-factor causal ablations',
  '',
  '| Arm | Changed factor | Unsafe authorization | Paired difference vs full (95% CI) | Benign completion | Paired difference vs full (95% CI) |',
  '| --- | --- | ---: | ---: | ---: | ---: |',
  ...ablationAnalysis.rows
    .filter((row) => row.interpretationClass === 'ONE_FACTOR_CAUSAL_ABLATION')
    .map((row) => {
      const unsafe = row.pairedUnsafeRateDifferenceFromReference95;
      const benign = row.pairedBenignCompletionDifferenceFromReference95;
      if (!unsafe || !benign) throw new Error(`${row.arm} is missing its paired estimate`);
      return `| ${row.arm} | ${row.changedFactor} | ${percentage(row.aggregate.unsafeExecutionRate)} | ${signedPercentage(unsafe.point)} (${signedPercentage(unsafe.lower95)}–${signedPercentage(unsafe.upper95)}) | ${percentage(row.aggregate.benignCompletionRate)} | ${signedPercentage(benign.point)} (${signedPercentage(benign.lower95)}–${signedPercentage(benign.upper95)}) |`;
    }),
  '',
  '## Non-causal stage comparisons',
  '',
  '| Arm | Unsafe authorization | Benign completion | Interpretation |',
  '| --- | ---: | ---: | --- |',
  ...ablationAnalysis.rows
    .filter((row) => row.interpretationClass === 'NON_CAUSAL_STAGE_COMPARISON')
    .map(
      (row) =>
        `| ${row.arm} | ${percentage(row.aggregate.unsafeExecutionRate)} | ${percentage(row.aggregate.benignCompletionRate)} | ${row.nonCausalReason ?? 'Descriptive stage comparison only.'} |`,
    ),
  '',
  '## Reference and non-causal policy variant',
  '',
  '| Arm | Class | Unsafe authorization | Benign completion |',
  '| --- | --- | ---: | ---: |',
  ...ablationAnalysis.rows
    .filter(
      (row) =>
        row.interpretationClass === 'REFERENCE' ||
        row.interpretationClass === 'NON_CAUSAL_POLICY_VARIANT',
    )
    .map(
      (row) =>
        `| ${row.arm} | ${row.interpretationClass} | ${percentage(row.aggregate.unsafeExecutionRate)} | ${percentage(row.aggregate.benignCompletionRate)} |`,
    ),
  '',
  `Run: \`${ablationRunId}\`; records: 3,200; primary reference parity: verified case by case.`,
  '',
].join('\n');
const ablationCsv = [
  [
    'arm',
    'interpretation_class',
    'changed_factor',
    'causal_ablation',
    'unsafe_authorization_rate',
    'benign_completion_rate',
    'paired_unsafe_difference_from_full',
    'paired_benign_difference_from_full',
  ].join(','),
  ...ablationAnalysis.rows.map((row) =>
    [
      row.arm,
      row.interpretationClass,
      row.changedFactor,
      row.causalAblation,
      row.aggregate.unsafeExecutionRate,
      row.aggregate.benignCompletionRate ?? '',
      row.pairedUnsafeRateDifferenceFromReference95?.point ?? '',
      row.pairedBenignCompletionDifferenceFromReference95?.point ?? '',
    ].join(','),
  ),
  '',
].join('\n');

const adaptiveTable = [
  '# Adaptive signer-boundary descriptive results',
  '',
  '**Design:** `NON_PAIRED_NON_CAUSAL`. These are deterministic scripted, offline signer-boundary episodes with a fake executor and no post-state observation. They are not model-adaptive, fork-execution, production MetaMask, paired-case, equivalent-case, or causal evidence.',
  '',
  '| Evidence source | Scope | Rows | Descriptive counts |',
  '| --- | --- | ---: | --- |',
  `| Frozen static primary | OFFLINE_COUNTERFACTUAL_REPLAY | 40 | ALLOW ${String(adaptiveAnalysis.staticPrimaryDescriptive.preSignDecisions.ALLOW)}; DENY ${String(adaptiveAnalysis.staticPrimaryDescriptive.preSignDecisions.DENY)}; ABSTAIN ${String(adaptiveAnalysis.staticPrimaryDescriptive.preSignDecisions.ABSTAIN)} |`,
  `| Adaptive signer boundary | OFFLINE_SCRIPTED_SIGNER_BOUNDARY_ONLY | 40 | ATTACK_SUCCESS ${String(adaptiveAnalysis.adaptiveSignerBoundaryDescriptive.outcomes.ATTACK_SUCCESS)}; SAFE_BLOCK ${String(adaptiveAnalysis.adaptiveSignerBoundaryDescriptive.outcomes.SAFE_BLOCK)}; NORMAL_FAILURE ${String(adaptiveAnalysis.adaptiveSignerBoundaryDescriptive.outcomes.NORMAL_FAILURE)}; INCONCLUSIVE ${String(adaptiveAnalysis.adaptiveSignerBoundaryDescriptive.outcomes.INCONCLUSIVE)} |`,
  '',
  'No cross-row rate difference is computed because the two evidence sources are neither paired nor equivalent experimental cases.',
  '',
  `Run: \`${adaptiveRunId}\`; attempted plans: ${String(adaptiveAnalysis.adaptiveSignerBoundaryDescriptive.attemptedPlans)}; signer invocations: ${String(adaptiveAnalysis.adaptiveSignerBoundaryDescriptive.signerInvocations)}.`,
  '',
].join('\n');
const adaptiveCsv = [
  'design,claim_scope,source,rows,allow,deny,abstain,attack_success,safe_block,normal_failure,inconclusive',
  [
    ADAPTIVE_COMPARISON_DESIGN,
    'OFFLINE_COUNTERFACTUAL_REPLAY',
    'FROZEN_STATIC_PRIMARY_DESCRIPTIVE',
    40,
    adaptiveAnalysis.staticPrimaryDescriptive.preSignDecisions.ALLOW,
    adaptiveAnalysis.staticPrimaryDescriptive.preSignDecisions.DENY,
    adaptiveAnalysis.staticPrimaryDescriptive.preSignDecisions.ABSTAIN,
    '',
    '',
    '',
    '',
  ].join(','),
  [
    ADAPTIVE_COMPARISON_DESIGN,
    'OFFLINE_SCRIPTED_SIGNER_BOUNDARY_ONLY',
    'DETERMINISTIC_SCRIPTED_FAKE_EXECUTOR',
    40,
    '',
    '',
    '',
    adaptiveAnalysis.adaptiveSignerBoundaryDescriptive.outcomes.ATTACK_SUCCESS,
    adaptiveAnalysis.adaptiveSignerBoundaryDescriptive.outcomes.SAFE_BLOCK,
    adaptiveAnalysis.adaptiveSignerBoundaryDescriptive.outcomes.NORMAL_FAILURE,
    adaptiveAnalysis.adaptiveSignerBoundaryDescriptive.outcomes.INCONCLUSIVE,
  ].join(','),
  '',
].join('\n');

await mkdir(resolve('paper/tables'), { recursive: true });
await mkdir(resolve('figures'), { recursive: true });
await writeFile(
  resolve('paper/tables/results.json'),
  await format(
    JSON.stringify({
      ...primaryAnalysis,
      evidenceMode: 'OFFLINE_COUNTERFACTUAL_REPLAY',
      attemptProvenance,
      freezeDigests: expectedDigests,
    }),
    { parser: 'json' },
  ),
  'utf8',
);
await writeFile(resolve('paper/tables/results.md'), primaryTable, 'utf8');
await writeFile(resolve('paper/tables/results.csv'), primaryCsv, 'utf8');
await writeFile(
  resolve('paper/tables/ablations.json'),
  await format(JSON.stringify(ablationAnalysis), { parser: 'json' }),
  'utf8',
);
await writeFile(resolve('paper/tables/ablations.md'), ablationSections, 'utf8');
await writeFile(resolve('paper/tables/ablations.csv'), ablationCsv, 'utf8');
await writeFile(
  resolve('paper/tables/adaptive.json'),
  await format(JSON.stringify(adaptiveAnalysis), { parser: 'json' }),
  'utf8',
);
await writeFile(resolve('paper/tables/adaptive.md'), adaptiveTable, 'utf8');
await writeFile(resolve('paper/tables/adaptive.csv'), adaptiveCsv, 'utf8');
await writeFile(
  resolve('figures/security-utility.svg'),
  securityUtilitySvg(primaryAnalysis),
  'utf8',
);
await writeFile(resolve('figures/error-taxonomy.svg'), errorTaxonomySvg(primaryAnalysis), 'utf8');
await writeFile(resolve('figures/latency.svg'), latencySvg(primaryAnalysis), 'utf8');
await writeFile(resolve('figures/architecture.svg'), architectureSvg(primaryRunId), 'utf8');
await writeFile(
  resolve('paper/tables/results.metadata.json'),
  await format(
    JSON.stringify({
      schemaVersion: '0.2',
      generatedAt: new Date().toISOString(),
      analysisCommit,
      workingTreeDirtyAtStart: false,
      reviewProtocol: config.reviewProtocol,
      freeze: {
        reviewedSourceCommit: primaryManifest.gitCommit,
        freezeCommit: primaryManifest.executionCommit,
        freezeDigests: expectedDigests,
        review: reviewBinding,
        ...(reviewBinding.reviewerType === 'HUMAN'
          ? { humanReviewDigestSha256: reviewBinding.reviewDigestSha256 }
          : { aiReviewDigestSha256: reviewBinding.reviewDigestSha256 }),
      },
      primary: {
        runId: primaryRunId,
        selectedRecords: selected.length,
        rawAttempts: attempts.length,
        manifestSha256: sha256Source(primaryManifestSource),
        rawSha256: sha256Source(primaryRawSource),
        selectedResultsSha256: sha256Text(selectedResultSource),
        executionCommit: primaryManifest.executionCommit,
        evidenceMode: 'OFFLINE_COUNTERFACTUAL_REPLAY',
        attemptProvenance,
      },
      ablation: {
        runId: ablationRunId,
        records: ablationResults.length,
        manifestSha256: sha256Source(ablationManifestSource),
        rawSha256: sha256Source(ablationRawSource),
        summarySha256: sha256Source(ablationSummarySource),
        executionCommit: ablationManifest.executionCommit,
        referenceParityVerified: true,
        stageComparisonsCausal: false,
        oneFactorCausalAblations: ablationAnalysis.design.oneFactorCausalAblations,
      },
      adaptive: {
        runId: adaptiveRunId,
        episodes: episodes.length,
        manifestSha256: sha256Source(adaptiveManifestSource),
        episodesSha256: sha256Source(adaptiveEpisodeSource),
        comparisonSha256: sha256Source(adaptiveComparisonSource),
        summarySha256: sha256Source(adaptiveSummarySource),
        pendingHumanReviewPacketSha256: sha256Source(adaptiveReviewPacketSource),
        executionCommit: adaptiveManifest.executionCommit,
        comparisonDesign: ADAPTIVE_COMPARISON_DESIGN,
        claimScope: 'OFFLINE_SCRIPTED_SIGNER_BOUNDARY_ONLY',
        causalComparison: false,
        equivalentCases: false,
        modelAdaptiveEvidence: false,
        forkExecutionEvidence: false,
      },
    }),
    { parser: 'json' },
  ),
  'utf8',
);
console.log(
  JSON.stringify({
    primaryRunId,
    ablationRunId,
    adaptiveRunId,
    primarySelectedRecords: selected.length,
    ablationRecords: ablationResults.length,
    adaptiveEpisodes: episodes.length,
    tables: 9,
    figures: 4,
  }),
);
