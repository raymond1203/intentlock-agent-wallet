import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { decodeFunctionData, keccak256, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';

import {
  computeM1StableDecisionDigest,
  M1GoldenEvidenceSchema,
  M1GoldenFixtureSchema,
  type M1GoldenEvidence,
  validateM1GoldenEvidence,
} from '../../src/benchmark/m1-golden-evidence.js';

const ROOT = resolve(import.meta.dirname, '../..');
const fixtureRaw = readFileSync(resolve(ROOT, 'benchmark/scenarios/golden/scenarios.json'), 'utf8');
const fixture = M1GoldenFixtureSchema.parse(JSON.parse(fixtureRaw));
const fixtureSha256 = createHash('sha256').update(fixtureRaw).digest('hex');
const POOL = fixture.addresses.poolUsdcWeth500;
const POOL_HASH = fixture.codehashes.poolUsdcWeth500;
const MUTATED_HASH = `0x${'77'.repeat(32)}`;
const SWAP_ABI = [
  {
    type: 'function',
    name: 'exactInputSingle',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
] as const;

function evidence(): M1GoldenEvidence {
  const scenarios: M1GoldenEvidence['scenarios'] = fixture.scenarios.map((scenario, index) => {
    const allowed = scenario.expectedDecision === 'ALLOW';
    const swap = scenario.id === 'G05-bounded-swap';
    const drift = scenario.codehashDrift === true;
    return {
      scenarioId: scenario.id,
      class: scenario.class,
      expectedDecision: scenario.expectedDecision,
      observedDecision: scenario.expectedDecision,
      expectedCode: scenario.expectedCode ?? null,
      observedCode: scenario.expectedCode ?? null,
      adapterStatus: allowed ? 'EXECUTED_VERIFIED' : 'BLOCKED',
      signerInvoked: allowed,
      signerCallCount: allowed ? 1 : 0,
      setupTransactionHashes: [],
      transaction: allowed
        ? {
            hash: `0x${String(index + 1).padStart(64, '0')}`,
            status: 'SUCCESS',
            blockNumber: fixture.fork.blockNumber + 1,
            blockHash: `0x${'66'.repeat(32)}`,
            gasUsedWei: '1',
          }
        : null,
      intentHash: `0x${'11'.repeat(32)}`,
      auditLogId: `0x${'22'.repeat(32)}`,
      reservationId: allowed ? `reservation-${scenario.id}` : null,
      effectMismatchCount: 0,
      rawTokenFlows: swap
        ? [
            {
              token: fixture.addresses.usdc,
              from: fixture.addresses.account,
              to: POOL,
              amount: '1000000',
              logIndex: 1,
            },
            {
              token: fixture.addresses.weth,
              from: POOL,
              to: fixture.addresses.recipient,
              amount: '526301279457898',
              logIndex: 2,
            },
          ]
        : [],
      swapProof: swap
        ? {
            quoter: fixture.addresses.quoterV2,
            quoterCodehash: fixture.codehashes.quoterV2,
            pool: POOL,
            poolCodehash: POOL_HASH,
            sourceCalldataHash: keccak256(scenario.data as Hex),
            quotedAmountOut: scenario.quotedAmountOut ?? '0',
            authoredMinimum: '521038266663319',
            actualAmountOut: '526301279457898',
            inputFlowLogIndex: 1,
            outputFlowLogIndex: 2,
            unexpectedAccountTokenFlowCount: 0,
          }
        : null,
      stateAssertions: [
        { name: 'test assertion', before: '0', after: '1', expected: '1', passed: true },
      ],
      normalizationBasis: allowed ? 'REAL_RECEIPT_AND_POST_STATE' : 'PINNED_FORK_SIGNER_BOUNDARY',
      runtimeCodehash: drift ? MUTATED_HASH : fixture.codehashes.usdc,
      fixtureMutation: drift
        ? {
            kind: 'ANVIL_SET_CODE',
            target: fixture.addresses.usdc,
            originalCodehash: fixture.codehashes.usdc,
            mutatedCodehash: MUTATED_HASH,
          }
        : null,
    };
  });
  const draft = M1GoldenEvidenceSchema.parse({
    schemaVersion: 'm1-golden-evidence-v1',
    generatedAt: '2026-09-04T12:00:00+09:00',
    source: {
      commitSha: 'a'.repeat(40),
      workingTreeDirty: false,
      runnerSha256: 'b'.repeat(64),
      fixtureSha256,
      toolchain: { node: 'v24.18.0', pnpm: '11.22.0', anvil: 'anvil 1.7.1' },
    },
    fork: {
      chainId: fixture.fork.chainId,
      blockNumber: fixture.fork.blockNumber,
      blockHash: fixture.fork.blockHash,
      fingerprintDigest: `0x${'55'.repeat(32)}`,
      contracts: [
        {
          key: 'usdc',
          address: fixture.addresses.usdc,
          codehash: fixture.codehashes.usdc,
        },
        {
          key: 'swapRouter02',
          address: fixture.addresses.swapRouter02,
          codehash: fixture.codehashes.swapRouter02,
        },
        { key: 'poolUsdcWeth500', address: POOL, codehash: POOL_HASH },
      ],
    },
    summary: {
      scenarioCount: 10,
      allowCount: 5,
      blockedCount: 5,
      realTransactionCount: 5,
      signerInvocationCount: 5,
      allMatched: true,
      stableDecisionDigest: `0x${'00'.repeat(32)}`,
    },
    scenarios,
  });
  return M1GoldenEvidenceSchema.parse({
    ...draft,
    summary: { ...draft.summary, stableDecisionDigest: computeM1StableDecisionDigest(draft) },
  });
}

function validate(value: unknown, requireClean = true): M1GoldenEvidence {
  return validateM1GoldenEvidence(value, fixture, { fixtureSha256, requireClean });
}

function resign(value: M1GoldenEvidence): M1GoldenEvidence {
  value.summary.stableDecisionDigest = computeM1StableDecisionDigest(value);
  return value;
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

describe('M1 Golden fixed-fork evidence gate', () => {
  it('pins the real G05 quote and its exact 100 bps minimum in calldata', () => {
    const scenario = required(
      fixture.scenarios.find((candidate) => candidate.id === 'G05-bounded-swap'),
      'missing G05 fixture',
    );
    const quote = BigInt(required(scenario.quotedAmountOut, 'missing G05 quote'));
    const minimum = (quote * 9_900n) / 10_000n;
    const decoded = decodeFunctionData({ abi: SWAP_ABI, data: scenario.data as Hex });

    expect(quote).toBe(526_301_279_457_898n);
    expect(minimum).toBe(521_038_266_663_319n);
    expect(decoded.args[0].amountOutMinimum).toBe(minimum);
  });

  it('accepts exactly five real receipts and five signer-gate blocks', () => {
    expect(validate(evidence()).summary).toMatchObject({
      allowCount: 5,
      blockedCount: 5,
      realTransactionCount: 5,
      signerInvocationCount: 5,
      allMatched: true,
    });
  });

  it('rejects an ALLOW case with no real receipt', () => {
    const value = evidence();
    value.scenarios[0] = {
      ...required(value.scenarios[0], 'missing first scenario'),
      transaction: null,
    };
    expect(() => validate(resign(value))).toThrow(/real receipt/);
  });

  it('rejects a blocked case that reached the signer', () => {
    const value = evidence();
    value.scenarios[5] = {
      ...required(value.scenarios[5], 'missing blocked scenario'),
      signerInvoked: true,
      signerCallCount: 1,
    };
    expect(() => validate(resign(value))).toThrow(/signer gate/);
  });

  it('rejects a swap normalized through the wrong pool', () => {
    const value = evidence();
    const swap = required(value.scenarios[4], 'missing swap scenario');
    const proof = required(swap.swapProof ?? undefined, 'missing swap proof');
    value.scenarios[4] = {
      ...swap,
      swapProof: { ...proof, pool: fixture.addresses.swapRouter02 },
    };
    expect(() => validate(resign(value))).toThrow(/pinned route/);
  });

  it('rejects codehash drift without a real local mutation proof', () => {
    const value = evidence();
    value.scenarios[9] = {
      ...required(value.scenarios[9], 'missing drift scenario'),
      fixtureMutation: null,
    };
    expect(() => validate(resign(value))).toThrow(/codehash drift/);
  });

  it('rejects dirty closeout evidence and a forged stable digest', () => {
    const dirty = evidence();
    dirty.source.workingTreeDirty = true;
    expect(() => validate(dirty)).toThrow(/clean worktree/);

    const forged = evidence();
    forged.summary.stableDecisionDigest = `0x${'99'.repeat(32)}`;
    expect(() => validate(forged)).toThrow(/stable decision digest/);
  });
});
