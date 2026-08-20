/**
 * Anvil fixed-fork harness (issue #15).
 *
 * Starts Anvil against a pinned fork block, verifies that the forked state
 * matches the frozen fixture manifest, and exposes snapshot/revert, time warp,
 * and deterministic account funding for integration tests.
 *
 * The upstream RPC URL is read from an environment variable and never logged.
 */
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { encodeAbiParameters, keccak256, numberToHex, pad, type Hex } from 'viem';
import { z } from 'zod';

const HexSchema = z.string().regex(/^0x[0-9a-fA-F]*$/, 'expected hex');
const Bytes32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'expected 32-byte hex');
const AddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'expected an EVM address');

export const ForkConfigSchema = z
  .object({
    id: z.string().min(1),
    chainId: z.number().int().positive(),
    name: z.string().min(1),
    role: z.string().min(1),
    forkBlockNumber: z.number().int().positive(),
    forkBlockHash: Bytes32Schema,
    forkBlockTimestamp: z.number().int().positive(),
    port: z.number().int().positive(),
    rpcEnvVar: z.string().min(1),
    manifestChainKey: z.string().min(1),
    decisionRecord: z.string().min(1),
  })
  .strict();

export type ForkConfig = z.infer<typeof ForkConfigSchema>;

type AnvilProcess = ChildProcessByStdio<null, Readable, Readable>;

const ManifestContractSchema = z.object({
  key: z.string(),
  address: AddressSchema,
  codehash: Bytes32Schema.optional(),
  codeSize: z.number().int().nonnegative().optional(),
});

const ManifestSchema = z.object({
  contracts: z.record(z.string(), z.array(ManifestContractSchema)),
});

export interface Fingerprint {
  chainId: number;
  blockNumber: number;
  blockHash: Hex;
  contracts: { key: string; address: string; codehash: Hex }[];
  digest: Hex;
}

export class ForkHarnessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForkHarnessError';
  }
}

const JsonRpcResponseSchema = z.union([
  z.object({ result: z.unknown() }),
  z.object({ error: z.object({ code: z.number(), message: z.string() }) }),
]);

let requestId = 0;

async function rpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  requestId += 1;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
  });
  if (!response.ok) {
    throw new ForkHarnessError(`${method} failed with HTTP ${String(response.status)}`);
  }
  const parsed = JsonRpcResponseSchema.parse(await response.json());
  if ('error' in parsed) {
    throw new ForkHarnessError(`${method} failed: ${parsed.error.message}`);
  }
  return parsed.result;
}

function repoRoot(): string {
  return resolve(import.meta.dirname, '..');
}

export function loadForkConfig(configPath: string): ForkConfig {
  const absolute = resolve(repoRoot(), configPath);
  return ForkConfigSchema.parse(JSON.parse(readFileSync(absolute, 'utf8')));
}

export function loadManifestContracts(
  chainKey: string,
): { key: string; address: string; codehash: Hex }[] {
  const manifestPath = resolve(repoRoot(), 'benchmark/fixtures/manifest.json');
  const manifest = ManifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
  const entries = manifest.contracts[chainKey];
  if (entries === undefined) {
    throw new ForkHarnessError(`manifest has no contracts for chain ${chainKey}`);
  }
  return entries
    .filter((entry) => entry.codehash !== undefined)
    .map((entry) => ({ key: entry.key, address: entry.address, codehash: entry.codehash as Hex }));
}

async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolveResult) => {
    const server = createServer();
    server.once('error', () => {
      resolveResult(false);
    });
    server.once('listening', () => {
      server.close(() => {
        resolveResult(true);
      });
    });
    server.listen(port, '127.0.0.1');
  });
}

async function wait(ms: number): Promise<void> {
  return new Promise((resolveResult) => {
    setTimeout(resolveResult, ms);
  });
}

export interface StartOptions {
  /** Milliseconds to wait for the fork to answer before giving up. */
  readyTimeoutMs?: number;
  /** Skip the manifest codehash comparison. Only for debugging. */
  skipManifestCheck?: boolean;
}

