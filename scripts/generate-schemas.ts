import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { format, resolveConfig } from 'prettier';

import { createActionIrJsonSchema } from '../src/domain/action-ir.js';
import { createIntentContractJsonSchema } from '../src/domain/intent-contract.js';
import { createBenchmarkScenarioJsonSchema } from '../src/benchmark/scenario.js';

const outputs = [
  {
    path: 'benchmark/schemas/intent-contract.schema.json',
    schema: createIntentContractJsonSchema(),
  },
  { path: 'benchmark/schemas/action-ir.schema.json', schema: createActionIrJsonSchema() },
  {
    path: 'benchmark/schemas/scenario.schema.json',
    schema: createBenchmarkScenarioJsonSchema(),
  },
] as const;

const check = process.argv.includes('--check');
const prettierConfig = (await resolveConfig(resolve(process.cwd(), 'package.json'))) ?? {};
let stale = false;

for (const output of outputs) {
  const absolutePath = resolve(output.path);
  const contents = await format(JSON.stringify(output.schema), {
    ...prettierConfig,
    parser: 'json',
  });
  if (check) {
    const existing = await readFile(absolutePath, 'utf8').catch(() => '');
    if (existing !== contents) {
      console.error(`stale generated schema: ${output.path}`);
      stale = true;
    }
  } else {
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, contents, 'utf8');
    console.log(`generated ${output.path}`);
  }
}

if (stale) process.exitCode = 1;
