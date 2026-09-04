import { readFile, readdir, writeFile } from 'node:fs/promises';

import { format } from 'prettier';

import { BenchmarkScenarioSchema, type BenchmarkScenario } from '../src/benchmark/scenario.js';
import { createEvaluationCaseMatrix } from '../src/experiments/case-matrix.js';

const out =
  process.argv.find((argument) => argument.startsWith('--out='))?.slice(6) ??
  'experiments/configs/case-manifest.json';
const check = process.argv.includes('--check');
const baseRoot = 'benchmark/scenarios/base';
const workflows = ['transfer', 'swap', 'bridge', 'lending', 'batch'] as const;

async function loadBases(): Promise<BenchmarkScenario[]> {
  const scenarios: BenchmarkScenario[] = [];
  for (const workflow of workflows) {
    for (const file of (await readdir(`${baseRoot}/${workflow}`)).filter((candidate) =>
      candidate.endsWith('.json'),
    )) {
      scenarios.push(
        BenchmarkScenarioSchema.parse(
          JSON.parse(await readFile(`${baseRoot}/${workflow}/${file}`, 'utf8')),
        ),
      );
    }
  }
  return scenarios;
}

const matrix = createEvaluationCaseMatrix(await loadBases());
const manifest = {
  protocolVersion: matrix.protocolVersion,
  datasetVersion: matrix.datasetVersion,
  rootSeed: matrix.rootSeed,
  baseCount: matrix.baseCount,
  caseCount: matrix.caseCount,
  casesPerBase: matrix.casesPerBase,
  derivation: {
    generator: 'src/experiments/case-matrix.ts',
    source: 'benchmark/scenarios/base',
    note: 'Mutated scenarios are regenerated and checked against scenarioSha256 before evaluation.',
  },
  entries: matrix.entries,
};
const rendered = await format(JSON.stringify(manifest), { parser: 'json' });

if (check) {
  const current = await readFile(out, 'utf8').catch(() => '');
  if (current !== rendered) {
    console.error(`${out} is stale; run the evaluation case generator`);
    process.exitCode = 1;
  }
} else {
  await writeFile(out, rendered);
}

console.log(
  JSON.stringify({
    baseCount: matrix.baseCount,
    caseCount: matrix.caseCount,
    variants: Object.fromEntries(
      [...new Set(matrix.entries.map((entry) => entry.variant))].map((variant) => [
        variant,
        matrix.entries.filter((entry) => entry.variant === variant).length,
      ]),
    ),
  }),
);
