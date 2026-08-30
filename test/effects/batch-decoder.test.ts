import {
  encodeAbiParameters,
  encodeFunctionData,
  parseAbiParameters,
  type Address,
  type Hex,
} from 'viem';
import { describe, expect, it } from 'vitest';

import {
  decodeBatchCalldata,
  ERC7821_ABI,
  type BatchDecoderOptions,
} from '../../src/effects/batch-decoder.js';
import { ERC20_ABI } from '../../src/effects/erc20-decoder.js';
import { SWAP_ROUTER_02_ABI } from '../../src/effects/swap-decoder.js';

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const ATTACKER = '0x3333333333333333333333333333333333333333';
const BATCH = '0x4444444444444444444444444444444444444444';
const TOKEN = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const ROUTER = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45';
const BATCH_MODE: Hex = `0x${'01000000000000000000'.padEnd(64, '0')}`;
const CALLS_ABI = parseAbiParameters('(address to, uint256 value, bytes data)[]');

interface EncodedCall {
  to: `0x${string}`;
  value: bigint;
  data: Hex;
}

function execute(calls: EncodedCall[], mode: Hex = BATCH_MODE): Hex {
  const executionData = encodeAbiParameters(CALLS_ABI, [calls]);
  return encodeFunctionData({
    abi: ERC7821_ABI,
    functionName: 'execute',
    args: [mode, executionData],
  });
}

function approve(spender: Address = ROUTER, amount = 100n): Hex {
  return encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [spender, amount],
  });
}

