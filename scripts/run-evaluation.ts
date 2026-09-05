import { execFileSync } from 'node:child_process';
import { appendFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { format } from 'prettier';
import { parse } from 'yaml';

import {
  LlmVerifierConfigSchema,
  LLM_VERIFIER_PROMPT_VERSION,
} from '../src/baselines/llm-verifier.js';
import { OpenAiResponsesClient } from '../src/baselines/openai-responses-client.js';
import { BenchmarkScenarioSchema, type BenchmarkScenario } from '../src/benchmark/scenario.js';
import { ReadyAblationManifestSchema } from '../src/experiments/ablations.js';
import { verifyCaseManifest } from '../src/experiments/case-manifest.js';
import { createEvaluationCaseMatrix } from '../src/experiments/case-matrix.js';
import { evaluateCase } from '../src/experiments/evaluate-case.js';
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
  aggregateEvaluationRecords,
  evaluationRecordsCsv,
  EvaluationSystemSchema,
  type EvaluationRecord,
} from '../src/experiments/metrics.js';
import {
  FrozenEvalConfigSchema,
  getFreezeReviewBinding,
  ReadyFrozenEvalConfigSchema,
  sha256Text,
} from '../src/experiments/protocol.js';
import { validateFreezeReviewEvidenceFromRepository } from './freeze-review-evidence.js';
import {
  EvaluationAttemptSchema,
  EvaluationRunManifestSchema,
  PRIMARY_EVALUATION_SYSTEMS,
  isOperationalRetryEligible,
  nextAttemptNumber,
  selectEvaluationAttempts,
  summarizeEvaluationAttempts,
  type EvaluationAttempt,
  type EvaluationRunManifest,
} from '../src/experiments/run-artifacts.js';

function argument(name: string): string | undefined {
  return process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
}

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function commitParents(commit: string): string[] {
  const [resolved, ...parents] = git('rev-list', '--parents', '-n', '1', commit).split(/\s+/u);
  if (resolved !== commit) throw new Error(`cannot resolve freeze commit ${commit}`);
  return parents;
}

function commitChangedPaths(commit: string): string[] {
  const output = git('diff-tree', '--no-commit-id', '--name-only', '--no-renames', '-r', commit);
  return output ? output.split(/\r?\n/u) : [];
}

function envValue(contents: string, name: string): string | undefined {
  const match = contents.match(new RegExp(`^\\s*${name}\\s*=\\s*(.+?)\\s*$`, 'm'));
  if (!match?.[1]) return undefined;
  const value = match[1];
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  )
    return value.slice(1, -1);
  return value;
}

async function apiKey(): Promise<string> {
  const fromProcess = process.env.OPENAI_API_KEY;
  if (fromProcess?.trim()) return fromProcess;
  const local = await readFile(resolve('.env.local'), 'utf8').catch(() => '');
  const value = envValue(local, 'OPENAI_API_KEY');
  if (!value?.trim()) throw new Error('OPENAI_API_KEY is not configured');
  return value;
}

async function baseScenarios(): Promise<BenchmarkScenario[]> {
  const root = 'benchmark/scenarios/base';
  const directories = (await readdir(root)).sort();
  const scenarios: BenchmarkScenario[] = [];
  for (const directory of directories) {
    const metadata = await stat(`${root}/${directory}`);
    if (!metadata.isDirectory()) continue;
    const files = (await readdir(`${root}/${directory}`))
      .filter((file) => file.endsWith('.json'))
      .sort();
    for (const file of files) {
      scenarios.push(
        BenchmarkScenarioSchema.parse(
          JSON.parse(await readFile(`${root}/${directory}/${file}`, 'utf8')),
        ),
      );
    }
  }
  return scenarios;
}

function parseSystems(): EvaluationRecord['system'][] {
  const requested = argument('--systems')?.split(',') ?? [...PRIMARY_EVALUATION_SYSTEMS];
  const parsed = requested.map((system) => EvaluationSystemSchema.parse(system));
  if (new Set(parsed).size !== parsed.length) throw new Error('duplicate --systems entry');
  if (
    parsed.length !== PRIMARY_EVALUATION_SYSTEMS.length ||
    PRIMARY_EVALUATION_SYSTEMS.some((system) => !parsed.includes(system))
  ) {
    throw new Error('the primary run requires all five preregistered systems');
  }
  return [...PRIMARY_EVALUATION_SYSTEMS];
}

function defaultRunId(): string {
  return `primary-${new Date()
    .toISOString()
    .replaceAll(/[-:.TZ]/g, '')
    .slice(0, 14)}`;
}

async function formattedJson(value: unknown): Promise<string> {
  return format(JSON.stringify(value), { parser: 'json' });
}

