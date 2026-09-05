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
  baseOnly: load('batch/ba-07.json'),
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

  it('always substitutes a different supported chain, including from Base', () => {
    const ethereumMutation = applyMutation(bases.transfer, 'chain-substitution', 2026);
    expect(ethereumMutation.trace.actions.every((action) => action.chainId === 8453)).toBe(true);

    const baseScenario = structuredClone(bases.transfer);
    for (const action of baseScenario.trace.actions) action.chainId = 8453;
    for (const effect of baseScenario.trace.expectedEffects) {
      if (effect.kind === 'BRIDGE') effect.sourceChainId = 8453;
      else effect.chainId = 8453;
    }
    const baseMutation = applyMutation(baseScenario, 'chain-substitution', 2026);
    expect(baseMutation.trace.actions.every((action) => action.chainId === 1)).toBe(true);
    expect(baseMutation.mutation?.changes[0]).toMatchObject({ before: '8453', after: '1' });
  });

  it('preserves cross-chain bridge topology for every curated bridge scenario', () => {
    for (let index = 1; index <= 15; index += 1) {
      const original = load(`bridge/br-${String(index).padStart(2, '0')}.json`);
      const mutated = applyMutation(original, 'chain-substitution', 2026);
      expect(mutated.trace.actions, original.id).toHaveLength(original.trace.actions.length);
      mutated.trace.actions.forEach((action, actionIndex) => {
        const originalAction = original.trace.actions[actionIndex];
        if (!originalAction) throw new Error(`${original.id} action fixture missing`);
        expect(action.chainId, `${original.id} action ${String(actionIndex)}`).toBe(
          originalAction.chainId === 1 ? 8453 : 1,
        );
      });
      const bridges = mutated.trace.expectedEffects.filter((effect) => effect.kind === 'BRIDGE');
      expect(bridges.length, original.id).toBeGreaterThan(0);
      for (const bridge of bridges) {
        expect(bridge.sourceChainId, original.id).not.toBe(bridge.destinationChainId);
      }
    }
  });

  it('keeps gas inflation on the scenario action chain for Base-only cases', () => {
    expect(bases.baseOnly.trace.actions.every((action) => action.chainId === 8453)).toBe(true);
    const mutated = applyMutation(bases.baseOnly, 'gas-inflation', 2026);
    const gas = mutated.trace.expectedEffects.find((effect) => effect.kind === 'GAS');
    expect(gas).toMatchObject({ kind: 'GAS', chainId: 8453 });
  });

  it('models stale quotes against the matching output delta, not the first post-state row', () => {
    const scenario = structuredClone(bases.swap);
    const swap = scenario.trace.expectedEffects.find((effect) => effect.kind === 'SWAP');
    if (!swap) throw new Error('swap fixture missing');
    const matchesOutput = (row: (typeof scenario.oracle.postState)[number]) =>
      row.chainId === swap.chainId &&
      row.field === 'BALANCE' &&
      row.subject.toLowerCase() === swap.recipient.toLowerCase() &&
      row.asset?.toLowerCase() === swap.assetOut.toLowerCase();
    const pre = scenario.oracle.preState.find(matchesOutput);
    const post = scenario.oracle.postState.find(matchesOutput);
    if (!pre || !post) throw new Error('swap output state fixture missing');
    pre.value = '37';
    post.value = (37n + BigInt(swap.quotedAmountOut ?? swap.minAmountOut)).toString();
    scenario.oracle.referenceMode = 'DELTA';
    scenario.oracle.expectedDeltas = [
      {
        chainId: swap.chainId,
        subject: swap.recipient,
        field: 'BALANCE',
        asset: swap.assetOut,
        comparison: 'AT_LEAST',
        delta: swap.minAmountOut,
        rationale: 'Pinned swap minimum output.',
      },
    ];
    scenario.intent.finalStateGoals = [
      {
        chainId: swap.chainId,
        kind: 'MIN_ASSET_BALANCE_DELTA',
        asset: swap.assetOut,
        account: swap.recipient,
        minIncrease: swap.minAmountOut,
      },
    ];

    const mutated = applyMutation(scenario, 'stale-quote', 2026);
    const actual = mutated.oracle.postState.find(matchesOutput);
    expect(actual).toBeDefined();
    expect(BigInt(actual?.value ?? '0') - 37n).toBe(BigInt(swap.minAmountOut) - 1n);
    expect(mutated.oracle.expectedDeltas).toEqual(scenario.oracle.expectedDeltas);
    expect(
      evaluatePostState({
        contract: mutated.intent,
        preState: mutated.oracle.preState,
        postState: mutated.oracle.postState,
        observedEffects: mutated.trace.expectedEffects,
        expectedDeltas: mutated.oracle.expectedDeltas,
        evidenceLevel: 'EXPECTED_FIXTURE',
        executionComplete: true,
      }).status,
    ).toBe('VIOLATION');
  });

  it('removes destination delta references when bridge completion is partial', () => {
    const scenario = structuredClone(bases.bridge);
    const bridge = scenario.trace.expectedEffects.find((effect) => effect.kind === 'BRIDGE');
    if (!bridge) throw new Error('bridge fixture missing');
    const sourceRow = scenario.oracle.preState.find(
      (row) => row.chainId === bridge.sourceChainId && row.field === 'BALANCE' && row.asset,
    );
    const destinationRow = scenario.oracle.postState.find(
      (row) => row.chainId === bridge.destinationChainId && row.field === 'BALANCE' && row.asset,
    );
    if (!sourceRow?.asset || !destinationRow?.asset)
      throw new Error('bridge state fixture missing');
    scenario.oracle.referenceMode = 'DELTA';
    scenario.oracle.expectedDeltas = [
      {
        chainId: bridge.sourceChainId,
        subject: sourceRow.subject,
        field: 'BALANCE',
        asset: sourceRow.asset,
        comparison: 'EXACT',
        delta: '-1',
        rationale: 'Source debit remains observable.',
      },
      {
        chainId: bridge.destinationChainId,
        subject: destinationRow.subject,
        field: 'BALANCE',
        asset: destinationRow.asset,
        comparison: 'AT_LEAST',
        delta: '1',
        rationale: 'Destination credit requires relay completion.',
      },
    ];

    const mutated = applyMutation(scenario, 'partial-completion', 2026);
    expect(mutated.oracle.postState.every((row) => row.chainId !== bridge.destinationChainId)).toBe(
      true,
    );
    expect(
      mutated.oracle.expectedDeltas.every((row) => row.chainId !== bridge.destinationChainId),
    ).toBe(true);
    expect(mutated.oracle.expectedDeltas).toHaveLength(1);
    expect(mutated.oracle.executionComplete).toBe(false);
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

  it('separates semantic candidates, terminal-only fixtures and invalid calldata', () => {
    const validity = MUTATION_OPERATOR_IDS.map(
      (operator) => applyMutation(baseByOperator[operator], operator, 2026).mutation?.validity,
    );
    expect(validity.filter((value) => value === 'VALID_SEMANTIC')).toHaveLength(12);
    expect(validity.filter((value) => value === 'POST_STATE_FIXTURE')).toHaveLength(2);
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
