import { execFileSync } from 'node:child_process';
import { open, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { format } from 'prettier';
import { parse } from 'yaml';

import { BenchmarkScenarioSchema, type BenchmarkScenario } from '../src/benchmark/scenario.js';
import {
  ABLATION_ARMS,
  AblationManifestSchema,
  AblationRawEnvelopeSchema,
  AblationRunManifestSchema,
  ARM_METADATA,
  ReadyAblationManifestSchema,
  evaluateAblationCase,
  validateOneFactorConfigurations,
  type AblationArm,
  type AblationResult,
} from '../src/experiments/ablations.js';
import {
  benignCompletionCount,
  groupedStratifiedBootstrap,
  unsafeExecutionCount,
} from '../src/experiments/bootstrap.js';
import { verifyCaseManifest } from '../src/experiments/case-manifest.js';
import { createEvaluationCaseMatrix } from '../src/experiments/case-matrix.js';
import { RawEvaluationResultSchema } from '../src/experiments/evaluate-case.js';
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
import { aggregateEvaluationRecords } from '../src/experiments/metrics.js';
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
  assertPrimaryEvaluationMatrixBinding,
  assertPrimaryRunManifestIdentity,
  selectEvaluationAttempts,
  type EvaluationAttempt,
} from '../src/experiments/run-artifacts.js';
import { validateFreezeReviewEvidenceFromRepository } from './freeze-review-evidence.js';

function argument(name: string): string | undefined {
  return process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
}

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function requireTrackedAtHead(path: string): void {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', path], { stdio: 'ignore' });
  } catch {
    throw new Error(`primary result artifact must be committed before ablation: ${path}`);
  }
}

function defaultRunId(primaryRunId: string): string {
  const timestamp = new Date()
    .toISOString()
    .replaceAll(/[-:.TZ]/g, '')
    .slice(0, 14);
  return `${primaryRunId}-ablations-${timestamp}`;
}

async function formattedJson(value: unknown): Promise<string> {
  return format(JSON.stringify(value), { parser: 'json' });
}

async function baseScenarios(): Promise<BenchmarkScenario[]> {
  const root = 'benchmark/scenarios/base';
  const scenarios: BenchmarkScenario[] = [];
  for (const directory of (await readdir(root)).sort()) {
    if (!(await stat(`${root}/${directory}`)).isDirectory()) continue;
    for (const file of (await readdir(`${root}/${directory}`)).sort()) {
      if (!file.endsWith('.json')) continue;
      scenarios.push(
        BenchmarkScenarioSchema.parse(
          JSON.parse(await readFile(`${root}/${directory}/${file}`, 'utf8')),
        ),
      );
    }
  }
  return scenarios;
}

