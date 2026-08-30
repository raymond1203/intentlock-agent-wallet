import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { applyMutation, type MutationOperatorId } from '../../src/benchmark/mutations/index.js';
import { BenchmarkScenarioSchema, type BenchmarkScenario } from '../../src/benchmark/scenario.js';
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
    const base = [
      load('transfer/tr-01.json'),
      load('transfer/tr-02.json'),
      load('transfer/tr-03.json'),
      load('transfer/ap-01.json'),
      load('transfer/ap-03.json'),
      load('swap/ss-01.json'),
      load('swap/ss-02.json'),
      load('swap/ss-03.json'),
      load('swap/bs-01.json'),
      load('swap/bs-02.json'),
    ];
    const operators: MutationOperatorId[] = [
      'recipient-substitution',
      'token-substitution',
      'chain-substitution',
      'amount-inflation',
      'slippage-widening',
      'deadline-extension',
      'unlimited-approval',
      'hidden-batch',
      'policy-laundering',
      'benign-hallucination',
    ];
    const mutationBases = [
      base[0],
      base[0],
      base[0],
      base[0],
      base[5],
      base[4],
      base[3],
      base[8],
      base[0],
      base[0],
    ];
    const mutated = operators.map((operator, index) => {
      const source = mutationBases[index];
      if (!source) throw new Error(`mutation base ${String(index)} is missing`);
      return applyMutation(source, operator, 2026);
    });
    const sample = [...base, ...mutated];
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
