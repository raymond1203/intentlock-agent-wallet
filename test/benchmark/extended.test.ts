import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BenchmarkScenarioSchema } from '../../src/benchmark/scenario.js';
import { evaluateIntent } from '../../src/monitor/monitor.js';
import { evaluatePostState } from '../../src/oracle/post-state-oracle.js';
import { findDuplicateScenarios } from '../../src/benchmark/dedup.js';

const scenarios = ['transfer', 'swap', 'bridge', 'lending', 'batch'].flatMap((dir) =>
  readdirSync(`benchmark/scenarios/base/${dir}`)
    .filter((f) => f.endsWith('.json'))
    .map((f) =>
      BenchmarkScenarioSchema.parse(
        JSON.parse(readFileSync(`benchmark/scenarios/base/${dir}/${f}`, 'utf8')),
      ),
    ),
);
describe('complete M2 base inventory', () => {
  it('contains 80 distinct cases across all seven workflows', () => {
    expect(scenarios).toHaveLength(80);
    expect(new Set(scenarios.map((s) => s.id)).size).toBe(80);
    for (const [workflow, count] of [
      ['BRIDGE_SWAP', 15],
      ['LENDING', 15],
      ['BATCH_RECOVERY', 10],
    ] as const)
      expect(scenarios.filter((s) => s.workflow === workflow)).toHaveLength(count);
    expect(findDuplicateScenarios(scenarios)).toEqual([]);
  });
  it('preserves the 60/20/20 grouped split and pinned environments', () => {
    expect(scenarios.filter((s) => s.split === 'TRAIN')).toHaveLength(48);
    expect(scenarios.filter((s) => s.split === 'DEV')).toHaveLength(16);
    expect(scenarios.filter((s) => s.split === 'HIDDEN_TEST')).toHaveLength(16);
    for (const s of scenarios)
      for (const chain of s.intent.safety.chainScopes)
        expect(s.fixture?.chains.some((c) => c.chainId === chain.chainId)).toBe(true);
  });
  it.each(scenarios.map((s) => [s.id, s] as const))(
    '%s passes only the explicitly synthetic pre-sign/reference-state path',
    (_id, s) => {
      expect(
        evaluateIntent({
          contract: s.intent,
          acceptedEffects: [],
          candidateEffects: s.trace.expectedEffects,
          candidateDecodeStatus: 'COMPLETE',
          simulationStatus: 'SUCCESS',
          evaluatedAt: '2026-08-30T00:00:00Z',
        }).kind,
      ).toBe('ALLOW');
      expect(
        evaluatePostState({
          contract: s.intent,
          preState: s.oracle.preState,
          postState: s.oracle.postState,
          observedEffects: s.trace.expectedEffects,
          expectedDeltas: s.oracle.expectedDeltas,
          evidenceLevel: 'EXPECTED_FIXTURE',
          executionComplete: true,
        }).status,
      ).toBe('PASS');
      expect(s.oracle.evidenceLevel).toBe('EXPECTED_FIXTURE');
    },
  );
});