function exactInputSingle(recipient: Address = RECIPIENT, minimum = 990n): Hex {
  return encodeFunctionData({
    abi: SWAP_ROUTER_02_ABI,
    functionName: 'exactInputSingle',
    args: [
      {
        tokenIn: TOKEN,
        tokenOut: WETH,
        fee: 500,
        recipient,
        amountIn: 1000n,
        amountOutMinimum: minimum,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });
}

function options(overrides: Partial<BatchDecoderOptions> = {}): BatchDecoderOptions {
  return {
    contracts: {
      [BATCH]: { kind: 'ERC7821' },
      [TOKEN]: {
        kind: 'ERC20',
        codehash: '0xd80d4b7c890cb9d6a4893e6b52bc34b56b25335cb13716e0d1d31383e6b41505',
      },
      [ROUTER]: {
        kind: 'SWAP_ROUTER_02',
        codehash: '0x6ec798e80f3a19de650826338677604e54d6664f44a33b53a20b22b1939f402e',
      },
    },
    quotedAmountOut: '1000',
    ...overrides,
  };
}

function decode(data: Hex, decoderOptions = options()) {
  return decodeBatchCalldata({ chainId: 1, target: BATCH, caller: ACCOUNT, data }, decoderOptions);
}

describe('recursive ERC-7821 and SwapRouter02 decoder', () => {
  it('decodes a three-level nested batch and retains call paths', () => {
    const level3 = execute([{ to: TOKEN, value: 0n, data: approve() }]);
    const level2 = execute([{ to: BATCH, value: 0n, data: level3 }]);
    const level1 = execute([{ to: BATCH, value: 0n, data: level2 }]);
    const result = decode(level1);
    expect(result.status).toBe('COMPLETE');
    expect(result.root.children[0]?.children[0]?.children[0]?.effects[0]).toMatchObject({
      kind: 'APPROVAL',
      spender: ROUTER,
      amount: '100',
      provenance: { callPath: [0, 0, 0] },
    });
  });

  it('detects a hidden unlimited approval inside a batch', () => {
    const result = decode(
      execute([{ to: TOKEN, value: 0n, data: approve(ATTACKER, (1n << 256n) - 1n) }]),
    );
    expect(result.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'APPROVAL',
          spender: ATTACKER,
          amount: ((1n << 256n) - 1n).toString(),
        }),
      ]),
    );
  });

  it('extracts swap recipient, assets, amount and minimum output', () => {
    const result = decode(execute([{ to: ROUTER, value: 0n, data: exactInputSingle() }]));
    expect(result.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'SWAP',
          assetIn: TOKEN,
          assetOut: WETH,
          recipient: RECIPIENT,
          amountIn: '1000',
          minAmountOut: '990',
          quotedAmountOut: '1000',
        }),
      ]),
    );
  });

  it('makes a hidden swap recipient substitution visible', () => {
    const result = decode(execute([{ to: ROUTER, value: 0n, data: exactInputSingle(ATTACKER) }]));
    expect(result.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'SWAP', recipient: ATTACKER })]),
    );
  });

  it('inherits a router multicall deadline into the swap effect', () => {
    const multicall = encodeFunctionData({
      abi: SWAP_ROUTER_02_ABI,
      functionName: 'multicall',
      args: [2000n, [exactInputSingle()]],
    });
    const result = decode(execute([{ to: ROUTER, value: 0n, data: multicall }]));
    expect(result.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'SWAP', deadline: '2000' })]),
    );
  });

  it('fails closed when the recursion limit is exceeded', () => {
    const nested = execute([
      {
        to: BATCH,
        value: 0n,
        data: execute([
          { to: BATCH, value: 0n, data: execute([{ to: TOKEN, value: 0n, data: approve() }]) },
        ]),
      },
    ]);
    const result = decode(nested, options({ maxDepth: 1 }));
    expect(result.status).toBe('PARTIAL');
    expect(result.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'UNKNOWN', reason: 'maximum decode depth exceeded' }),
      ]),
    );
  });

  it('fails closed when the decoded call-count limit is exceeded', () => {
    const result = decode(
      execute([
        { to: TOKEN, value: 0n, data: approve() },
        { to: TOKEN, value: 0n, data: approve() },
      ]),
      options({ maxCalls: 2 }),
    );
    expect(result.status).toBe('PARTIAL');
    expect(result.effects.some((effect) => effect.kind === 'UNKNOWN')).toBe(true);
  });

  it('fails closed when calldata exceeds the byte limit', () => {
    expect(
      decode(
        execute([{ to: TOKEN, value: 0n, data: approve() }]),
        options({ maxCalldataBytes: 4 }),
      ),
    ).toMatchObject({
      status: 'UNKNOWN',
      effects: [
        expect.objectContaining({ kind: 'UNKNOWN', reason: 'maximum calldata size exceeded' }),
      ],
    });
  });

  it('fails closed for an unsupported execution mode', () => {
    const unsupported: Hex = `0x${'ff'.padEnd(64, '0')}`;
    expect(decode(execute([{ to: TOKEN, value: 0n, data: approve() }], unsupported))).toMatchObject(
      {
        status: 'UNKNOWN',
        effects: [
          expect.objectContaining({ kind: 'UNKNOWN', reason: 'unsupported ERC-7821 mode' }),
        ],
      },
    );
  });

  it('fails closed for a target without a pinned decoder', () => {
    expect(decode(execute([{ to: ATTACKER, value: 0n, data: '0xdeadbeef' }]))).toMatchObject({
      status: 'PARTIAL',
      effects: [
        expect.objectContaining({ kind: 'UNKNOWN', reason: 'target has no pinned decoder' }),
      ],
    });
  });

  it('fails closed on codehash mismatch', () => {
    const result = decode(
      execute([{ to: TOKEN, value: 0n, data: approve() }]),
      options({
        requireCodehash: true,
        observedCodehashes: {
          [TOKEN]: `0x${'0'.repeat(64)}`,
        },
      }),
    );
    expect(result.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'UNKNOWN',
          reason: 'codehash does not match pinned decoder',
        }),
      ]),
    );
  });

  it('accepts pinned codehashes from the fork manifest', () => {
    const result = decode(
      execute([{ to: TOKEN, value: 0n, data: approve() }]),
      options({
        requireCodehash: true,
        observedCodehashes: {
          [BATCH]: `0x${'1'.repeat(64)}`,
          [TOKEN]: '0xd80d4b7c890cb9d6a4893e6b52bc34b56b25335cb13716e0d1d31383e6b41505',
        },
      }),
    );
    expect(result.status).toBe('COMPLETE');
  });
});
