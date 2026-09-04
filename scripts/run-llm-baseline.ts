import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { format, resolveConfig } from 'prettier';

import { BenchmarkScenarioSchema, type BenchmarkScenario } from '../src/benchmark/scenario.js';
import { BENCHMARK_DATASET_VERSION } from '../src/benchmark/version.js';
import { scoreDecision } from '../src/benchmark/scoring.js';
import {
  buildLlmBaselineInputBinding,
  LLM_BASELINE_CONFIG_PATH,
  LLM_BASELINE_PROTOCOL_PATH,
  LLM_BASELINE_RESULT_PATH,
  LLM_BASELINE_REVIEW_PACKET_PATH,
  LLM_BASELINE_SEED,
  LLM_RATIONALE_REVIEW_TEMPLATE_PATH,
} from '../src/baselines/llm-baseline-input.js';
import { evaluateLlmVerifier, LlmVerifierConfigSchema } from '../src/baselines/llm-verifier.js';
import { OpenAiResponsesClient } from '../src/baselines/openai-responses-client.js';
import {
  assertCleanSourceAtStart,
  assertCleanSourceUnchanged,
  readGitSourceState,
} from './source-integrity.js';

function envValue(contents: string, name: string): string | undefined {
  const prefix = `${name}=`;
  const line = contents
    .split(/\r?\n/)
    .find((candidate) => candidate.trimStart().startsWith(prefix));
  if (!line) return undefined;
  const value = line.trim().slice(prefix.length).trim();
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
  const contents = await readFile(resolve('.env.local'), 'utf8').catch(() => '');
  const fromFile = envValue(contents, 'OPENAI_API_KEY');
  if (!fromFile?.trim()) throw new Error('OPENAI_API_KEY is not configured');
  return fromFile;
}

function scenarioPath(id: string): string {
  const directory =
    id.startsWith('TR-') || id.startsWith('AP-')
      ? 'transfer'
      : id.startsWith('BR-')
        ? 'bridge'
        : 'swap';
  return resolve('benchmark/scenarios/base', directory, `${id.toLowerCase()}.json`);
}

async function loadScenario(id: string): Promise<BenchmarkScenario> {
  return BenchmarkScenarioSchema.parse(JSON.parse(await readFile(scenarioPath(id), 'utf8')));
}

async function formattedJson(value: unknown): Promise<string> {
  const prettierConfig = (await resolveConfig(resolve('package.json'))) ?? {};
  return format(JSON.stringify(value), { ...prettierConfig, parser: 'json' });
}

