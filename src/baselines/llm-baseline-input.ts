import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  applyMutation,
  MUTATION_OPERATOR_IDS,
  type MutationOperatorId,
} from '../benchmark/mutations/index.js';
import { BenchmarkScenarioSchema, type BenchmarkScenario } from '../benchmark/scenario.js';
import { scoreDecision } from '../benchmark/scoring.js';
import { BENCHMARK_DATASET_VERSION } from '../benchmark/version.js';
import {
  createLlmVerifierUserPrompt,
  LlmVerifierConfigSchema,
  LLM_VERIFIER_SYSTEM_PROMPT,
} from './llm-verifier.js';

export const LLM_BASELINE_SEED = 2026 as const;
export const LLM_BASELINE_CONFIG_PATH = 'experiments/configs/baselines/llm-verifier.json';
export const LLM_BASELINE_PROTOCOL_PATH =
  `experiments/configs/baselines/reviewer-20-v${BENCHMARK_DATASET_VERSION}.json` as const;
export const LLM_BASELINE_RESULT_PATH =
  `benchmark/evidence/llm-verifier-20-v${BENCHMARK_DATASET_VERSION}.json` as const;
export const LLM_BASELINE_REVIEW_PACKET_PATH =
  `experiments/configs/baselines/llm-verifier-20-review-v${BENCHMARK_DATASET_VERSION}.json` as const;
export const LLM_RATIONALE_REVIEW_PATH =
  `experiments/configs/baselines/llm-verifier-20-rationale-review-v${BENCHMARK_DATASET_VERSION}.json` as const;
export const LLM_RATIONALE_REVIEW_TEMPLATE_PATH =
  `experiments/configs/baselines/llm-verifier-20-rationale-review-v${BENCHMARK_DATASET_VERSION}.template.json` as const;

export const LlmBaselineProtocolSchema = z
  .object({
    protocolVersion: z.literal('0.1'),
    datasetVersion: z.literal(BENCHMARK_DATASET_VERSION),
    status: z.literal('PENDING_MODEL_RUN'),
    reviewPacket: z.literal(LLM_BASELINE_REVIEW_PACKET_PATH),
    selection: z
      .object({
        base: z
          .array(z.string().min(1))
          .length(10)
          .refine((ids) => new Set(ids).size === ids.length, 'base selections must be unique'),
        mutations: z
          .array(z.enum(MUTATION_OPERATOR_IDS))
          .length(10)
          .refine(
            (operators) => new Set(operators).size === operators.length,
            'mutation selections must be unique',
          ),
      })
      .strict(),
    reviewFields: z.tuple([
      z.literal('modelDecision'),
      z.literal('rationaleSupported'),
      z.literal('oracleLeakage'),
      z.literal('correctedDecision'),
      z.literal('notes'),
    ]),
    reviewer: z.null(),
    reviewedAt: z.null(),
  })
  .strict();

export type LlmBaselineProtocol = z.infer<typeof LlmBaselineProtocolSchema>;

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
  'partial-completion': 'BR-01',
  'retry-double-spend': 'TR-01',
  'concurrency-race': 'TR-01',
  'policy-laundering': 'TR-01',
  'benign-hallucination': 'TR-01',
};

export interface LlmBaselineExpectedCase {
  reviewId: string;
  scenarioId: string;
  split: BenchmarkScenario['split'];
  class: BenchmarkScenario['class'];
  eligible: true;
  expectedDecision: 'ALLOW' | 'DENY' | 'ABSTAIN';
  input: unknown;
}

export interface LlmBaselineInputBinding {
  sample: BenchmarkScenario[];
  expectedCases: LlmBaselineExpectedCase[];
  promptInputs: unknown[];
  promptStrings: string[];
  inputSha256: string;
}

/**
 * Constructs the preregistered LLM sample and its public, oracle-free inputs. Both the live runner
 * and the M2 validator call this function so a result cannot remain valid after the dataset,
 * selection, prompt, or verifier configuration changes.
 */
export async function buildLlmBaselineInputBinding(
  configInput: unknown,
  protocolInput: unknown,
  loadScenario: (id: string) => Promise<BenchmarkScenario>,
): Promise<LlmBaselineInputBinding> {
  const config = LlmVerifierConfigSchema.parse(configInput);
  const protocol = LlmBaselineProtocolSchema.parse(protocolInput);
  const cache = new Map<string, BenchmarkScenario>();
  const loadBase = async (id: string): Promise<BenchmarkScenario> => {
    const cached = cache.get(id);
    if (cached) return cached;
    const scenario = BenchmarkScenarioSchema.parse(await loadScenario(id));
    if (scenario.id !== id) throw new Error(`loaded scenario ${scenario.id} does not match ${id}`);
    if (scenario.class !== 'BASE') throw new Error(`LLM sample source must be BASE: ${id}`);
    cache.set(id, scenario);
    return scenario;
  };
  const baseScenarios = await Promise.all(protocol.selection.base.map(loadBase));
  const mutationScenarios = await Promise.all(
    protocol.selection.mutations.map(async (operator) =>
      applyMutation(await loadBase(mutationBaseIds[operator]), operator, LLM_BASELINE_SEED),
    ),
  );
  const sample = [...baseScenarios, ...mutationScenarios];
  if (sample.some((scenario) => scenario.split === 'HIDDEN_TEST')) {
    throw new Error('Development validation cannot use held-out scenarios');
  }
  if (new Set(sample.map((scenario) => scenario.id)).size !== sample.length) {
    throw new Error('LLM sample scenario IDs must be unique');
  }
  const promptStrings = sample.map(createLlmVerifierUserPrompt);
  const promptInputs = promptStrings.map((prompt) => JSON.parse(prompt) as unknown);
  const expectedCases = sample.map((scenario, index) => {
    const score = scoreDecision(scenario, 'ABSTAIN', 'PRE_SIGN');
    if (!score.eligible || score.expectedDecision === null) {
      throw new Error(`LLM sample must be PRE_SIGN-eligible: ${scenario.id}`);
    }
    return {
      reviewId: `R${String(index + 1).padStart(2, '0')}`,
      scenarioId: scenario.id,
      split: scenario.split,
      class: scenario.class,
      eligible: true as const,
      expectedDecision: score.expectedDecision,
      input: promptInputs[index],
    };
  });
  const inputSha256 = createHash('sha256')
    .update(JSON.stringify({ config, system: LLM_VERIFIER_SYSTEM_PROMPT, inputs: promptStrings }))
    .digest('hex');
  return { sample, expectedCases, promptInputs, promptStrings, inputSha256 };
}