async function readAttempts(path: string): Promise<EvaluationAttempt[]> {
  const source = await readFile(path, 'utf8').catch(() => '');
  if (!source.trim()) return [];
  return source
    .trim()
    .split(/\r?\n/)
    .map((line) => EvaluationAttemptSchema.parse(JSON.parse(line)));
}

async function validateRunRootContents(path: string): Promise<void> {
  const entries = await readdir(path).catch((cause: unknown) => {
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return [];
    throw cause;
  });
  const allowed = new Set(['manifest.json', 'raw.jsonl', 'summary.json', 'summary.csv']);
  for (const entry of entries) {
    if (!allowed.has(entry) || !(await stat(resolve(path, entry))).isFile()) {
      throw new Error(`run directory contains an unexpected resume artifact: ${entry}`);
    }
  }
}

async function pool<T>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (next < values.length) {
        const index = next;
        next += 1;
        const value = values[index];
        if (value !== undefined) await worker(value);
      }
    }),
  );
}

const configManifestPath = argument('--config') ?? FROZEN_EVALUATION_CONFIG_PATH;
if (configManifestPath.replaceAll('\\', '/') !== FROZEN_EVALUATION_CONFIG_PATH) {
  throw new Error('the primary run requires the canonical frozen evaluation config');
}
const repositoryRoot = resolve('.');
const configPath = resolve(configManifestPath);
const configText = await readFile(configPath, 'utf8');
const ablationConfigText = await readFile(resolve(FROZEN_ABLATION_CONFIG_PATH), 'utf8');
const candidate = FrozenEvalConfigSchema.parse(parse(configText));
const matrix = createEvaluationCaseMatrix(await baseScenarios());
const caseManifestText = await readFile(resolve(candidate.dataset.caseManifest), 'utf8');
verifyCaseManifest(JSON.parse(caseManifestText), matrix);

if (process.argv.includes('--validate-inputs')) {
  console.log(
    JSON.stringify({
      status: candidate.status,
      baseCases: matrix.baseCount,
      curatedCases: matrix.caseCount,
      runnablePrimary: ReadyFrozenEvalConfigSchema.safeParse(candidate).success,
    }),
  );
  process.exit(0);
}

const config = ReadyFrozenEvalConfigSchema.parse(candidate);
const ablationConfig = ReadyAblationManifestSchema.parse(JSON.parse(ablationConfigText));
if (
  ablationConfig.freeze.gitCommit !== config.freeze.gitCommit ||
  ablationConfig.freeze.frozenAt !== config.freeze.frozenAt ||
  ablationConfig.freeze.humanReviewer !== config.freeze.humanReviewer ||
  (ablationConfig.freeze.aiReviewer ?? null) !==
    (config.freeze.aiReview?.reviewerPseudonym ?? null) ||
  ablationConfig.reviewProtocol?.mode !== config.reviewProtocol?.mode
) {
  throw new Error('evaluation and ablation manifests were not jointly frozen');
}
if (git('status', '--porcelain')) throw new Error('primary evaluation requires a clean worktree');
const executionCommit = git('rev-parse', 'HEAD');
const reviewBinding = getFreezeReviewBinding(config);
const reviewLocation = resolveRepoRelativeJson(repositoryRoot, reviewBinding.reviewPath);
const reviewSource = await readFile(reviewLocation.absolutePath, 'utf8');
if (sha256Source(reviewSource) !== reviewBinding.reviewDigestSha256) {
  throw new Error('frozen review digest changed');
}
const { review } = await validateFreezeReviewEvidenceFromRepository({
  repositoryRoot,
  reviewInput: JSON.parse(reviewSource),
  reviewedCommit: config.freeze.gitCommit,
  requireTrackedArtifacts: true,
});
validateFreezeTransition({
  reviewedCommit: config.freeze.gitCommit,
  executionCommit,
  parentCommits: commitParents(executionCommit),
  changedPaths: commitChangedPaths(executionCommit),
  humanReviewPath: reviewBinding.reviewPath,
  dryRunEvidenceDirectory: review.dryRunEvidence.outputDirectory,
});
const actualDigests = await computeFreezeDigests(config);
const expectedDigests = freezeDigestsFromConfig(config);
if (!expectedDigests) throw new Error('frozen digest envelope is incomplete');
const changed = differingFreezeDigests(expectedDigests, actualDigests);
if (changed.length > 0) throw new Error(`frozen inputs changed: ${changed.join(', ')}`);
const m2Location = resolveRepoRelativeJson(repositoryRoot, config.dataset.m2Validation);
validateM2ReadyForFreeze(
  JSON.parse(await readFile(m2Location.absolutePath, 'utf8')),
  config.reviewProtocol?.mode ?? 'INDEPENDENT_HUMAN',
);