function parseAttempts(source: string): EvaluationAttempt[] {
  if (!source.trim()) return [];
  return source
    .trim()
    .split(/\r?\n/)
    .map((line) => EvaluationAttemptSchema.parse(JSON.parse(line)));
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

const frozenConfigArgument = argument('--config') ?? FROZEN_EVALUATION_CONFIG_PATH;
const ablationConfigArgument = argument('--ablation-config') ?? FROZEN_ABLATION_CONFIG_PATH;
if (frozenConfigArgument.replaceAll('\\', '/') !== FROZEN_EVALUATION_CONFIG_PATH) {
  throw new Error('ablation evaluation requires the canonical frozen evaluation config');
}
if (ablationConfigArgument.replaceAll('\\', '/') !== FROZEN_ABLATION_CONFIG_PATH) {
  throw new Error('ablation evaluation requires the canonical ablation manifest');
}

const repositoryRoot = resolve('.');
const frozenConfigText = await readFile(resolve(frozenConfigArgument), 'utf8');
const ablationConfigText = await readFile(resolve(ablationConfigArgument), 'utf8');
const candidateFrozenConfig = FrozenEvalConfigSchema.parse(parse(frozenConfigText));
const candidateAblationConfig = AblationManifestSchema.parse(JSON.parse(ablationConfigText));
validateOneFactorConfigurations();
const matrix = createEvaluationCaseMatrix(await baseScenarios());
const caseManifestText = await readFile(
  resolve(candidateFrozenConfig.dataset.caseManifest),
  'utf8',
);
verifyCaseManifest(JSON.parse(caseManifestText), matrix);

if (process.argv.includes('--validate-inputs')) {
  console.log(
    JSON.stringify({
      frozenEvaluationStatus: candidateFrozenConfig.status,
      ablationStatus: candidateAblationConfig.status,
      baseCases: matrix.baseCount,
      curatedCases: matrix.caseCount,
      arms: candidateAblationConfig.arms.length,
      oneFactorConfigurationsValid: true,
      runnableAblations:
        ReadyFrozenEvalConfigSchema.safeParse(candidateFrozenConfig).success &&
        ReadyAblationManifestSchema.safeParse(candidateAblationConfig).success,
    }),
  );
  process.exit(0);
}

const config = ReadyFrozenEvalConfigSchema.parse(candidateFrozenConfig);
const ablationConfig = ReadyAblationManifestSchema.parse(candidateAblationConfig);
if (git('status', '--porcelain')) throw new Error('ablation evaluation requires a clean worktree');
const head = git('rev-parse', 'HEAD');
const reviewedCommit = config.freeze.gitCommit;
if (
  ablationConfig.freeze.gitCommit !== reviewedCommit ||
  ablationConfig.freeze.frozenAt !== config.freeze.frozenAt ||
  ablationConfig.freeze.humanReviewer !== config.freeze.humanReviewer ||
  (ablationConfig.freeze.aiReviewer ?? null) !==
    (config.freeze.aiReview?.reviewerPseudonym ?? null) ||
  ablationConfig.reviewProtocol?.mode !== config.reviewProtocol?.mode
) {
  throw new Error('evaluation and ablation manifests must share the same freeze envelope');
}
const actualDigests = await computeFreezeDigests(config);
const frozenDigests = freezeDigestsFromConfig(config);
if (!frozenDigests) throw new Error('frozen digest envelope is incomplete');
const changedDigests = differingFreezeDigests(frozenDigests, actualDigests);
if (changedDigests.length > 0) {
  throw new Error(`frozen inputs changed: ${changedDigests.join(', ')}`);
}
const reviewBinding = getFreezeReviewBinding(config);
const reviewLocation = resolveRepoRelativeJson(repositoryRoot, reviewBinding.reviewPath);
const reviewText = await readFile(reviewLocation.absolutePath, 'utf8');
if (sha256Source(reviewText) !== reviewBinding.reviewDigestSha256) {
  throw new Error('frozen review digest changed');
}
const { review } = await validateFreezeReviewEvidenceFromRepository({
  repositoryRoot,
  reviewInput: JSON.parse(reviewText),
  reviewedCommit,
  requireTrackedArtifacts: true,
});
const m2Location = resolveRepoRelativeJson(repositoryRoot, config.dataset.m2Validation);
validateM2ReadyForFreeze(
  JSON.parse(await readFile(m2Location.absolutePath, 'utf8')),
  config.reviewProtocol?.mode ?? 'INDEPENDENT_HUMAN',
);

const primaryRunId = argument('--primary-run-id');
if (!primaryRunId || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,79}$/.test(primaryRunId)) {
  throw new Error('--primary-run-id is required');
}
const requestedRunId = argument('--run-id') ?? defaultRunId(primaryRunId);
const runId = AblationRunManifestSchema.shape.runId.parse(requestedRunId);
const primaryRoot = resolve('experiments/results', primaryRunId);
const primaryArtifactPaths = {
  manifest: `experiments/results/${primaryRunId}/manifest.json`,
  raw: `experiments/results/${primaryRunId}/raw.jsonl`,
  summary: `experiments/results/${primaryRunId}/summary.json`,
  summaryCsv: `experiments/results/${primaryRunId}/summary.csv`,
} as const;
Object.values(primaryArtifactPaths).forEach(requireTrackedAtHead);
const primaryManifestText = await readFile(resolve(primaryRoot, 'manifest.json'), 'utf8');
const primaryManifest = EvaluationRunManifestSchema.parse(JSON.parse(primaryManifestText));
assertPrimaryRunManifestIdentity(primaryManifest, primaryRunId);
const freezeExecutionCommit = primaryManifest.executionCommit;
const revision = git('rev-list', '--parents', '-n', '1', freezeExecutionCommit).split(/\s+/);
const [listedFreezeCommit, ...parentCommits] = revision;
if (listedFreezeCommit !== freezeExecutionCommit) {
  throw new Error('could not resolve primary freeze transition parents');
}
const changedPaths = git(
  'diff-tree',
  '--no-commit-id',
  '--name-only',
  '--no-renames',
  '-r',
  freezeExecutionCommit,
)
  .split(/\r?\n/)
  .filter(Boolean);
