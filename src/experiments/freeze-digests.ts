import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';

import { z } from 'zod';

import {
  LlmStructuredVerdictSchema,
  LLM_VERIFIER_PROMPT_VERSION,
  LLM_VERIFIER_SYSTEM_PROMPT,
} from '../baselines/llm-verifier.js';
import { BenchmarkScenarioSchema } from '../benchmark/scenario.js';
import type { FrozenEvalConfig } from './protocol.js';

export interface FreezeDigests {
  dependencyDigestSha256: string;
  datasetDigestSha256: string;
  caseManifestDigestSha256: string;
  promptDigestSha256: string;
  toolSchemaDigestSha256: string;
  metricImplementationDigestSha256: string;
  protocolConfigDigestSha256: string;
  evaluationConfigDigestSha256: string;
  implementationDigestSha256: string;
}

export const FreezeDigestsSchema = z
  .object({
    dependencyDigestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    datasetDigestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    caseManifestDigestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    promptDigestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    toolSchemaDigestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    metricImplementationDigestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    protocolConfigDigestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    evaluationConfigDigestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    implementationDigestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

async function filesBelow(path: string): Promise<string[]> {
  const metadata = await stat(path);
  if (metadata.isFile()) return [path.replaceAll('\\', '/')];
  const children = await readdir(path);
  const nested = await Promise.all(children.map((child) => filesBelow(`${path}/${child}`)));
  return nested.flat().sort();
}

async function digestFiles(paths: readonly string[]): Promise<string> {
  const expanded = (await Promise.all(paths.map((path) => filesBelow(path)))).flat().sort();
  const digest = createHash('sha256');
  for (const path of expanded) {
    const contents = await readFile(path);
    digest.update(path);
    digest.update('\0');
    digest.update(contents);
    digest.update('\0');
  }
  return digest.digest('hex');
}

function digestJson(value: unknown): string {
  const canonicalize = (candidate: unknown): string => {
    if (candidate === null || typeof candidate !== 'object') return JSON.stringify(candidate);
    if (Array.isArray(candidate)) return `[${candidate.map(canonicalize).join(',')}]`;
    const record = candidate as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
      .join(',')}}`;
  };
  return createHash('sha256').update(canonicalize(value)).digest('hex');
}

/** Hashes ablation semantics without its mutable A -> B freeze envelope. */
export function ablationConfigDigest(value: unknown): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('ablation manifest must be an object');
  }
  const { freeze: _freeze, status: _status, ...semantic } = value as Record<string, unknown>;
  void _freeze;
  void _status;
  return digestJson(semantic);
}

async function evaluationConfigDigest(config: FrozenEvalConfig): Promise<string> {
  const ablationManifest: unknown = JSON.parse(
    await readFile('experiments/configs/ablations/manifest.json', 'utf8'),
  );
  const [baselines, adaptive, forks, m2Validation, reviewTemplate] = await Promise.all([
    digestFiles(['experiments/configs/baselines']),
    digestFiles(['experiments/configs/adaptive-selection-v0.1.json']),
    digestFiles(['experiments/configs/forks']),
    digestFiles([config.dataset.m2Validation]),
    digestFiles(['experiments/configs/freeze-review.template.json']),
  ]);
  return digestJson({
    baselines,
    ablationSemantics: ablationConfigDigest(ablationManifest),
    adaptive,
    forks,
    m2Validation,
    reviewTemplate,
  });
}

/** Hashes protocol semantics without the mutable candidate/freeze envelope. */
export function protocolConfigDigest(config: FrozenEvalConfig): string {
  const { freeze: _freeze, status: _status, ...protocol } = config;
  void _freeze;
  void _status;
  return digestJson(protocol);
}

export async function computeFreezeDigests(config: FrozenEvalConfig): Promise<FreezeDigests> {
  const [
    dependencyDigestSha256,
    datasetDigestSha256,
    caseManifestDigestSha256,
    metricDigest,
    evaluationConfigDigestSha256,
    implementationDigestSha256,
  ] = await Promise.all([
    digestFiles(['package.json', 'pnpm-lock.yaml']),
    digestFiles([
      'benchmark/scenarios/base',
      'benchmark/fixtures/manifest.json',
      'benchmark/fixtures/swap-quotes-v0.3.json',
      config.dataset.baseManifest,
    ]),
    digestFiles([config.dataset.caseManifest]),
    digestFiles([
      'src/experiments/metrics.ts',
      'src/experiments/bootstrap.ts',
      'src/experiments/evaluate-case.ts',
    ]),
    evaluationConfigDigest(config),
    digestFiles(['src', 'scripts']),
  ]);
  const promptDigestSha256 = digestJson({
    version: LLM_VERIFIER_PROMPT_VERSION,
    system: LLM_VERIFIER_SYSTEM_PROMPT,
    responseSchema: z.toJSONSchema(LlmStructuredVerdictSchema, {
      target: 'draft-2020-12',
      unrepresentable: 'throw',
    }),
    model: config.models.primary,
  });
  const toolSchemaDigestSha256 = digestJson(
    z.toJSONSchema(BenchmarkScenarioSchema, {
      target: 'draft-2020-12',
      unrepresentable: 'throw',
    }),
  );
  return {
    dependencyDigestSha256,
    datasetDigestSha256,
    caseManifestDigestSha256,
    promptDigestSha256,
    toolSchemaDigestSha256,
    metricImplementationDigestSha256: metricDigest,
    protocolConfigDigestSha256: protocolConfigDigest(config),
    evaluationConfigDigestSha256,
    implementationDigestSha256,
  };
}

export function freezeDigestsFromConfig(config: FrozenEvalConfig): FreezeDigests | null {
  const candidate = {
    dependencyDigestSha256: config.freeze.dependencyDigestSha256,
    datasetDigestSha256: config.freeze.datasetDigestSha256,
    caseManifestDigestSha256: config.freeze.caseManifestDigestSha256,
    promptDigestSha256: config.freeze.promptDigestSha256,
    toolSchemaDigestSha256: config.freeze.toolSchemaDigestSha256,
    metricImplementationDigestSha256: config.freeze.metricImplementationDigestSha256,
    protocolConfigDigestSha256: config.freeze.protocolConfigDigestSha256,
    evaluationConfigDigestSha256: config.freeze.evaluationConfigDigestSha256,
    implementationDigestSha256: config.freeze.implementationDigestSha256,
  };
  const parsed = FreezeDigestsSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export function differingFreezeDigests(
  expected: FreezeDigests,
  actual: FreezeDigests,
): Array<keyof FreezeDigests> {
  return (Object.keys(expected) as Array<keyof FreezeDigests>).filter(
    (key) => expected[key] !== actual[key],
  );
}
