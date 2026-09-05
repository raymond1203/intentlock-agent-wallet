/**
 * Integration tests for the fixed-fork harness (issue #15).
 *
 * These require Anvil and an archive-capable upstream RPC, so they are skipped
 * unless the fork RPC environment variable is present. CI runs the unit suite
 * only; the reviewer reproduces this suite locally.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { AnvilFork, ForkHarnessError, loadForkConfig } from '../../scripts/anvil-harness.ts';

const config = loadForkConfig('experiments/configs/forks/ethereum-25773000.json');
const hasUpstream = (process.env[config.rpcEnvVar] ?? '') !== '';

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const HOLDER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

async function stopIfStarted(value: AnvilFork | undefined): Promise<void> {
  if (value) await value.stop();
}

describe.skipIf(!hasUpstream)('AnvilFork against the pinned Ethereum fork', () => {
  let fork: AnvilFork;

  beforeAll(async () => {
    fork = await AnvilFork.start(config);
  }, 120_000);

  afterAll(async () => {
    await stopIfStarted(fork);
  });

  it('matches the frozen chain, block, and manifest codehashes', async () => {
    const fingerprint = await fork.healthcheck();
    expect(fingerprint.chainId).toBe(config.chainId);
    expect(fingerprint.blockNumber).toBe(config.forkBlockNumber);
    expect(fingerprint.blockHash.toLowerCase()).toBe(config.forkBlockHash.toLowerCase());
    expect(fingerprint.contracts.length).toBeGreaterThan(0);
  });

  it('produces the same fingerprint on repeated healthchecks', async () => {
    const first = await fork.healthcheck();
    const second = await fork.healthcheck();
    expect(second.digest).toBe(first.digest);
  });

  it('restores state after snapshot and revert', async () => {
    const snapshot = await fork.snapshot();
    await fork.setBalance(HOLDER, 12345n);
    expect(await fork.getBalance(HOLDER)).toBe(12345n);
    await fork.revert(snapshot);
    expect(await fork.getBalance(HOLDER)).not.toBe(12345n);
  });

  it('funds an ERC-20 balance without a whale address', async () => {
    const snapshot = await fork.snapshot();
    const amount = 1_000_000_000n;
    const slot = await fork.dealErc20(USDC, HOLDER, amount);
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(await fork.erc20BalanceOf(USDC, HOLDER)).toBe(amount);
    await fork.revert(snapshot);
  }, 60_000);

  it('locates the real balance slot even when the requested balance is unchanged', async () => {
    const snapshot = await fork.snapshot();
    const amount = await fork.erc20BalanceOf(USDC, HOLDER);
    const slot = await fork.dealErc20(USDC, HOLDER, amount);
    expect(slot).toBeGreaterThan(0);
    expect(await fork.erc20BalanceOf(USDC, HOLDER)).toBe(amount);
    await fork.revert(snapshot);
  }, 60_000);

  it('advances time on request', async () => {
    const snapshot = await fork.snapshot();
    await fork.increaseTime(3600);
    await fork.revert(snapshot);
  });

  it('fails closed on a wrong block hash', async () => {
    const corrupted = {
      ...config,
      forkBlockHash: `0x${'11'.repeat(32)}`,
    };
    await expect(AnvilFork.start({ ...corrupted, port: config.port + 20 })).rejects.toBeInstanceOf(
      ForkHarnessError,
    );
  }, 120_000);
});

describe('fork configuration', () => {
  it('pins chain, block, and block hash', () => {
    expect(config.chainId).toBe(1);
    expect(config.forkBlockNumber).toBe(25773000);
    expect(config.forkBlockHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('requires an explicit upstream RPC environment variable', async () => {
    const saved = process.env[config.rpcEnvVar] ?? '';
    process.env[config.rpcEnvVar] = '';
    try {
      await expect(AnvilFork.start(config)).rejects.toThrow(/is not set/);
    } finally {
      process.env[config.rpcEnvVar] = saved;
    }
  });
});