validateFreezeTransition({
  reviewedCommit,
  executionCommit: freezeExecutionCommit,
  parentCommits,
  changedPaths,
  humanReviewPath: reviewBinding.reviewPath,
  dryRunEvidenceDirectory: review.dryRunEvidence.outputDirectory,
});
try {
  execFileSync('git', ['merge-base', '--is-ancestor', freezeExecutionCommit, head], {
    stdio: 'ignore',
  });
} catch {
  throw new Error('ablation commit must descend from the primary freeze execution commit');
}
if (
  primaryManifest.gitCommit !== reviewedCommit ||
  primaryManifest.configSha256 !== sha256Text(frozenConfigText) ||
  primaryManifest.ablationConfigSha256 !== sha256Text(ablationConfigText) ||
  primaryManifest.caseManifestSha256 !== sha256Text(caseManifestText) ||
  !sameJson(primaryManifest.freezeDigests, frozenDigests) ||
  !sameJson(primaryManifest.systems, PRIMARY_EVALUATION_SYSTEMS) ||
  primaryManifest.reviewProtocol?.mode !== config.reviewProtocol?.mode
) {
  throw new Error('primary run provenance does not match the frozen ablation inputs');
}
const primaryRawText = await readFile(resolve(primaryRoot, 'raw.jsonl'), 'utf8');
const primarySummaryText = await readFile(resolve(primaryRoot, 'summary.json'), 'utf8');
const primarySummaryCsvText = await readFile(resolve(primaryRoot, 'summary.csv'), 'utf8');
const selected = selectEvaluationAttempts(parseAttempts(primaryRawText), {
  maxAttemptsPerCase: primaryManifest.maxAttemptsPerCase,
  maxTotalRetryAttempts: primaryManifest.maxTotalRetryAttempts,
});
if (selected.length !== 2_000) throw new Error('primary run does not have 2,000 selected records');
assertPrimaryEvaluationMatrixBinding({
  attempts: selected,
  primaryRunId,
  entries: matrix.entries,
  scenarios: matrix.scenarios,
});
const primaryLlmByCase = new Map(
  selected
    .filter((attempt) => attempt.result.record.system === 'LLM_VERIFIER')
    .map((attempt) => [attempt.result.record.caseId, attempt.result]),
);
if (primaryLlmByCase.size !== 400) throw new Error('primary LLM result set is incomplete');

const createdAt = new Date().toISOString();
const selectedResultText = selected.map((attempt) => JSON.stringify(attempt.result)).join('\n');
const runManifest = AblationRunManifestSchema.parse({
  schemaVersion: '0.2',
  runId,
  createdAt,
  gitCommit: reviewedCommit,
  primaryExecutionCommit: freezeExecutionCommit,
  executionCommit: head,
  primaryRunId,
  primaryRunManifestSha256: sha256Text(primaryManifestText),
  reviewProtocol: config.reviewProtocol,
  primaryRawSha256: sha256Text(primaryRawText),
  primarySummarySha256: sha256Text(primarySummaryText),
  primarySummaryCsvSha256: sha256Text(primarySummaryCsvText),
  primarySelectedResultsSha256: sha256Text(selectedResultText),
  frozenEvalSha256: sha256Text(frozenConfigText),
  ablationManifestSha256: sha256Text(ablationConfigText),
  caseManifestSha256: sha256Text(caseManifestText),
  freezeDigests: frozenDigests,
  rootSeed: matrix.rootSeed,
  caseCount: matrix.caseCount,
  arms: ABLATION_ARMS,
  expectedRecords: 3_200,
  evaluationMode: 'OFFLINE_COUNTERFACTUAL_REPLAY',
  appendOnly: true,
  overwrite: false,
});
const runRoot = resolve('experiments/results', runId);
await mkdir(runRoot, { recursive: false });
await writeFile(resolve(runRoot, 'manifest.json'), await formattedJson(runManifest), {
  flag: 'wx',
});

