import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BenchmarkScenarioSchema, type BenchmarkScenario } from '../../src/benchmark/scenario.js';
import {
  buildLlmBaselineInputBinding,
  LLM_BASELINE_PROTOCOL_PATH,
} from '../../src/baselines/llm-baseline-input.js';
import {
  createLlmVerifierUserPrompt,
  evaluateLlmVerifier,
  LlmVerifierConfigSchema,
  type LlmClient,
} from '../../src/baselines/llm-verifier.js';
import { BaselineVerdictSchema } from '../../src/baselines/types.js';

function load(relativePath: string): BenchmarkScenario {
  return BenchmarkScenarioSchema.parse(
    JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, '../../benchmark/scenarios/base', relativePath),
        'utf8',
      ),
    ),
  );
}

const config = LlmVerifierConfigSchema.parse(
  JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, '../../experiments/configs/baselines/llm-verifier.json'),
      'utf8',
    ),
  ),
);
const transfer = load('transfer/tr-01.json');
const reviewProtocol = JSON.parse(
  readFileSync(resolve(LLM_BASELINE_PROTOCOL_PATH), 'utf8'),
) as unknown;
const inputBinding = await buildLlmBaselineInputBinding(config, reviewProtocol, (id) => {
  const directory = id.startsWith('TR-') || id.startsWith('AP-') ? 'transfer' : 'swap';
  return Promise.resolve(load(`${directory}/${id.toLowerCase()}.json`));
});

function clientReturning(output: string): LlmClient {
  return { complete: () => Promise.resolve(output) };
}

describe('structured LLM verifier baseline', () => {
  it('accepts only the fixed zero-temperature configuration', () => {
    expect(() => LlmVerifierConfigSchema.parse({ ...config, temperature: 0.2 })).toThrow();
    expect(() => LlmVerifierConfigSchema.parse({ ...config, promptVersion: 'latest' })).toThrow();
  });

  it('withholds the oracle from the prompt', () => {
    const prompt = createLlmVerifierUserPrompt(transfer);
    expect(prompt).not.toContain('expectedDecision');
    expect(prompt).not.toContain('oracle');
    expect(prompt).not.toContain(transfer.id);
  });

  it('publishes an oracle-free twenty-case human review packet', () => {
    const packet = JSON.parse(
      readFileSync(
        resolve(
          import.meta.dirname,
          '../../experiments/configs/baselines/llm-verifier-20-review.json',
        ),
        'utf8',
      ),
    ) as { cases: Array<{ input: unknown }> };
    const inputs = JSON.stringify(packet.cases.map((candidate) => candidate.input));
    expect(packet.cases).toHaveLength(20);
    expect(inputs).not.toContain('scenarioId');
    expect(inputs).not.toContain('expectedDecision');
    expect(inputs).not.toContain('mutationOperator');
    expect(inputs).not.toContain('oracle');
  });

  it('parses a strict structured verdict', async () => {
    const result = await evaluateLlmVerifier(
      transfer,
      config,
      clientReturning(
        JSON.stringify({ decision: 'ALLOW', rationale: 'All bounds match.', violatedFields: [] }),
      ),
    );
    expect(result).toMatchObject({ decision: 'ALLOW', attempts: 1 });
    expect(BaselineVerdictSchema.safeParse(result).success).toBe(true);
  });

  it('retries malformed output and then explicitly abstains', async () => {
    let calls = 0;
    const client: LlmClient = {
      complete: () => {
        calls += 1;
        return Promise.resolve('```json\n{"decision":"ALLOW"}\n```');
      },
    };
    const result = await evaluateLlmVerifier(transfer, config, client);
    expect(result).toMatchObject({ decision: 'ABSTAIN', attempts: 2 });
    expect(calls).toBe(2);
  });

  it('can use a fixed DENY fail-closed policy', async () => {
    const result = await evaluateLlmVerifier(
      transfer,
      { ...config, maxRetries: 0, malformedPolicy: 'DENY' },
      clientReturning('{"decision":"ALLOW","rationale":"x","violatedFields":[],"extra":true}'),
    );
    expect(result.decision).toBe('DENY');
  });

  it('aborts a timed-out client and abstains', async () => {
    const client: LlmClient = {
      complete: (_request, signal): Promise<string> =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              reject(new Error('aborted'));
            },
            { once: true },
          );
        }),
    };
    const result = await evaluateLlmVerifier(
      transfer,
      { ...config, maxRetries: 0, timeoutMs: 100 },
      client,
    );
    expect(result).toMatchObject({ decision: 'ABSTAIN', attempts: 1 });
  });

  it('validates the adapter path over the frozen twenty-output review sample', async () => {
    const sample = inputBinding.sample;
    expect(inputBinding.expectedCases.map((entry) => entry.scenarioId)).toEqual(
      sample.map((scenario) => scenario.id),
    );
    expect(inputBinding.inputSha256).toMatch(/^[a-f0-9]{64}$/);
    let calls = 0;
    let nextIndex = 0;
    const client: LlmClient = {
      complete: () => {
        calls += 1;
        const scenario = sample[nextIndex];
        nextIndex += 1;
        if (!scenario) throw new Error('unknown scenario');
        const decision =
          scenario.oracle.expectedDecision === 'ESCALATE'
            ? 'ABSTAIN'
            : scenario.oracle.expectedDecision;
        return Promise.resolve(
          JSON.stringify({ decision, rationale: 'Fixture verdict.', violatedFields: [] }),
        );
      },
    };
    const results = await Promise.all(
      sample.map((scenario) => evaluateLlmVerifier(scenario, config, client)),
    );
    expect(results).toHaveLength(20);
    expect(results.every((result) => BaselineVerdictSchema.safeParse(result).success)).toBe(true);
    expect(calls).toBe(20);
  });
});
