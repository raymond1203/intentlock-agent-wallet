import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BenchmarkScenarioSchema } from '../../src/benchmark/scenario.js';
import { scoreDecision } from '../../src/benchmark/scoring.js';
import { applyMutation } from '../../src/benchmark/mutations/index.js';
import { createLlmVerifierUserPrompt } from '../../src/baselines/llm-verifier.js';

const base = BenchmarkScenarioSchema.parse(
  JSON.parse(readFileSync('benchmark/scenarios/base/swap/ss-01.json', 'utf8')),
);
const stale = applyMutation(base, 'stale-quote', 2026);
describe('stage-aware scoring', () => {
  it('excludes an indistinguishable post-state-only case from every pre-sign denominator', () => {
    expect(createLlmVerifierUserPrompt(stale)).toBe(createLlmVerifierUserPrompt(base));
    for (const decision of ['ALLOW', 'DENY', 'ABSTAIN'] as const) {
      expect(scoreDecision(stale, decision, 'PRE_SIGN')).toMatchObject({
        eligible: false,
        exactMatch: null,
      });
    }
  });
  it('scores the post-state case at its observable stage', () => {
    expect(scoreDecision(stale, 'DENY', 'POST_STATE')).toMatchObject({
      eligible: true,
      exactMatch: true,
    });
    expect(scoreDecision(stale, 'ALLOW', 'POST_STATE').exactMatch).toBe(false);
  });
  it('scores ordinary pre-sign cases and maps escalation consistently', () => {
    expect(scoreDecision(base, 'ALLOW', 'PRE_SIGN').exactMatch).toBe(true);
    const unknown = applyMutation(base, 'benign-hallucination', 2026);
    expect(scoreDecision(unknown, 'ABSTAIN', 'PRE_SIGN').exactMatch).toBe(true);
  });
  it('does not score a pre-sign policy label as a post-state loss outcome', () => {
    expect(scoreDecision(base, 'ALLOW', 'POST_STATE')).toMatchObject({
      eligible: false,
      exactMatch: null,
    });
  });
  it('keeps planned input identical when cross-chain completion evidence is absent', () => {
    const bridge = BenchmarkScenarioSchema.parse(
      JSON.parse(readFileSync('benchmark/scenarios/base/bridge/br-01.json', 'utf8')),
    );
    const partial = applyMutation(bridge, 'partial-completion', 2026);
    expect(createLlmVerifierUserPrompt(partial)).toBe(createLlmVerifierUserPrompt(bridge));
    expect(scoreDecision(partial, 'ALLOW', 'PRE_SIGN').eligible).toBe(false);
    expect(scoreDecision(partial, 'ABSTAIN', 'POST_STATE').exactMatch).toBe(true);
  });
});
