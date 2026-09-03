import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createLlmVerifierUserPrompt } from '../../src/baselines/llm-verifier.js';
import { BenchmarkScenarioSchema, type BenchmarkScenario } from '../../src/benchmark/scenario.js';

const ROOT = resolve(import.meta.dirname, '../..');

const PACKETS = [
  'benchmark/reviews/schema-labeling-10.json',
  'benchmark/reviews/contract-alignment-10.json',
  'benchmark/reviews/mutation-validity-20.json',
];

/** Scenario identifiers such as `base-tr-01`, `tr-01-action-0`, `ss-01-effect-0-1`. */
const SCENARIO_ID_PATTERN = /(base-)?(tr|ap|ss|bs)-\d{2}(-|")/i;
/** Mutation operator names embedded in generated ids. */
const OPERATOR_PATTERN =
  /(recipient-substitution|token-substitution|chain-substitution|amount-inflation|slippage-widening|gas-inflation|deadline-extension|unlimited-approval|hidden-batch|stale-quote|partial-completion|retry-double-spend|concurrency-race|policy-laundering|benign-hallucination)/i;

function readPacket(path: string): { cases: Record<string, unknown>[] } {
  return JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as {
    cases: Record<string, unknown>[];
  };
}

function loadBaseScenarios(): BenchmarkScenario[] {
  const scenarios: BenchmarkScenario[] = [];
  for (const directory of ['base/transfer', 'base/swap']) {
    const dir = resolve(ROOT, 'benchmark/scenarios', directory);
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.json'))) {
      scenarios.push(
        BenchmarkScenarioSchema.parse(JSON.parse(readFileSync(resolve(dir, file), 'utf8'))),
      );
    }
  }
  return scenarios;
}

describe('review packets are actually blind', () => {
  it.each(PACKETS)('%s hides the source scenario identity', (path) => {
    const raw = readFileSync(resolve(ROOT, path), 'utf8');
    expect(raw).not.toMatch(SCENARIO_ID_PATTERN);
    expect(raw.match(/"idempotencyKey": "(?!redacted-intent)/)).toBeNull();
  });

  it.each(PACKETS)('%s never names the mutation operator', (path) => {
    // The operator is exactly what the reviewer has to infer for issue 23.
    expect(readFileSync(resolve(ROOT, path), 'utf8')).not.toMatch(OPERATOR_PATTERN);
  });

  it.each(PACKETS)('%s never exposes the author class through trace.kind', (path) => {
    expect(readFileSync(resolve(ROOT, path), 'utf8')).not.toMatch(
      /"kind":\s*"(BENIGN|ADVERSARIAL|BENIGN_DRIFT)"/,
    );
  });

  it.each(PACKETS)('%s contains no hidden-test scenario', (path) => {
    const byText = new Map(
      loadBaseScenarios().map((scenario) => [scenario.naturalLanguage.text, scenario.split]),
    );
    for (const reviewCase of readPacket(path).cases) {
      for (const side of ['candidate', 'base'] as const) {
        const value = reviewCase[side] as { naturalLanguage?: { text?: string } } | undefined;
        const text = value?.naturalLanguage?.text;
        if (text !== undefined) expect(byText.get(text)).not.toBe('HIDDEN_TEST');
      }
    }
  });
});

describe('LLM baseline prompt is blind', () => {
  it('carries no scenario id, idempotency key, or operator name', () => {
    for (const scenario of loadBaseScenarios()) {
      const prompt = createLlmVerifierUserPrompt(scenario);
      expect(prompt).not.toMatch(SCENARIO_ID_PATTERN);
      expect(prompt).not.toMatch(OPERATOR_PATTERN);
      expect(prompt).toContain('"idempotencyKey":"redacted-intent"');
    }
  });

  it('keeps the facts the verifier needs', () => {
    const scenario = loadBaseScenarios()[0];
    if (!scenario) throw new Error('no base scenarios found');
    const prompt = createLlmVerifierUserPrompt(scenario);
    expect(prompt).toContain(scenario.naturalLanguage.text);
    expect(prompt).toContain(scenario.intent.account);
    expect(prompt).toContain('"decodedEconomicEffects"');
  });
});
