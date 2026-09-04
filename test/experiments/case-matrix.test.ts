import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BenchmarkScenarioSchema, type BenchmarkScenario } from '../../src/benchmark/scenario.js';
import { createEvaluationCaseMatrix } from '../../src/experiments/case-matrix.js';

function loadBaseScenarios(): BenchmarkScenario[] {
  const root = resolve(import.meta.dirname, '../../benchmark/scenarios/base');
  return ['transfer', 'swap', 'bridge', 'lending', 'batch'].flatMap((directory) =>
    readdirSync(resolve(root, directory))
      .filter((name) => name.endsWith('.json'))
      .map((name) =>
        BenchmarkScenarioSchema.parse(
          JSON.parse(readFileSync(resolve(root, directory, name), 'utf8')),
        ),
      ),
  );
}

describe('frozen evaluation case matrix', () => {
  it('creates 400 traceable cases without same-chain bridges or cross-chain gas confounds', () => {
    const matrix = createEvaluationCaseMatrix(loadBaseScenarios());
    expect(matrix).toMatchObject({ baseCount: 80, caseCount: 400, casesPerBase: 5 });
    expect(matrix.entries).toHaveLength(400);

    for (const [index, scenario] of matrix.scenarios.entries()) {
      const entry = matrix.entries[index];
      if (!entry) throw new Error(`missing matrix entry ${String(index)}`);
      expect(entry).toMatchObject({
        oracleEvidenceLevel: scenario.oracle.evidenceLevel,
        mutationValidity: scenario.mutation?.validity ?? null,
      });
      expect(entry.chainIds).toEqual(
        [
          ...new Set([
            ...scenario.trace.actions.map((action) => action.chainId),
            ...scenario.trace.expectedEffects.flatMap((effect) =>
              effect.kind === 'BRIDGE'
                ? [effect.sourceChainId, effect.destinationChainId]
                : [effect.chainId],
            ),
          ]),
        ].sort((left, right) => left - right),
      );
      const actionChains = new Set(scenario.trace.actions.map((action) => action.chainId));
      for (const effect of scenario.trace.expectedEffects) {
        if (effect.kind === 'BRIDGE') {
          expect(effect.sourceChainId).not.toBe(effect.destinationChainId);
        }
        if (effect.kind === 'GAS') {
          expect(actionChains.has(effect.chainId)).toBe(true);
        }
      }
    }
  });
});
