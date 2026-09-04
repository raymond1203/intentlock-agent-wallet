import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findDuplicateScenarios } from '../../src/benchmark/dedup.js';
import {
  BenchmarkDatasetSchema,
  BenchmarkScenarioSchema,
  SplitManifestSchema,
  type BenchmarkScenario,
} from '../../src/benchmark/scenario.js';
import { evaluateIntent } from '../../src/monitor/monitor.js';

const baseDirectories = [
  resolve(import.meta.dirname, '../../benchmark/scenarios/base/transfer'),
  resolve(import.meta.dirname, '../../benchmark/scenarios/base/swap'),
];

function loadScenarios(): BenchmarkScenario[] {
  return baseDirectories.flatMap((directory) => {
    const names = Array.from({ length: 10 }, (_, index) => index + 1);
    const prefixes = directory.endsWith('transfer') ? ['tr', 'ap'] : ['ss', 'bs'];
    return prefixes.flatMap((prefix) =>
      names.map((number) =>
        BenchmarkScenarioSchema.parse(
          JSON.parse(
            readFileSync(
              resolve(directory, `${prefix}-${String(number).padStart(2, '0')}.json`),
              'utf8',
            ),
          ),
        ),
      ),
    );
  });
}

const scenarios = loadScenarios();

describe('benchmark scenario schema and split freeze', () => {
  it('validates exactly 40 unique base scenarios', () => {
    expect(scenarios).toHaveLength(40);
    expect(new Set(scenarios.map((scenario) => scenario.id)).size).toBe(40);
  });

  it('validates the frozen ten-case golden reviewer set', () => {
    const golden = BenchmarkDatasetSchema.parse(
      JSON.parse(
        readFileSync(
          resolve(import.meta.dirname, '../../benchmark/scenarios/golden/benchmark.json'),
          'utf8',
        ),
      ),
    );
    expect(golden.scenarios).toHaveLength(10);
    expect(golden.scenarios.filter((scenario) => scenario.class === 'BASE')).toHaveLength(5);
    expect(golden.scenarios.filter((scenario) => scenario.class !== 'BASE')).toHaveLength(5);
  });

  it('keeps reviewer packets blind to stored author labels and mutation names', () => {
    for (const name of [
      'schema-labeling-10.json',
      'contract-alignment-10.json',
      'mutation-validity-20.json',
    ]) {
      const packet = readFileSync(
        resolve(import.meta.dirname, '../../benchmark/reviews', name),
        'utf8',
      );
      expect(packet).not.toContain('"oracle"');
      expect(packet).not.toContain('mutationOperator');
      expect(packet).not.toContain('expectedDecision');
    }
  });

  it('contains ten cases in each assigned workflow', () => {
    for (const workflow of ['TRANSFER', 'APPROVAL_PERMIT2', 'SWAP_SINGLE', 'SWAP_BATCH']) {
      expect(scenarios.filter((scenario) => scenario.workflow === workflow)).toHaveLength(10);
    }
  });

  it('uses the frozen grouped-stratified 24/8/8 split', () => {
    expect(scenarios.filter((scenario) => scenario.split === 'TRAIN')).toHaveLength(24);
    expect(scenarios.filter((scenario) => scenario.split === 'DEV')).toHaveLength(8);
    expect(scenarios.filter((scenario) => scenario.split === 'HIDDEN_TEST')).toHaveLength(8);
    const manifest = SplitManifestSchema.parse(
      JSON.parse(
        readFileSync(resolve(import.meta.dirname, '../../benchmark/splits/manifest.json'), 'utf8'),
      ),
    );
    expect(Object.keys(manifest.assignments)).toHaveLength(80);
    for (const scenario of scenarios)
      expect(manifest.assignments[scenario.id]).toBe(scenario.split);
  });

  it('keeps all curated traces within their Intent Contracts', () => {
    for (const scenario of scenarios) {
      expect(
        evaluateIntent({
          contract: scenario.intent,
          acceptedEffects: [],
          candidateEffects: scenario.trace.expectedEffects,
          candidateDecodeStatus: 'COMPLETE',
          simulationStatus: 'SUCCESS',
          evaluatedAt: '2026-08-30T00:00:00Z',
        }),
        scenario.id,
      ).toMatchObject({ kind: 'ALLOW' });
    }
  });

  it('keeps expected post-state aligned with decoded transfer, approval, and swap effects', () => {
    for (const scenario of scenarios) {
      const swap = scenario.trace.expectedEffects.find((effect) => effect.kind === 'SWAP');
      if (swap) {
        expect(
          scenario.oracle.postState.some(
            (state) =>
              state.field === 'BALANCE' &&
              state.subject.toLowerCase() === swap.recipient.toLowerCase() &&
              state.asset?.toLowerCase() === swap.assetOut.toLowerCase() &&
              BigInt(state.value) >= BigInt(swap.minAmountOut),
          ),
          scenario.id,
        ).toBe(true);
      }
      const lastApproval = [...scenario.trace.expectedEffects]
        .reverse()
        .find((effect) => effect.kind === 'APPROVAL');
      if (lastApproval) {
        const hasStoredAllowance = scenario.oracle.postState.some(
          (state) =>
            state.field === 'ALLOWANCE' &&
            state.subject.toLowerCase() === lastApproval.owner.toLowerCase() &&
            state.counterparty?.toLowerCase() === lastApproval.spender.toLowerCase() &&
            state.value === lastApproval.amount,
        );
        const oneUseSignatureTransfer =
          lastApproval.signatureDeadline !== undefined && lastApproval.expiration === undefined;
        expect(hasStoredAllowance, scenario.id).toBe(!oneUseSignatureTransfer);
      }
    }
  });

  it('does not contain exact or normalized near-duplicate scenarios', () => {
    expect(findDuplicateScenarios(scenarios)).toEqual([]);
  });

  it('rejects mixed BENIGN and violation labels', () => {
    const invalid = structuredClone(scenarios[0]);
    if (!invalid) throw new Error('base scenarios are missing');
    invalid.oracle.labels = ['BENIGN', 'AMOUNT_INFLATION'];
    expect(BenchmarkScenarioSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects a selector that differs from calldata', () => {
    const invalid = structuredClone(scenarios[0]);
    if (!invalid) throw new Error('base scenarios are missing');
    const action = invalid.trace.actions[0];
    if (!action) throw new Error('base scenario action is missing');
    action.selector = '0xdeadbeef';
    expect(BenchmarkScenarioSchema.safeParse(invalid).success).toBe(false);
  });

  it('requires generated provenance for a mutated scenario', () => {
    const invalid = structuredClone(scenarios[0]);
    if (!invalid) throw new Error('base scenarios are missing');
    invalid.class = 'ADVERSARIAL';
    invalid.trace.kind = 'ADVERSARIAL';
    invalid.oracle.labels = ['AMOUNT_INFLATION'];
    expect(BenchmarkScenarioSchema.safeParse(invalid).success).toBe(false);
  });
});
