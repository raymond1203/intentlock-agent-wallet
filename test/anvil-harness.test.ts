import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import { encodeAbiParameters, keccak256, numberToHex, pad, type Hex } from 'viem';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AnvilFork,
  parseForkUrls,
  redactSensitiveText,
  sanitizeExecutionFailure,
  summarizeRpcFailure,
  type ForkConfig,
} from '../scripts/anvil-harness.ts';

const TOKEN = '0x0000000000000000000000000000000000000001';
const HOLDER = '0x0000000000000000000000000000000000000002';

function mappingKey(slot: number): Hex {
  return keccak256(
    encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [HOLDER, BigInt(slot)]),
  );
}

describe('redactSensitiveText', () => {
  it('accepts distinct HTTP(S) fork upstreams', () => {
    expect(
      parseForkUrls(
        'https://a.example.test/key, https://b.example.test/key,https://a.example.test/key',
      ),
    ).toEqual(['https://a.example.test/key', 'https://b.example.test/key']);
    expect(() => parseForkUrls('')).toThrow(/at least one/);
    expect(() => parseForkUrls('file:///private')).toThrow(/HTTP/);
    expect(() => parseForkUrls('not-a-url-with-a-secret')).toThrow(
      'fork RPC URL must be a valid HTTP(S) URL',
    );
  });
  it('does not expose upstream URLs or HTML in RPC failures', () => {
    expect(summarizeRpcFailure('HTTP 429 <html>client address and token</html>')).toBe(
      'upstream rate limit',
    );
    expect(summarizeRpcFailure('Transport(Custom("https://rpc.test/secret"))')).toBe(
      'upstream RPC failure (details withheld)',
    );
    expect(summarizeRpcFailure('timeout with private diagnostics')).toBe('upstream timeout');
    expect(summarizeRpcFailure('state at old block is pruned')).toBe(
      'upstream archive state unavailable',
    );
    expect(summarizeRpcFailure('invalid argument plus token')).toBe(
      'upstream RPC failure (details withheld)',
    );
    expect(
      sanitizeExecutionFailure('Unauthorized api key project-secret', ['project-secret']),
    ).toBe('upstream RPC failure (details withheld)');
    expect(sanitizeExecutionFailure('unsupported fixture chain')).toBe('unsupported fixture chain');
  });
  it('removes the exact upstream value from child diagnostics', () => {
    const secret = 'https://rpc.example.test/project-secret';
    const output = redactSensitiveText(`failed to connect to ${secret}`, [secret]);

    expect(output).toBe('failed to connect to [REDACTED_RPC_URL]');
    expect(output).not.toContain('project-secret');
  });
});

describe('AnvilFork.dealErc20', () => {
  let closeServer: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await closeServer?.();
    closeServer = undefined;
  });

  it('proves the balance slot with a sentinel before accepting a no-op amount', async () => {
    const unrelatedKey = mappingKey(0);
    const balanceKey = mappingKey(1);
    const storage = new Map<string, Hex>([
      [unrelatedKey, pad(numberToHex(777n), { size: 32 })],
      [balanceKey, pad(numberToHex(123n), { size: 32 })],
    ]);

    const server = createServer((incoming, response) => {
      let requestBody = '';
      incoming.on('data', (chunk: Buffer) => {
        requestBody += chunk.toString();
      });
      incoming.on('end', () => {
        const payload = JSON.parse(requestBody) as {
          id: number;
          method: string;
          params: unknown[];
        };
        let result: unknown;
        if (payload.method === 'eth_getStorageAt') {
          const key = String(payload.params[1]);
          result = storage.get(key) ?? pad(numberToHex(0), { size: 32 });
        } else if (payload.method === 'anvil_setStorageAt') {
          storage.set(String(payload.params[1]), String(payload.params[2]) as Hex);
          result = null;
        } else if (payload.method === 'eth_call') {
          result = storage.get(balanceKey) ?? pad(numberToHex(0), { size: 32 });
        } else {
          throw new Error(`unexpected method ${payload.method}`);
        }
        const responseBody = JSON.stringify({ jsonrpc: '2.0', id: payload.id, result });
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(responseBody);
      });
    });
    await new Promise<void>((resolveResult) => server.listen(0, '127.0.0.1', resolveResult));
    closeServer = async () =>
      new Promise<void>((resolveResult) =>
        server.close(() => {
          resolveResult();
        }),
      );
    const port = (server.address() as AddressInfo).port;

    const config: ForkConfig = {
      id: 'unit-test',
      chainId: 1,
      name: 'unit-test',
      role: 'unit-test',
      forkBlockNumber: 1,
      forkBlockHash: `0x${'00'.repeat(32)}`,
      forkBlockTimestamp: 1,
      port,
      rpcEnvVar: 'UNUSED',
      manifestChainKey: 'unused',
      decisionRecord: 'unused',
    };
    const child = Object.assign(new EventEmitter(), {
      stderr: new PassThrough(),
      exitCode: null,
      signalCode: null,
    });
    const TestConstructor = AnvilFork as unknown as new (
      config: ForkConfig,
      childProcess: typeof child,
      sensitiveValues: readonly string[],
    ) => AnvilFork;
    const fork = new TestConstructor(config, child, []);

    const slot = await fork.dealErc20(TOKEN, HOLDER, 123n, 2);

    expect(slot).toBe(1);
    expect(BigInt(storage.get(unrelatedKey) ?? '0x0')).toBe(777n);
    expect(BigInt(storage.get(balanceKey) ?? '0x0')).toBe(123n);
  });
});