export class AnvilFork {
  readonly url: string;
  readonly config: ForkConfig;
  private readonly child: AnvilProcess;
  private readonly stderr: string[] = [];
  private stopped = false;

  private constructor(config: ForkConfig, child: AnvilProcess) {
    this.config = config;
    this.child = child;
    this.url = `http://127.0.0.1:${String(config.port)}`;
    this.child.stderr.on('data', (chunk: Buffer) => {
      this.stderr.push(chunk.toString());
    });
  }

  static async start(config: ForkConfig, options: StartOptions = {}): Promise<AnvilFork> {
    const upstream = process.env[config.rpcEnvVar];
    if (upstream === undefined || upstream === '') {
      throw new ForkHarnessError(
        `${config.rpcEnvVar} is not set. An archive-capable RPC is required; see ${config.decisionRecord}`,
      );
    }
    if (!(await isPortFree(config.port))) {
      throw new ForkHarnessError(`port ${String(config.port)} is already in use`);
    }

    const child = spawn(
      'anvil',
      [
        '--fork-url',
        upstream,
        '--fork-block-number',
        String(config.forkBlockNumber),
        '--port',
        String(config.port),
        '--silent',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    const fork = new AnvilFork(config, child);
    const cleanup = (): void => {
      void fork.stop();
    };
    process.once('exit', cleanup);

    try {
      await fork.waitUntilReady(options.readyTimeoutMs ?? 60_000);
      await fork.healthcheck({ skipManifestCheck: options.skipManifestCheck ?? false });
    } catch (error) {
      await fork.stop();
      throw error;
    }
    return fork;
  }

  private async waitUntilReady(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!this.isRunning()) {
        throw new ForkHarnessError(
          `anvil exited early with code ${String(this.child.exitCode)}: ${this.stderr.join('').slice(-400)}`,
        );
      }
      try {
        await rpc(this.url, 'eth_chainId', []);
        return;
      } catch {
        await wait(500);
      }
    }
    throw new ForkHarnessError(`anvil did not become ready within ${String(timeoutMs)}ms`);
  }

  /**
   * Fails closed when the fork does not match the frozen configuration:
   * wrong chain, wrong block, wrong block hash, or drifted contract code.
   */
  async healthcheck(options: { skipManifestCheck?: boolean } = {}): Promise<Fingerprint> {
    const chainId = Number(HexSchema.parse(await rpc(this.url, 'eth_chainId', [])));
    if (chainId !== this.config.chainId) {
      throw new ForkHarnessError(
        `chain id mismatch: expected ${String(this.config.chainId)}, got ${String(chainId)}`,
      );
    }

    const blockNumber = Number(HexSchema.parse(await rpc(this.url, 'eth_blockNumber', [])));
    if (blockNumber !== this.config.forkBlockNumber) {
      throw new ForkHarnessError(
        `block mismatch: expected ${String(this.config.forkBlockNumber)}, got ${String(blockNumber)}`,
      );
    }

    const block = z
      .object({ hash: Bytes32Schema, number: HexSchema })
      .parse(
        await rpc(this.url, 'eth_getBlockByNumber', [
          numberToHex(this.config.forkBlockNumber),
          false,
        ]),
      );
    if (block.hash.toLowerCase() !== this.config.forkBlockHash.toLowerCase()) {
      throw new ForkHarnessError(
        `block hash mismatch at ${String(this.config.forkBlockNumber)}: expected ${this.config.forkBlockHash}, got ${block.hash}`,
      );
    }

    const contracts: { key: string; address: string; codehash: Hex }[] = [];
    if (options.skipManifestCheck !== true) {
      for (const entry of loadManifestContracts(this.config.manifestChainKey)) {
        const code = HexSchema.parse(await rpc(this.url, 'eth_getCode', [entry.address, 'latest']));
        const observed = keccak256(code as Hex);
        if (observed.toLowerCase() !== entry.codehash.toLowerCase()) {
          throw new ForkHarnessError(
            `codehash mismatch for ${entry.key} (${entry.address}): expected ${entry.codehash}, got ${observed}`,
          );
        }
        contracts.push({ key: entry.key, address: entry.address, codehash: observed });
      }
    }

    const digest = keccak256(
      Buffer.from(
        JSON.stringify({
          chainId,
          blockNumber,
          blockHash: block.hash.toLowerCase(),
          contracts: contracts.map((c) => [
            c.key,
            c.address.toLowerCase(),
            c.codehash.toLowerCase(),
          ]),
        }),
        'utf8',
      ),
    );

    return { chainId, blockNumber, blockHash: block.hash as Hex, contracts, digest };
  }

