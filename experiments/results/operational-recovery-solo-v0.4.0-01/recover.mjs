/** Post-hoc availability recovery only: NEVER substitutes any primary attempt. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { LlmVerifierConfigSchema, LLM_VERIFIER_PROMPT_VERSION } from '../../../dist/src/baselines/llm-verifier.js';
import { OpenAiResponsesClient } from '../../../dist/src/baselines/openai-responses-client.js';
import { BenchmarkScenarioSchema } from '../../../dist/src/benchmark/scenario.js';
import { verifyCaseManifest } from '../../../dist/src/experiments/case-manifest.js';
import { createEvaluationCaseMatrix } from '../../../dist/src/experiments/case-matrix.js';
import { evaluateCase } from '../../../dist/src/experiments/evaluate-case.js';
import { computeFreezeDigests, differingFreezeDigests } from '../../../dist/src/experiments/freeze-digests.js';
import { ReadyFrozenEvalConfigSchema, tokenCostUsd } from '../../../dist/src/experiments/protocol.js';
import { EvaluationAttemptSchema } from '../../../dist/src/experiments/run-artifacts.js';

const runId = 'operational-recovery-solo-v0.4.0-01';
const root = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(root, '../../..');
process.chdir(repositoryRoot);
const primaryRoot = 'experiments/results/primary-solo-v0.4.0-01';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', ['--no-replace-objects', ...args], { encoding: 'utf8' }).trim();
const fail = (message) => { throw new Error(message); };
const key = process.env.OPENAI_API_KEY;
if (!key?.trim()) fail('OPENAI_API_KEY is not configured; no credential value was inspected or printed.');
const primaryPaths = ['manifest.json', 'raw.jsonl', 'summary.json', 'summary.csv'].map((name) => `${primaryRoot}/${name}`);
const primaryHashes = Object.fromEntries(await Promise.all(primaryPaths.map(async (path) => [path, sha(await readFile(path))])));
const primaryManifest = JSON.parse(await readFile(`${primaryRoot}/manifest.json`, 'utf8'));
const originalRows = (await readFile(`${primaryRoot}/raw.jsonl`, 'utf8')).trim().split(/\r?\n/u).map((line) => EvaluationAttemptSchema.parse(JSON.parse(line)));
if (originalRows.length !== 2092 || originalRows.filter((row) => row.attempt === 1).length !== 2000) fail('Unexpected original primary attempt coverage.');
const latest = new Map();
for (const row of originalRows) {
  const id = `${row.result.record.system}:${row.result.record.caseId}`;
  if (!latest.has(id) || latest.get(id).attempt < row.attempt) latest.set(id, row);
}
const targets = [...latest.values()].filter((row) => row.result.record.system === 'LLM_VERIFIER' && ['FAILED', 'TIMEOUT'].includes(row.result.record.executionStatus));
if (targets.length !== 47 || targets.some((row) => !row.result.verdict.rationale.includes('HTTP 429'))) fail('Recovery requires precisely the original 47 unresolved HTTP 429 cases.');
const configSource = await readFile(primaryManifest.configPath, 'utf8');
const config = ReadyFrozenEvalConfigSchema.parse(parse(configSource));
if (sha(configSource) !== primaryManifest.configSha256) fail('Frozen config byte digest differs.');
const ablationSource = await readFile('experiments/configs/ablations/manifest.json');
if (sha(ablationSource) !== primaryManifest.ablationConfigSha256) fail('Frozen ablation digest differs.');
const actualDigests = await computeFreezeDigests(config);
const differing = differingFreezeDigests(primaryManifest.freezeDigests, actualDigests);
if (differing.length) fail(`Frozen source/config digest changed: ${differing.join(', ')}`);
const executionCommit = git('rev-parse', 'HEAD');
git('merge-base', '--is-ancestor', primaryManifest.executionCommit, executionCommit);
const base = [];
for (const directory of (await readdir('benchmark/scenarios/base')).sort()) {
  const path = `benchmark/scenarios/base/${directory}`;
  if (!(await stat(path)).isDirectory()) continue;
  for (const name of (await readdir(path)).filter((name) => name.endsWith('.json')).sort()) {
    base.push(BenchmarkScenarioSchema.parse(JSON.parse(await readFile(`${path}/${name}`, 'utf8'))));
  }
}
const matrix = createEvaluationCaseMatrix(base);
const caseSource = await readFile(config.dataset.caseManifest, 'utf8');
if (sha(caseSource) !== primaryManifest.caseManifestSha256) fail('Frozen case-manifest byte digest differs.');
verifyCaseManifest(JSON.parse(caseSource), matrix);
if (matrix.caseCount !== 400) fail('Regenerated case matrix does not have 400 cases.');
const jobs = new Map(matrix.entries.map((entry, index) => [entry.caseId, { entry, scenario: matrix.scenarios[index] }]));
for (const prior of targets) {
  const job = jobs.get(prior.result.record.caseId);
  if (!job || job.entry.scenarioSha256 !== prior.result.scenarioSha256 || sha(JSON.stringify(job.scenario)) !== job.entry.scenarioSha256) fail('Recovery scenario differs from original frozen scenario.');
}
const llmConfig = LlmVerifierConfigSchema.parse({
  model: config.models.primary.id,
  promptVersion: LLM_VERIFIER_PROMPT_VERSION,
  temperature: config.models.primary.temperature,
  maxRetries: config.models.primary.maxRetries,
  timeoutMs: config.models.primary.timeoutMs,
  malformedPolicy: config.models.primary.malformedPolicy,
});
const distPaths = [];
async function collectDist(path) {
  for (const name of (await readdir(path)).sort()) {
    const child = `${path}/${name}`;
    if ((await stat(child)).isDirectory()) await collectDist(child);
    else if (name.endsWith('.js')) distPaths.push(child);
  }
}
await collectDist('dist/src');
const distHashes = Object.fromEntries(await Promise.all(distPaths.map(async (path) => [path, sha(await readFile(path))])));
const manifestPath = resolve(root, 'manifest.json');
const rawPath = resolve(root, 'raw.jsonl');
const summaryPath = resolve(root, 'summary.json');
const manifest = {
  schemaVersion: '0.1', runId,
  studyType: 'POST_HOC_OPERATIONAL_RECOVERY',
  excludedFromPrimaryResults: true, excludedFromCausalResults: true,
  latencyBenchmarkEligible: false,
  latencyCaveat: 'Other local analyses run concurrently; these timings are operational diagnostics only.',
  createdAt: new Date().toISOString(), executionCommit,
  frozenCandidateCommit: primaryManifest.gitCommit,
  frozenExecutionCommit: primaryManifest.executionCommit,
  originalPrimaryRunId: primaryManifest.runId,
  originalPrimaryArtifactHashes: primaryHashes,
  configSha256: sha(configSource), caseManifestSha256: sha(caseSource),
  freezeDigests: actualDigests, runnerSha256: sha(await readFile(fileURLToPath(import.meta.url))),
  runtimeDistSourceHashes: distHashes,
  policy: { concurrency: 1, minimumPauseAfterEvaluationMs: 4000, maximumAdditionalEvaluationsPerCase: 2,
    maximumHttpAttemptsPerEvaluation: llmConfig.maxRetries + 1,
    observedRetryAfterAndRateResetHeadersAppliedBetweenEvaluations: true, maximumSleepChunkMs: 60000,
    failedAttemptsPreserved: true, originalArtifactsUntouched: true,
    frozenInternalRetryPolicyUnchanged: true, decisionPolicyUnchanged: true,
    insufficientQuotaOrAuthenticationFailureStopsNewCalls: true },
  llmConfig, pricingUsdPerMillionTokens: config.models.primary.pricingUsdPerMillionTokens,
  targets: targets.map((prior) => ({ caseId: prior.result.record.caseId, scenarioSha256: prior.result.scenarioSha256,
    originalLatestAttempt: prior.attempt, originalLatestExecutionStatus: prior.result.record.executionStatus })),
};
const existingManifest = await readFile(manifestPath, 'utf8').catch((error) => error.code === 'ENOENT' ? '' : Promise.reject(error));
if (existingManifest) {
  const priorManifest = JSON.parse(existingManifest);
  if (JSON.stringify({ ...priorManifest, createdAt: manifest.createdAt, executionCommit: manifest.executionCommit }) !== JSON.stringify(manifest)) fail('Recovery resume manifest differs.');
} else await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
const existingSummary = await readFile(summaryPath, 'utf8').catch((error) => error.code === 'ENOENT' ? '' : Promise.reject(error));
if (existingSummary) { console.log(existingSummary); process.exit(0); }
const rowsText = await readFile(rawPath, 'utf8').catch((error) => error.code === 'ENOENT' ? '' : Promise.reject(error));
const rows = rowsText.trim() ? rowsText.trim().split(/\r?\n/u).map(JSON.parse) : [];
const targetIds = new Set(targets.map((prior) => prior.result.record.caseId));
for (const row of rows) if (!targetIds.has(row.caseId) || row.studyType !== manifest.studyType || row.additionalEvaluation < 1 || row.additionalEvaluation > 2) fail('Unexpected resumed recovery record.');
const safeCode = (value) => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,80}$/u.test(value) ? value : null;
const headerNames = ['retry-after', 'retry-after-ms', 'x-ratelimit-limit-requests', 'x-ratelimit-limit-tokens', 'x-ratelimit-remaining-requests', 'x-ratelimit-remaining-tokens', 'x-ratelimit-reset-requests', 'x-ratelimit-reset-tokens'];
const safeHeader = (value) => value && /^[A-Za-z0-9.,: +\-]{1,120}$/u.test(value) ? value : null;
function durationMs(value) {
  if (!value) return 0;
  const matches = [...value.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h|d)/gu)];
  if (!matches.length || matches.map((match) => match[0]).join('') !== value) return 0;
  const units = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return matches.reduce((sum, match) => sum + Number(match[1]) * units[match[2]], 0);
}
function retryMs(headers) {
  const parsedMs = Number(headers['retry-after-ms'] ?? 0);
  const explicitMs = Number.isFinite(parsedMs) && parsedMs > 0 ? parsedMs : 0;
  const value = headers['retry-after'];
  const explicitSeconds = value && /^\d+(?:\.\d+)?$/u.test(value) ? Number(value) * 1000 : 0;
  const explicitDate = value && !explicitSeconds ? Math.max(0, Date.parse(value) - Date.now()) || 0 : 0;
  return Math.max(explicitMs, explicitSeconds, explicitDate,
    durationMs(headers['x-ratelimit-reset-requests']), durationMs(headers['x-ratelimit-reset-tokens']), 4000);
}
async function pacedWait(milliseconds, reason) {
  const until = Date.now() + milliseconds;
  while (Date.now() < until) {
    const remaining = until - Date.now();
    if (remaining > 5000) console.log(JSON.stringify({ status: 'WAITING', reason, remainingMs: Math.ceil(remaining) }));
    await new Promise((resolveWait) => setTimeout(resolveWait, Math.min(60000, remaining)));
  }
}
let nextCallAt = Date.now() + 4000;
let stopReason = null;
console.log(JSON.stringify({ status: 'VALIDATED', targetCases: targets.length, primaryRawSha256: primaryHashes[`${primaryRoot}/raw.jsonl`], runnerSha256: manifest.runnerSha256, primaryExcluded: true }));
for (let pass = 1; pass <= 2 && !stopReason; pass += 1) {
  for (const prior of targets) {
    const caseId = prior.result.record.caseId;
    const previous = rows.filter((row) => row.caseId === caseId);
    if (previous.some((row) => !['FAILED', 'TIMEOUT'].includes(row.result.record.executionStatus)) || previous.length >= pass) continue;
    await pacedWait(Math.max(0, nextCallAt - Date.now()), 'post-hoc single-flight pacing / observed rate-limit reset');
    const diagnostics = [];
    const observedUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let unknownUsageResponses = 0;
    const startedAt = new Date().toISOString();
    const fetchWithSafeDiagnostics = async (input, init) => {
      if (stopReason) throw new Error('Further live calls stopped after a quota or access error.');
      const requestStartedAt = new Date().toISOString();
      try {
        const response = await globalThis.fetch(input, init);
        const headers = Object.fromEntries(headerNames.map((name) => [name, safeHeader(response.headers.get(name))]).filter(([, value]) => value !== null));
        const body = await response.clone().json().catch(() => null);
        const usage = body?.usage;
        const numericUsage = usage && ['input_tokens', 'output_tokens', 'total_tokens'].every((name) => Number.isSafeInteger(usage[name]) && usage[name] >= 0);
        if (numericUsage) {
          observedUsage.inputTokens += usage.input_tokens;
          observedUsage.cachedInputTokens += Number.isSafeInteger(usage.input_tokens_details?.cached_tokens) ? usage.input_tokens_details.cached_tokens : 0;
          observedUsage.outputTokens += usage.output_tokens;
          observedUsage.totalTokens += usage.total_tokens;
        } else unknownUsageResponses += 1;
        const errorCode = safeCode(body?.error?.code);
        diagnostics.push({ requestStartedAt, responseAt: new Date().toISOString(), httpStatus: response.status,
          errorCode, errorType: safeCode(body?.error?.type), rateHeaders: headers,
          tokenUsageAvailable: Boolean(numericUsage) });
        if (response.status === 429) nextCallAt = Math.max(nextCallAt, Date.now() + retryMs(headers));
        if (errorCode === 'insufficient_quota' || [401, 403].includes(response.status)) stopReason = errorCode ?? `HTTP_${response.status}`;
        return response;
      } catch (error) {
        diagnostics.push({ requestStartedAt, responseAt: new Date().toISOString(), transportErrorName: safeCode(error?.name), tokenUsageAvailable: false });
        unknownUsageResponses += 1;
        throw error;
      }
    };
    const { entry, scenario } = jobs.get(caseId);
    const result = await evaluateCase({ runId, system: 'LLM_VERIFIER', scenario, entry,
      evaluatedAt: config.caseMatrix.evaluatedAt,
      llm: { config: llmConfig, createClient: () => new OpenAiResponsesClient(key, { fetch: fetchWithSafeDiagnostics }),
        pricing: config.models.primary.pricingUsdPerMillionTokens } });
    const row = { schemaVersion: '0.1', studyType: manifest.studyType, runId, caseId,
      additionalEvaluation: previous.length + 1, originalLatestAttempt: prior.attempt,
      excludedFromPrimaryResults: true, latencyBenchmarkEligible: false,
      startedAt, completedAt: new Date().toISOString(), diagnostics, observedUsage, unknownUsageResponses,
      observedUsageCostUsd: tokenCostUsd(observedUsage, config.models.primary.pricingUsdPerMillionTokens), result };
    await appendFile(rawPath, `${JSON.stringify(row)}\n`, 'utf8');
    rows.push(row);
    nextCallAt = Math.max(nextCallAt, Date.now() + 4000);
    const recovered = new Set(rows.filter((row) => !['FAILED', 'TIMEOUT'].includes(row.result.record.executionStatus)).map((row) => row.caseId));
    console.log(JSON.stringify({ status: 'RECORDED', caseId, additionalEvaluation: row.additionalEvaluation,
      executionStatus: result.record.executionStatus, httpStatuses: diagnostics.map((item) => item.httpStatus ?? item.transportErrorName),
      safeErrorCodes: diagnostics.map((item) => item.errorCode).filter(Boolean), recordedEvaluations: rows.length, recoveredCases: recovered.size, remainingCases: 47 - recovered.size }));
    if (stopReason) break;
  }
}
const originalArtifactsUnchanged = (await Promise.all(primaryPaths.map(async (path) => sha(await readFile(path)) === primaryHashes[path]))).every(Boolean);
if (!originalArtifactsUnchanged) fail('Original primary artifacts changed during recovery; investigate before publishing.');
const recoveredIds = new Set(rows.filter((row) => !['FAILED', 'TIMEOUT'].includes(row.result.record.executionStatus)).map((row) => row.caseId));
const usage = rows.reduce((sum, row) => Object.fromEntries(Object.keys(sum).map((key) => [key, sum[key] + row.observedUsage[key]])), { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 });
const summary = { schemaVersion: '0.1', runId, studyType: manifest.studyType,
  completedAt: new Date().toISOString(), stopReason: stopReason ?? (recoveredIds.size === 47 ? 'ALL_TARGETS_RECOVERED' : 'ADDITIONAL_EVALUATION_BUDGET_EXHAUSTED'),
  targetCases: 47, recoveredCases: recoveredIds.size, unresolvedCases: 47 - recoveredIds.size,
  additionalEvaluations: rows.length, additionalHttpAttempts: rows.reduce((sum, row) => sum + row.diagnostics.length, 0),
  failedAdditionalEvaluations: rows.filter((row) => ['FAILED', 'TIMEOUT'].includes(row.result.record.executionStatus)).length,
  preservedFailureHttpResponses: rows.reduce((sum, row) => sum + row.diagnostics.filter((item) => item.httpStatus >= 400 || item.transportErrorName).length, 0),
  observedUsage: usage, observedUsageCostUsd: tokenCostUsd(usage, config.models.primary.pricingUsdPerMillionTokens),
  responsesWithoutReportedUsage: rows.reduce((sum, row) => sum + row.unknownUsageResponses, 0),
  tokenCostCaveat: 'Cost is computed only from reported response usage at the frozen price schedule; absent usage is unknown, not proof of zero billed cost.',
  excludedFromPrimaryResults: true, excludedFromCausalResults: true, latencyBenchmarkEligible: false,
  originalArtifactsUnchanged, originalPrimaryArtifactHashes: primaryHashes,
  manifestSha256: sha(await readFile(manifestPath)), rawSha256: sha(await readFile(rawPath)),
  recoveredCaseIds: [...recoveredIds].sort(), unresolvedCaseIds: targets.map((row) => row.result.record.caseId).filter((id) => !recoveredIds.has(id)).sort() };
await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify(summary));