const runId = argument('--run-id') ?? defaultRunId();
const systems = parseSystems();
const concurrency = Number(argument('--concurrency') ?? '4');
if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 32) {
  throw new Error('--concurrency must be an integer from 1 to 32');
}
const runRoot = resolve('experiments/results', runId);
const rawPath = resolve(runRoot, 'raw.jsonl');
const manifestPath = resolve(runRoot, 'manifest.json');
await validateRunRootContents(runRoot);
await mkdir(runRoot, { recursive: true });
const expectedManifest = EvaluationRunManifestSchema.parse({
  schemaVersion: '0.1',
  runId,
  protocolVersion: config.protocolVersion,
  reviewProtocol: config.reviewProtocol,
  datasetVersion: config.dataset.version,
  createdAt: new Date().toISOString(),
  gitCommit: config.freeze.gitCommit,
  executionCommit,
  configPath: 'experiments/configs/frozen-eval.yaml',
  configSha256: sha256Text(configText),
  ablationConfigSha256: sha256Text(ablationConfigText),
  caseManifestSha256: sha256Text(caseManifestText),
  freezeDigests: expectedDigests,
  systems,
  caseCount: 400,
  expectedSelectedRecords: 2_000,
  retryResultSelection: config.failurePolicy.retryResultSelection,
  maxAttemptsPerCase: config.failurePolicy.maxAttemptsPerCase,
  maxTotalRetryAttempts: config.failurePolicy.maxTotalRetryAttempts,
  overwrite: false,
  modelId: config.models.primary.id,
});
const existingManifestText = await readFile(manifestPath, 'utf8').catch(() => '');
let manifest: EvaluationRunManifest;
if (existingManifestText) {
  manifest = EvaluationRunManifestSchema.parse(JSON.parse(existingManifestText));
  const stableExisting = { ...manifest, createdAt: expectedManifest.createdAt };
  if (JSON.stringify(stableExisting) !== JSON.stringify(expectedManifest)) {
    throw new Error('existing run manifest does not match this invocation');
  }
} else {
  manifest = expectedManifest;
  await writeFile(manifestPath, await formattedJson(manifest), { flag: 'wx' });
}

const retryFailures = process.argv.includes('--retry-failures');
const initialAttempts = await readAttempts(rawPath);
let remainingRetryBudget =
  config.failurePolicy.maxTotalRetryAttempts -
  initialAttempts.filter((attempt) => attempt.attempt > 1).length;
const key = systems.includes('LLM_VERIFIER') ? await apiKey() : undefined;
const llmConfig = LlmVerifierConfigSchema.parse({
  model: config.models.primary.id,
  promptVersion: LLM_VERIFIER_PROMPT_VERSION,
  temperature: config.models.primary.temperature,
  maxRetries: config.models.primary.maxRetries,
  timeoutMs: config.models.primary.timeoutMs,
  malformedPolicy: config.models.primary.malformedPolicy,
});
const jobs = systems.flatMap((system) =>
  matrix.entries.map((entry, index) => ({ system, entry, scenario: matrix.scenarios[index] })),
);
const expectedJobByKey = new Map(jobs.map((job) => [`${job.system}:${job.entry.caseId}`, job]));

function validateAttemptScope(attempts: readonly EvaluationAttempt[]): void {
  for (const attempt of attempts) {
    const record = attempt.result.record;
    const expected = expectedJobByKey.get(`${record.system}:${record.caseId}`);
    if (!expected?.scenario) {
      throw new Error(
        `attempt is outside the frozen system/case matrix: ${record.system}:${record.caseId}`,
      );
    }
    if (
      record.runId !== runId ||
      record.baseScenarioId !== expected.entry.baseScenarioId ||
      record.workflow !== expected.entry.workflow ||
      record.class !== expected.entry.class ||
      record.split !== expected.entry.split ||
      JSON.stringify(record.chainIds) !== JSON.stringify(expected.entry.chainIds) ||
      record.actionCount !== expected.scenario.trace.actions.length ||
      record.observationStage !== expected.entry.observationStage ||
      record.oracleEvidenceLevel !== expected.entry.oracleEvidenceLevel ||
      record.mutationValidity !== expected.entry.mutationValidity ||
      attempt.result.variant !== expected.entry.variant ||
      attempt.result.mutationOperator !== expected.entry.mutationOperator ||
      attempt.result.scenarioSha256 !== expected.entry.scenarioSha256
    ) {
      throw new Error(
        `attempt provenance differs from the frozen case: ${record.system}:${record.caseId}`,
      );
    }
  }
}