async function main(): Promise<void> {
  const configSource = await readFile(resolve(LLM_BASELINE_CONFIG_PATH), 'utf8');
  const config = LlmVerifierConfigSchema.parse(JSON.parse(configSource));
  const protocol = JSON.parse(
    await readFile(resolve(LLM_BASELINE_PROTOCOL_PATH), 'utf8'),
  ) as unknown;
  const inputBinding = await buildLlmBaselineInputBinding(config, protocol, loadScenario);
  const { sample, expectedCases, inputSha256 } = inputBinding;
  const requireCleanSource = process.argv.includes('--require-clean-source');
  const sourceAtStart = readGitSourceState();
  if (requireCleanSource) assertCleanSourceAtStart(sourceAtStart, 'live LLM baseline');
  const codeCommit = sourceAtStart.commitSha;
  const workingTreeDirty = sourceAtStart.workingTreeDirty;
  const client = new OpenAiResponsesClient(await apiKey());
  const startedAt = new Date().toISOString();
  const outputs = [];
  for (let offset = 0; offset < sample.length; offset += 4) {
    const batch = sample.slice(offset, offset + 4);
    const results = await Promise.all(
      batch.map(async (scenario, batchIndex) => {
        const verdict = await evaluateLlmVerifier(scenario, config, client);
        const score = scoreDecision(scenario, verdict.decision, 'PRE_SIGN');
        const reviewIndex = offset + batchIndex + 1;
        console.log(`completed R${String(reviewIndex).padStart(2, '0')}: ${verdict.decision}`);
        return {
          reviewId: `R${String(reviewIndex).padStart(2, '0')}`,
          scenarioId: scenario.id,
          split: scenario.split,
          class: scenario.class,
          oracle: { expectedDecision: score.expectedDecision, labels: scenario.oracle.labels },
          verdict,
          ...score,
        };
      }),
    );
    outputs.push(...results);
  }
  if (requireCleanSource)
    assertCleanSourceUnchanged(sourceAtStart, readGitSourceState(), 'live LLM baseline');
  const result = {
    schemaVersion: '0.1',
    datasetVersion: BENCHMARK_DATASET_VERSION,
    codeCommit,
    workingTreeDirty,
    inputSha256,
    evaluationStage: 'PRE_SIGN',
    seed: LLM_BASELINE_SEED,
    startedAt,
    completedAt: new Date().toISOString(),
    config,
    sampleSize: outputs.length,
    eligibleCount: outputs.filter((output) => output.eligible).length,
    exactMatches: outputs.filter((output) => output.exactMatch).length,
    outputs,
    reviewerStatus: 'PENDING_INDEPENDENT_REVIEW',
  };
  const reviewPacket = {
    protocolVersion: '0.1',
    status: 'PENDING_INDEPENDENT_REVIEW',
    datasetVersion: BENCHMARK_DATASET_VERSION,
    codeCommit,
    workingTreeDirty,
    inputSha256,
    seed: LLM_BASELINE_SEED,
    config,
    instructions:
      'Review each model decision and rationale against its oracle-free input. Record modelDecision exactly as shown, then independently record rationaleSupported, oracleLeakage, correctedDecision, and notes. correctedDecision may differ from modelDecision.',
    cases: outputs.map((output, index) => {
      const expected = expectedCases[index];
      if (!expected) throw new Error(`review scenario ${String(index)} is missing`);
      return {
        reviewId: output.reviewId,
        input: expected.input,
        output: {
          decision: output.verdict.decision,
          rationale: output.verdict.rationale,
          violatedFields: output.verdict.reasonCodes,
          attempts: output.verdict.attempts,
          rawOutput: output.verdict.rawOutput,
        },
      };
    }),
  };
  const outputArgument = process.argv.find((argument) => argument.startsWith('--output='));
  const path = resolve(outputArgument?.slice('--output='.length) ?? LLM_BASELINE_RESULT_PATH);
  const resultSource = await formattedJson(result);
  const reviewPacketSource = await formattedJson(reviewPacket);
  const sha256 = (source: string): string => createHash('sha256').update(source).digest('hex');
  const rationaleTemplate = {
    protocolVersion: '0.1',
    datasetVersion: BENCHMARK_DATASET_VERSION,
    status: 'PENDING',
    reviewerPseudonym: null,
    reviewerType: 'HUMAN',
    independenceAttestation: null,
    reviewedAt: null,
    reviewedCommit: codeCommit,
    inputSha256,
    configSha256: sha256(configSource),
    resultSha256: sha256(resultSource),
    reviewPacketSha256: sha256(reviewPacketSource),
    instructions:
      'A human reviewer must complete every case independently. Copy modelDecision unchanged, choose correctedDecision independently, complete the rationale and leakage checks, add notes, then provide the reviewer pseudonym, timestamp, and true independence attestation.',
    cases: outputs.map((output) => ({
      reviewId: output.reviewId,
      modelDecision: output.verdict.decision,
      rationaleSupported: null,
      oracleLeakage: null,
      correctedDecision: null,
      notes: null,
    })),
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, resultSource, 'utf8');
  await writeFile(resolve(LLM_BASELINE_REVIEW_PACKET_PATH), reviewPacketSource, 'utf8');
  await writeFile(
    resolve(LLM_RATIONALE_REVIEW_TEMPLATE_PATH),
    await formattedJson(rationaleTemplate),
    'utf8',
  );
  console.log(`saved ${String(outputs.length)} redacted baseline records to ${path}`);
}

await main();
