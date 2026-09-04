import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// Files whose contents can change the executed transaction, observed state, or oracle result.
// Documentation and published evidence are intentionally excluded so evidence can be committed
// after a clean collector run without invalidating that run's collector identity.
export const EXECUTION_COLLECTOR_PATHS = [
  'benchmark/fixtures/manifest.json',
  'foundry.toml',
  'contracts/src/M2FixtureAccount.sol',
  'experiments/configs/forks/base-50080000.json',
  'experiments/configs/forks/ethereum-25773000.json',
  'package.json',
  'pnpm-lock.yaml',
  'scripts/anvil-harness.ts',
  'scripts/extended-benchmark.ts',
  'scripts/m2-execution/bridge.ts',
  'scripts/m2-execution/lending.ts',
  'scripts/m2-execution/permit.ts',
  'scripts/m2-execution/provenance.ts',
  'scripts/m2-execution/quotes.ts',
  'scripts/m2-execution/receipt-requirements.ts',
  'scripts/m2-execution/runtime.ts',
  'scripts/run-m2-execution.ts',
  'scripts/source-integrity.ts',
  'src/benchmark/execution-funding.ts',
  'src/benchmark/scenario.ts',
  'src/domain/action-ir.ts',
  'src/domain/intent-contract.ts',
  'src/domain/required.ts',
  'src/effects/batch-decoder.ts',
  'src/effects/erc20-decoder.ts',
  'src/effects/permit2-decoder.ts',
  'src/effects/protocol-decoders.ts',
  'src/effects/swap-decoder.ts',
  'src/effects/types.ts',
  'src/oracle/post-state-oracle.ts',
  'src/oracle/receipt-accounting.ts',
  'tsconfig.json',
] as const;

export async function executionCollectorSha256(): Promise<string> {
  const digest = createHash('sha256');
  for (const path of EXECUTION_COLLECTOR_PATHS) {
    const bytes = await readFile(path);
    digest.update(path);
    digest.update('\0');
    digest.update(createHash('sha256').update(bytes).digest('hex'));
    digest.update('\n');
    if (path.endsWith('.ts')) {
      const runtimePath = `dist/${path.slice(0, -3)}.js`;
      const runtimeBytes = await readFile(runtimePath).catch(() => {
        throw new Error('collector build is missing; run pnpm build before execution');
      });
      digest.update(runtimePath);
      digest.update('\0');
      digest.update(createHash('sha256').update(runtimeBytes).digest('hex'));
      digest.update('\n');
    }
  }
  return digest.digest('hex');
}