  async snapshot(): Promise<Hex> {
    return HexSchema.parse(await rpc(this.url, 'evm_snapshot', [])) as Hex;
  }

  async revert(snapshotId: Hex): Promise<void> {
    const ok = z.boolean().parse(await rpc(this.url, 'evm_revert', [snapshotId]));
    if (!ok) {
      throw new ForkHarnessError(`evm_revert rejected snapshot ${snapshotId}`);
    }
  }

  async increaseTime(seconds: number): Promise<void> {
    await rpc(this.url, 'evm_increaseTime', [seconds]);
    await rpc(this.url, 'evm_mine', []);
  }

  async setBalance(address: string, wei: bigint): Promise<void> {
    await rpc(this.url, 'anvil_setBalance', [address, numberToHex(wei)]);
  }

  async getBalance(address: string): Promise<bigint> {
    return BigInt(HexSchema.parse(await rpc(this.url, 'eth_getBalance', [address, 'latest'])));
  }

  async erc20BalanceOf(token: string, holder: string): Promise<bigint> {
    const data = `0x70a08231${pad(holder as Hex, { size: 32 }).slice(2)}` as Hex;
    const raw = HexSchema.parse(await rpc(this.url, 'eth_call', [{ to: token, data }, 'latest']));
    return raw === '0x' ? 0n : BigInt(raw);
  }

  /**
   * Deterministic ERC-20 funding. Probes the balance mapping slot and writes
   * the amount directly, so fixtures never depend on a whale address whose
   * balance changes between blocks.
   */
  async dealErc20(token: string, holder: string, amount: bigint, maxSlot = 64): Promise<number> {
    const before = await this.erc20BalanceOf(token, holder);
    for (let slot = 0; slot < maxSlot; slot += 1) {
      const key = keccak256(
        encodeAbiParameters(
          [{ type: 'address' }, { type: 'uint256' }],
          [holder as Hex, BigInt(slot)],
        ),
      );
      const previous = HexSchema.parse(
        await rpc(this.url, 'eth_getStorageAt', [token, key, 'latest']),
      );
      await rpc(this.url, 'anvil_setStorageAt', [
        token,
        key,
        pad(numberToHex(amount), { size: 32 }),
      ]);
      if ((await this.erc20BalanceOf(token, holder)) === amount) {
        return slot;
      }
      await rpc(this.url, 'anvil_setStorageAt', [token, key, pad(previous as Hex, { size: 32 })]);
    }
    throw new ForkHarnessError(
      `could not locate the balance slot for ${token} within ${String(maxSlot)} slots (balance stayed ${String(before)})`,
    );
  }

  private isRunning(): boolean {
    return this.child.exitCode === null;
  }

  capturedStderr(): string {
    return this.stderr.join('');
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.isRunning()) {
      this.child.kill('SIGTERM');
      const killDeadline = Date.now() + 5_000;
      while (this.isRunning() && Date.now() < killDeadline) {
        await wait(100);
      }
      if (this.isRunning()) this.child.kill('SIGKILL');
    }
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (await isPortFree(this.config.port)) return;
      await wait(100);
    }
    throw new ForkHarnessError(`port ${String(this.config.port)} was not released`);
  }
}
