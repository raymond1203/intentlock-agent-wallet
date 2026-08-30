import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { format, resolveConfig } from 'prettier';
import { z } from 'zod';

import { applyMutation, type MutationOperatorId } from '../src/benchmark/mutations/index.js';
import { BenchmarkScenarioSchema, type BenchmarkScenario } from '../src/benchmark/scenario.js';
import { evaluateLlmVerifier, LlmVerifierConfigSchema } from '../src/baselines/llm-verifier.js';
import { OpenAiResponsesClient } from '../src/baselines/openai-responses-client.js';

const ReviewProtocolSchema = z
  .object({
    protocolVersion: z.literal('0.1'),
    selection: z
      .object({
        base: z.array(z.string()).length(10),
        mutations: z.array(z.string()).length(10),
      })
      .loose(),
  })
  .loose();

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
  const directory = id.startsWith('TR-') || id.startsWith('AP-') ? 'transfer' : 'swap';
  return resolve('benchmark/scenarios/base', directory, `${id.toLowerCase()}.json`);
}

async function loadScenario(id: string): Promise<BenchmarkScenario> {
  return BenchmarkScenarioSchema.parse(JSON.parse(await readFile(scenarioPath(id), 'utf8')));
}

const mutationBaseIds: Record<MutationOperatorId, string> = {
  'recipient-substitution': 'TR-01',
  'token-substitution': 'TR-01',
  'chain-substitution': 'TR-01',
  'amount-inflation': 'TR-01',
  'slippage-widening': 'SS-01',
  'gas-inflation': 'TR-01',
  'deadline-extension': 'AP-03',
  'unlimited-approval': 'AP-01',
  'hidden-batch': 'BS-01',
  'stale-quote': 'SS-01',
  'retry-double-spend': 'TR-01',
  'concurrency-race': 'TR-01',
  'policy-laundering': 'TR-01',
  'benign-hallucination': 'TR-01',
};

function gitCommit(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

async function formattedJson(value: unknown): Promise<string> {
  const prettierConfig = (await resolveConfig(resolve('package.json'))) ?? {};
  return format(JSON.stringify(value), { ...prettierConfig, parser: 'json' });
}

async function main(): Promise<void> {
  const config = LlmVerifierConfigSchema.parse(
    JSON.parse(await readFile(resolve('experiments/configs/baselines/llm-verifier.json'), 'utf8')),
  );
  const protocol = ReviewProtocolSchema.parse(
    JSON.parse(await readFile(resolve('experiments/configs/baselines/reviewer-20.json'), 'utf8')),
  );
  const baseScenarios = await Promise.all(protocol.selection.base.map(loadScenario));
  const mutationScenarios = await Promise.all(
    protocol.selection.mutations.map(async (operatorValue) => {
      const operator = operatorValue as MutationOperatorId;
      const baseId = mutationBaseIds[operator];
      if (!baseId) throw new Error(`unsupported review mutation: ${operatorValue}`);
      return applyMutation(await loadScenario(baseId), operator, 2026);
    }),
  );
  const sample = [...baseScenarios, ...mutationScenarios];
  const client = new OpenAiResponsesClient(await apiKey());
  const startedAt = new Date().toISOString();
  const outputs = [];
  for (let offset = 0; offset < sample.length; offset += 4) {
    const batch = sample.slice(offset, offset + 4);
    const results = await Promise.all(
      batch.map(async (scenario, batchIndex) => {
        const verdict = await evaluateLlmVerifier(scenario, config, client);
        const expectedDecision =
          scenario.oracle.expectedDecision === 'ESCALATE'
            ? 'ABSTAIN'
            : scenario.oracle.expectedDecision;
        const reviewIndex = offset + batchIndex + 1;
        console.log(`completed R${String(reviewIndex).padStart(2, '0')}: ${verdict.decision}`);
        return {
          reviewId: `R${String(reviewIndex).padStart(2, '0')}`,
          scenarioId: scenario.id,
          split: scenario.split,
          class: scenario.class,
          oracle: { expectedDecision, labels: scenario.oracle.labels },
          verdict,
          exactMatch: verdict.decision === expectedDecision,
        };
      }),
    );
    outputs.push(...results);
  }
  const result = {
    schemaVersion: '0.1',
    datasetVersion: '0.1.0',
    codeCommit: gitCommit(),
    seed: 2026,
    startedAt,
    completedAt: new Date().toISOString(),
    config,
    sampleSize: outputs.length,
    exactMatches: outputs.filter((output) => output.exactMatch).length,
    outputs,
    reviewerStatus: 'PENDING_INDEPENDENT_REVIEW',
  };
  const outputArgument = process.argv.find((argument) => argument.startsWith('--output='));
  const path = resolve(
    outputArgument?.slice('--output='.length) ??
      'experiments/results/baselines/llm-verifier-20.json',
  );
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, await formattedJson(result), 'utf8');
  console.log(`saved ${String(outputs.length)} redacted baseline records to ${path}`);
}

await main();