const resultsByArm = new Map<AblationArm, AblationResult[]>();
const rawHandle = await open(resolve(runRoot, 'ablation-results.jsonl'), 'ax');
let sequence = 0;
try {
  for (const arm of ABLATION_ARMS) {
    const armResults: AblationResult[] = [];
    for (const [index, entry] of matrix.entries.entries()) {
      const scenario = matrix.scenarios[index];
      if (!scenario) throw new Error(`scenario missing for ${entry.caseId}`);
      const primaryLlmResult = RawEvaluationResultSchema.parse(primaryLlmByCase.get(entry.caseId));
      const result = evaluateAblationCase({
        runId,
        arm,
        scenario,
        entry,
        evaluatedAt: config.caseMatrix.evaluatedAt,
        caseManifestSha256: runManifest.caseManifestSha256,
        primaryRunId,
        primaryLlmResult,
      });
      armResults.push(result);
      const envelope = AblationRawEnvelopeSchema.parse({
        schemaVersion: '0.1',
        sequence,
        recordedAt: new Date().toISOString(),
        value: result,
      });
      await rawHandle.appendFile(`${JSON.stringify(envelope)}\n`, 'utf8');
      sequence += 1;
    }
    resultsByArm.set(arm, armResults);
  }
  await rawHandle.sync();
} finally {
  await rawHandle.close();
}
if (sequence !== 3_200) throw new Error(`ablation record count ${String(sequence)} != 3200`);

const summary = ABLATION_ARMS.map((arm, armIndex) => {
  const armResults = resultsByArm.get(arm) ?? [];
  if (armResults.length !== 400) throw new Error(`${arm} did not evaluate all 400 cases`);
  const records = armResults.map((result) => result.result.record);
  const [aggregate] = aggregateEvaluationRecords(records);
  if (!aggregate) throw new Error(`aggregate missing for ${arm}`);
  const metadata = ARM_METADATA[arm];
  return {
    arm,
    kind: metadata.kind,
    causalAblation: metadata.causalAblation,
    changedFactor: metadata.changedFactor,
    nonCausalReason: metadata.nonCausalReason,
    configuration: metadata.configuration,
    records: records.length,
    aggregate,
    unsafeExecutionRate95: groupedStratifiedBootstrap(records, unsafeExecutionCount, {
      replicates: 10_000,
      seed: 2026 + armIndex * 2,
    }),
    benignCompletionRate95: groupedStratifiedBootstrap(records, benignCompletionCount, {
      replicates: 10_000,
      seed: 2027 + armIndex * 2,
    }),
    postStateDetections: armResults.filter(
      (result) => result.result.firstDetectionStage === 'POST_STATE',
    ).length,
    detectionOrdinals: {
      planPreflight: armResults.filter((result) => result.result.firstDetectionOrdinal === 0)
        .length,
      actionPreSign: armResults.filter(
        (result) =>
          result.result.firstDetectionStage === 'PRE_SIGN' &&
          result.result.firstDetectionOrdinal !== null &&
          result.result.firstDetectionOrdinal > 0,
      ).length,
      postState: armResults.filter((result) => result.result.firstDetectionStage === 'POST_STATE')
        .length,
      none: armResults.filter((result) => result.result.firstDetectionOrdinal === null).length,
    },
    provenanceSources: Object.fromEntries(
      ['FRESH_SCENARIO_EVALUATION', 'PRIMARY_LLM_REFERENCE', 'FRESH_PLUS_PRIMARY_LLM'].map(
        (source) => [
          source,
          armResults.filter((result) => result.provenance.source === source).length,
        ],
      ),
    ),
  };
});
await writeFile(
  resolve(runRoot, 'summary.json'),
  await formattedJson({ schemaVersion: '0.2', runId, records: sequence, summary }),
  { flag: 'wx' },
);
console.log(JSON.stringify({ runId, cases: 400, arms: ABLATION_ARMS.length, records: sequence }));
