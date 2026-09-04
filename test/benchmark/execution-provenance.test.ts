import { describe, expect, it } from 'vitest';
import {
  EXECUTION_COLLECTOR_PATHS,
  executionCollectorSha256,
} from '../../scripts/m2-execution/provenance.js';

const VERSION_PATH = 'src/benchmark/version.ts';
const RUNTIME_VERSION_PATH = 'dist/src/benchmark/version.js';

function virtualCollectorFiles(version: string): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  for (const path of EXECUTION_COLLECTOR_PATHS) {
    files.set(path, Buffer.from(`source:${path}`));
    if (path.endsWith('.ts')) {
      files.set(`dist/${path.slice(0, -3)}.js`, Buffer.from(`runtime:${path}`));
    }
  }
  files.set(VERSION_PATH, Buffer.from(`export const BENCHMARK_DATASET_VERSION = '${version}';`));
  files.set(
    RUNTIME_VERSION_PATH,
    Buffer.from(`export const BENCHMARK_DATASET_VERSION = '${version}';`),
  );
  return files;
}

async function digestForVersion(version: string): Promise<string> {
  const files = virtualCollectorFiles(version);
  return executionCollectorSha256((path) => {
    const bytes = files.get(path);
    if (!bytes) return Promise.reject(new Error(`missing virtual collector file: ${path}`));
    return Promise.resolve(bytes);
  });
}

describe('M2 execution collector provenance', () => {
  it('binds the benchmark dataset version into the collector fingerprint', async () => {
    expect(EXECUTION_COLLECTOR_PATHS).toContain(VERSION_PATH);
    await expect(digestForVersion('0.3.0')).resolves.not.toBe(await digestForVersion('0.4.0'));
  });
});