async function executePass(
  attemptsAtPassStart: readonly EvaluationAttempt[],
  mode: 'PRIMARY' | 'OPERATIONAL_RETRY',
): Promise<void> {
  validateAttemptScope(attemptsAtPassStart);
  const selectedAtPassStart = selectEvaluationAttempts(attemptsAtPassStart, {
    maxAttemptsPerCase: config.failurePolicy.maxAttemptsPerCase,
    maxTotalRetryAttempts: config.failurePolicy.maxTotalRetryAttempts,
  });
  const selectedByKey = new Map(
    selectedAtPassStart.map((attempt) => [
      `${attempt.result.record.system}:${attempt.result.record.caseId}`,
      attempt,
    ]),
  );
  const attemptsByKey = new Map<string, EvaluationAttempt[]>();
  for (const attempt of attemptsAtPassStart) {
    const attemptKey = `${attempt.result.record.system}:${attempt.result.record.caseId}`;
    const group = attemptsByKey.get(attemptKey) ?? [];
    group.push(attempt);
    attemptsByKey.set(attemptKey, group);
  }
  let writeQueue = Promise.resolve();
  await pool(jobs, concurrency, async ({ system, entry, scenario }) => {
    if (!scenario) throw new Error(`scenario missing for ${entry.caseId}`);
    const resultKey = `${system}:${entry.caseId}`;
    const primary = selectedByKey.get(resultKey);
    if (mode === 'PRIMARY' && primary) return;
    if (
      mode === 'OPERATIONAL_RETRY' &&
      (!primary || !isOperationalRetryEligible(primary.result.record.executionStatus))
    )
      return;
    if ((attemptsByKey.get(resultKey)?.length ?? 0) >= config.failurePolicy.maxAttemptsPerCase)
      return;
    const attemptNumber = nextAttemptNumber(attemptsAtPassStart, system, entry.caseId);
    if (mode === 'OPERATIONAL_RETRY') {
      if (attemptNumber <= 1)
        throw new Error(`retry pass is missing primary attempt: ${resultKey}`);
      if (remainingRetryBudget <= 0) return;
      remainingRetryBudget -= 1;
    } else if (attemptNumber !== 1) {
      throw new Error(`primary pass encountered invalid attempt number for ${resultKey}`);
    }
    const startedAt = new Date().toISOString();
    const result = await evaluateCase({
      runId,
      system,
      scenario,
      entry,
      evaluatedAt: config.caseMatrix.evaluatedAt,
      ...(system === 'LLM_VERIFIER'
        ? {
            llm: {
              config: llmConfig,
              createClient: () => {
                if (!key) throw new Error('OPENAI_API_KEY is not configured');
                return new OpenAiResponsesClient(key);
              },
              pricing: config.models.primary.pricingUsdPerMillionTokens,
            },
          }
        : {}),
    });
    const envelope = EvaluationAttemptSchema.parse({
      schemaVersion: '0.1',
      attempt: attemptNumber,
      startedAt,
      completedAt: new Date().toISOString(),
      result,
    });
    writeQueue = writeQueue.then(() =>
      appendFile(rawPath, `${JSON.stringify(envelope)}\n`, 'utf8'),
    );
    await writeQueue;
  });
}

await executePass(initialAttempts, 'PRIMARY');
if (retryFailures) {
  await executePass(await readAttempts(rawPath), 'OPERATIONAL_RETRY');
}

const allAttempts = await readAttempts(rawPath);
validateAttemptScope(allAttempts);
const selected = selectEvaluationAttempts(allAttempts, {
  maxAttemptsPerCase: config.failurePolicy.maxAttemptsPerCase,
  maxTotalRetryAttempts: config.failurePolicy.maxTotalRetryAttempts,
});
const records = selected.map((attempt) => attempt.result.record);
const expectedCount = 2_000;
if (records.length !== expectedCount) {
  throw new Error(`selected result count ${String(records.length)} != ${String(expectedCount)}`);
}
const attemptProvenance = summarizeEvaluationAttempts(allAttempts, {
  maxAttemptsPerCase: config.failurePolicy.maxAttemptsPerCase,
  maxTotalRetryAttempts: config.failurePolicy.maxTotalRetryAttempts,
});
const summary = {
  schemaVersion: '0.1',
  runId,
  selectedRecords: records.length,
  recordedAttempts: allAttempts.length,
  attemptProvenance,
  aggregates: aggregateEvaluationRecords(records),
};
await writeFile(resolve(runRoot, 'summary.json'), await formattedJson(summary), 'utf8');
await writeFile(resolve(runRoot, 'summary.csv'), `${evaluationRecordsCsv(records)}\n`, 'utf8');
console.log(
  JSON.stringify({
    runId,
    selectedRecords: records.length,
    attempts: allAttempts.length,
    selectedFailures: records.filter((record) => record.executionStatus === 'FAILED').length,
    rawFailureAttempts: attemptProvenance.failedAttempts,
    primaryAttemptFailures: attemptProvenance.primaryAttemptFailures,
    operationalRecoverySuccesses: attemptProvenance.operationalRecoverySuccesses,
  }),
);
