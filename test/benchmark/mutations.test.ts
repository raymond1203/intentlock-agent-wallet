import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  applyMutation,
  MUTATION_OPERATOR_IDS,
  type MutationOperatorId,
} from '../../src/benchmark/mutations/index.js';
import { BenchmarkScenarioSchema, type BenchmarkScenario } from '../../src/benchmark/scenario.js';
import { evaluateIntent } from '../../src/monitor/monitor.js';
import { evaluatePostState } from '../../src/oracle/post-state-oracle.js';

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

const bases = {
  transfer: load('transfer/tr-01.json'),
  approval: load('transfer/ap-01.json'),
  permit2: load('transfer/ap-03.json'),
  swap: load('swap/ss-01.json'),
  batch: load('swap/bs-01.json'),
  bridge: load('bridge/br-01.json'),
};

const baseByOperator: Record<MutationOperatorId, BenchmarkScenario> = {
  'recipient-substitution': bases.transfer,
  'token-substitution': bases.transfer,
  'chain-substitution': bases.transfer,
  'amount-inflation': bases.transfer,
  'slippage-widening': bases.swap,
  'gas-inflation': bases.transfer,
  'deadline-extension': bases.permit2,
  'unlimited-approval': bases.approval,
  'hidden-batch': bases.batch,
  'stale-quote': bases.swap,
  'partial-completion': bases.bridge,
  'retry-double-spend': bases.transfer,
  'concurrency-race': bases.transfer,
  'policy-laundering': bases.transfer,
  'benign-hallucination': bases.transfer,
};

function evaluate(scenario: BenchmarkScenario) {
  if (scenario.oracle.observationStage === 'POST_STATE') {
    const result = evaluatePostState({
      contract: scenario.intent,
      preState: scenario.oracle.preState,
      postState: scenario.oracle.postState,
      observedEffects: scenario.trace.expectedEffects,
      evidenceLevel: 'EXPECTED_FIXTURE',
      executionComplete: scenario.oracle.executionComplete,
    });
    return { kind: result.decision };
  }
  return evaluateIntent({
    contract: scenario.intent,
    acceptedEffects: [],
    candidateEffects: scenario.trace.expectedEffects,
    candidateDecodeStatus:
      scenario.mutation?.validity === 'INVALID_CALLDATA' ? 'UNKNOWN' : 'COMPLETE',
    simulationStatus: 'SUCCESS',
    evaluatedAt: '2026-08-30T00:00:00Z',
  });
}

describe('deterministic benchmark mutation operators', () => {
  it('covers every declared operator with a schema-valid representative', () => {
    expect(MUTATION_OPERATOR_IDS).toHaveLength(15);
    for (const operator of MUTATION_OPERATOR_IDS) {
      const mutated = applyMutation(baseByOperator[operator], operator, 2026);
      expect(BenchmarkScenarioSchema.safeParse(mutated).success, operator).toBe(true);
      expect(mutated.provenance).toMatchObject({
        kind: 'GENERATED',
        mutationOperator: operator,
        seed: 2026,
      });
      expect(mutated.mutation?.changes.length, operator).toBeGreaterThan(0);
      expect(mutated.split).toBe(baseByOperator[operator].split);
    }
  });

  it('replays byte-identical scenarios for the same seed', () => {
    for (const operator of MUTATION_OPERATOR_IDS) {
      expect(applyMutation(baseByOperator[operator], operator, 2026)).toEqual(
        applyMutation(baseByOperator[operator], operator, 2026),
      );
    }
  });

  it('uses the seed to vary numeric mutations', () => {
    const first = applyMutation(bases.transfer, 'amount-inflation', 1);
    const second = applyMutation(bases.transfer, 'amount-inflation', 2);
    expect(first.trace.expectedEffects).not.toEqual(second.trace.expectedEffects);
  });

  it.each(
    MUTATION_OPERATOR_IDS.filter((operator) => operator !== 'benign-hallucination').map(
      (operator) => [operator] as const,
    ),
  )('does not allow the %s mutation', (operator) => {
    const decision = evaluate(applyMutation(baseByOperator[operator], operator, 2026));
    expect(decision.kind, operator).not.toBe('ALLOW');
  });

  it('fails closed on unsupported benign hallucinations', () => {
    const mutated = applyMutation(bases.transfer, 'benign-hallucination', 2026);
    expect(mutated).toMatchObject({
      class: 'BENIGN_DRIFT',
      mutation: { validity: 'INVALID_CALLDATA' },
      oracle: { expectedDecision: 'ESCALATE', labels: ['BENIGN_HALLUCINATION'] },
    });
    expect(evaluate(mutated).kind).toBe('ESCALATE');
  });

  it('keeps semantic attacks valid and marks only the hallucinated calldata invalid', () => {
    const validity = MUTATION_OPERATOR_IDS.map(
      (operator) => applyMutation(baseByOperator[operator], operator, 2026).mutation?.validity,
    );
    expect(validity.filter((value) => value === 'VALID_SEMANTIC')).toHaveLength(14);
    expect(validity.filter((value) => value === 'INVALID_CALLDATA')).toHaveLength(1);
  });

  it('rejects invalid seeds and recursively mutated inputs', () => {
    expect(() => applyMutation(bases.transfer, 'amount-inflation', -1)).toThrow(
      'seed must be a nonnegative safe integer',
    );
    const mutated = applyMutation(bases.transfer, 'amount-inflation', 2026);
    expect(() => applyMutation(mutated, 'amount-inflation', 2026)).toThrow(
      'mutations require a base scenario',
    );
  });
});
