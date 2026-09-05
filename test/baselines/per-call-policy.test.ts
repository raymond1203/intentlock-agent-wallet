import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { applyMutation } from '../../src/benchmark/mutations/index.js';
import { BenchmarkScenarioSchema, type BenchmarkScenario } from '../../src/benchmark/scenario.js';
import { evaluatePerCallPolicy } from '../../src/baselines/per-call-policy.js';
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

const transfer = load('transfer/tr-01.json');
const twoStepTransfer = load('transfer/tr-06.json');

describe('per-call policy baseline', () => {
  it('allows a compliant base trace', () => {
    expect(evaluatePerCallPolicy(transfer)).toMatchObject({
      baseline: 'PER_CALL_POLICY',
      decision: 'ALLOW',
      checkedUnits: 1,
    });
  });

  it.each(['recipient-substitution', 'amount-inflation', 'chain-substitution'] as const)(
    'denies locally visible %s',
    (operator) => {
      expect(evaluatePerCallPolicy(applyMutation(transfer, operator, 2026)).decision).toBe('DENY');
    },
  );

  it.each(['retry-double-spend', 'concurrency-race', 'policy-laundering'] as const)(
    'exposes the expected cumulative blind spot for %s',
    (operator) => {
      expect(evaluatePerCallPolicy(applyMutation(transfer, operator, 2026))).toMatchObject({
        decision: 'ALLOW',
        checkedUnits: 2,
      });
    },
  );

  it('abstains from an unknown effect', () => {
    expect(
      evaluatePerCallPolicy(applyMutation(transfer, 'benign-hallucination', 2026)),
    ).toMatchObject({ decision: 'ABSTAIN', reasonCodes: ['UNKNOWN_EFFECT'] });
  });

  it('reports the true signer ordinal of the first locally visible intervention', () => {
    const secondActionOutOfScope = structuredClone(twoStepTransfer);
    const second = [...secondActionOutOfScope.trace.actions].sort(
      (left, right) => left.executionIndex - right.executionIndex,
    )[1];
    if (!second) throw new Error('two-step fixture is missing its second action');
    second.target = '0x9999999999999999999999999999999999999999';
    expect(evaluatePerCallPolicy(secondActionOutOfScope)).toMatchObject({
      decision: 'DENY',
      checkedUnits: 2,
      firstDetectionActionOrdinal: 2,
    });
  });

  it('returns a schema-valid result', () => {
    expect(BaselineVerdictSchema.safeParse(evaluatePerCallPolicy(transfer)).success).toBe(true);
  });
});
