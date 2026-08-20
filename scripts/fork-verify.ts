/**
 * Determinism check for the fixed-fork harness (issue #15).
 *
 * Starts and stops the fork N times and asserts that every run observes the
 * same chain id, block number, block hash, and manifest codehashes. Prints the
 * fingerprint digest so two team members can compare runs without sharing logs
 * that contain RPC URLs.
 *
 * Usage:
 *   node scripts/fork-verify.ts experiments/configs/forks/ethereum-25773000.json 10
 */
import { AnvilFork, loadForkConfig, type Fingerprint } from './anvil-harness.ts';

async function main(): Promise<void> {
  const configPath = process.argv[2];
  if (configPath === undefined) {
    process.stderr.write('usage: node scripts/fork-verify.ts <fork-config.json> [runs]\n');
    process.exitCode = 2;
    return;
  }
  const runs = Number(process.argv[3] ?? '10');
  const config = loadForkConfig(configPath);

  process.stdout.write(
    `fork ${config.id} chain=${String(config.chainId)} block=${String(config.forkBlockNumber)} runs=${String(runs)}\n`,
  );

  const digests: string[] = [];
  for (let run = 1; run <= runs; run += 1) {
    const started = Date.now();
    const fork = await AnvilFork.start(config);
    let fingerprint: Fingerprint;
    try {
      fingerprint = await fork.healthcheck();
    } finally {
      await fork.stop();
    }
    digests.push(fingerprint.digest);
    process.stdout.write(
      `  run ${String(run).padStart(2, ' ')}: digest=${fingerprint.digest} contracts=${String(fingerprint.contracts.length)} ${String(Date.now() - started)}ms\n`,
    );
  }

  const unique = new Set(digests);
  if (unique.size !== 1) {
    process.stderr.write(
      `FAIL: ${String(unique.size)} distinct digests across ${String(runs)} runs\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`OK: ${String(runs)} runs produced one digest ${digests[0] ?? ''}\n`);
}

await main();
