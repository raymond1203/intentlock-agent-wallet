import { readFileSync, readdirSync } from 'node:fs';

import { decodeFunctionData } from 'viem';
import { describe, expect, it } from 'vitest';

import { minimumPrefixFunding } from '../../src/benchmark/execution-funding.js';
import { BenchmarkScenarioSchema, type BenchmarkScenario } from '../../src/benchmark/scenario.js';
import { BENCHMARK_DATASET_VERSION } from '../../src/benchmark/version.js';
import { AAVE_V3_ABI } from '../../src/effects/protocol-decoders.js';
import { minimumOutForSlippage } from '../../scripts/benchmark-quotes.js';
import { assertPinnedQuote } from '../../scripts/m2-execution/quotes.js';

const ACCOUNT = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const UINT256_MAX = (1n << 256n) - 1n;

const scenarios = ['transfer', 'swap', 'bridge', 'lending', 'batch'].flatMap((directory) =>
  readdirSync(`benchmark/scenarios/base/${directory}`)
    .filter((file) => file.endsWith('.json') && file !== 'coverage.json')
    .map((file) =>
      BenchmarkScenarioSchema.parse(
        JSON.parse(readFileSync(`benchmark/scenarios/base/${directory}/${file}`, 'utf8')),
      ),
    ),
);
const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));

function scenario(id: string): BenchmarkScenario {
  const value = byId.get(id);
  if (!value) throw new Error(`missing scenario ${id}`);
  return value;
}

describe('M2 dataset v0.4 correction policy', () => {
  it('pins every one of the 38 swap effects and implements the 100bps floor exactly', () => {
    const swaps = scenarios.flatMap((scenario) =>
      scenario.trace.expectedEffects
        .filter((effect) => effect.kind === 'SWAP')
        .map((effect) => ({ scenario, effect })),
    );
    expect(swaps).toHaveLength(38);
    for (const { scenario: value, effect } of swaps) {
      const reference = value.fixture?.quoteReferences?.find(
        (candidate) =>
          candidate.chainId === effect.chainId &&
          candidate.amountIn === effect.amountIn &&
          candidate.quotedAmountOut === effect.quotedAmountOut,
      );
      expect(reference).toBeDefined();
      expect(reference?.maxSlippageBps).toBe(100);
      expect(effect.minAmountOut).toBe(
        minimumOutForSlippage(BigInt(effect.quotedAmountOut ?? '0'), 100).toString(),
      );
      expect(reference?.minAmountOut).toBe(effect.minAmountOut);
    }
  });

  it('fails execution preflight when QuoterV2 provenance or output drifts', () => {
    const reference = scenario('SS-01').fixture?.quoteReferences?.[0];
    if (!reference) throw new Error('SS-01 quote reference missing');
    const observed = {
      chainId: reference.chainId,
      blockNumber: reference.blockNumber.toString(),
      blockHash: reference.blockHash,
      quoter: reference.quoter,
      pools: reference.pools,
      path: reference.path,
      amountIn: reference.amountIn,
      authoredMinimum: reference.minAmountOut,
      quotedAmountOut: reference.quotedAmountOut,
    };
    expect(assertPinnedQuote(observed, [reference])).toEqual(reference);
    expect(() => assertPinnedQuote({ ...observed, quotedAmountOut: '1' }, [reference])).toThrow(
      'runtime QuoterV2 observation disagrees',
    );
  });

  it('uses delta references without fabricated protocol or router balance absolutes', () => {
    for (const value of scenarios) {
      expect(value.oracle.referenceMode).toBe('DELTA');
      expect(value.oracle.expectedDeltas.length).toBeGreaterThan(0);
      for (const row of [...value.oracle.preState, ...value.oracle.postState]) {
        if (row.field !== 'BALANCE') continue;
        expect([ACCOUNT, RECIPIENT]).toContain(row.subject.toLowerCase());
      }
    }
  });

  it('models Permit2 SignatureTransfer as account-spent one-use authority', () => {
    for (const id of ['AP-04', 'AP-08']) {
      const value = scenario(id);
      const authorization = value.trace.expectedEffects.find(
        (effect) => effect.kind === 'APPROVAL',
      );
      expect(authorization?.kind).toBe('APPROVAL');
      if (authorization?.kind !== 'APPROVAL') continue;
      expect(authorization.spender.toLowerCase()).toBe(ACCOUNT);
      expect(authorization.signatureDeadline).toBeDefined();
      expect(authorization.expiration).toBeUndefined();
      expect(value.oracle.postState.some((row) => row.field === 'ALLOWANCE')).toBe(false);
    }
  });

  it('funds every ordered prefix and fixes LE-09, LE-10, and LE-15 at the authored source', () => {
    for (const value of scenarios) {
      const needed = minimumPrefixFunding(value.intent.account, value.trace.expectedEffects);
      for (const [key, amount] of needed) {
        const [chainId, asset] = key.split(':');
        const row = value.oracle.preState.find(
          (candidate) =>
            candidate.field === 'BALANCE' &&
            candidate.chainId === Number(chainId) &&
            candidate.subject.toLowerCase() === ACCOUNT &&
            candidate.asset?.toLowerCase() === asset,
        );
        expect(BigInt(row?.value ?? '-1')).toBeGreaterThanOrEqual(amount);
      }
    }
    for (const id of ['LE-09', 'LE-10', 'LE-15']) {
      const value = scenario(id);
      const needed = minimumPrefixFunding(value.intent.account, value.trace.expectedEffects);
      for (const [key, amount] of needed) {
        const [chainId, asset] = key.split(':');
        const row = value.oracle.preState.find(
          (candidate) =>
            candidate.field === 'BALANCE' &&
            candidate.chainId === Number(chainId) &&
            candidate.asset?.toLowerCase() === asset,
        );
        expect(row?.value).toBe(amount.toString());
      }
    }
  });

  it('uses full-debt max repayment only for LE-13 and buffers principal-only residuals', () => {
    const lending = scenarios.filter((value) => value.workflow === 'LENDING');
    const maxRepayActions = lending.flatMap((value) =>
      value.trace.actions.flatMap((action) => {
        if (action.selector !== '0x573ade81') return [];
        const decoded = decodeFunctionData({
          abi: AAVE_V3_ABI,
          data: action.calldata as `0x${string}`,
        });
        return decoded.functionName === 'repay' && decoded.args[1] === UINT256_MAX
          ? [value.id]
          : [];
      }),
    );
    expect(maxRepayActions).toEqual(['LE-13']);
    const full = scenario('LE-13');
    expect(full.intent.finalStateGoals).toContainEqual(
      expect.objectContaining({ kind: 'MAX_DEBT', maxAmount: '0' }),
    );
    expect(
      full.trace.expectedEffects.some(
        (effect) => effect.kind === 'APPROVAL' && effect.amount === '60010000',
      ),
    ).toBe(true);
    expect(full.intent.safety.assetBudgets).toContainEqual(
      expect.objectContaining({ maxGrossOutflow: '100010000' }),
    );
    expect(full.oracle.expectedDeltas).toContainEqual(
      expect.objectContaining({ field: 'BALANCE', comparison: 'AT_LEAST', delta: '-10000' }),
    );
    for (const id of ['LE-06', 'LE-15'])
      expect(scenario(id).intent.finalStateGoals).toContainEqual(
        expect.objectContaining({ kind: 'MAX_DEBT', maxAmount: '10000' }),
      );
  });

  it('applies the same one-unit-per-operation Aave position rule on both chains', () => {
    for (const value of scenarios.filter((candidate) => candidate.workflow === 'LENDING')) {
      for (const goal of value.intent.finalStateGoals) {
        if (goal.kind !== 'MIN_POSITION_DELTA') continue;
        const changes = value.trace.expectedEffects.filter(
          (effect) =>
            effect.kind === 'POSITION' &&
            effect.chainId === goal.chainId &&
            effect.asset.toLowerCase() === goal.asset.toLowerCase(),
        );
        const net = changes.reduce((sum, effect) => {
          if (effect.kind !== 'POSITION') return sum;
          return sum + BigInt(effect.delta);
        }, 0n);
        expect(goal.minIncrease).toBe((net - BigInt(changes.length)).toString());
      }
    }
  });

  it('publishes dataset version 0.4.0 without claiming a frozen holdout', () => {
    const manifest = JSON.parse(readFileSync('benchmark/splits/manifest.json', 'utf8')) as {
      datasetVersion: string;
      frozen: boolean;
    };
    expect(manifest.datasetVersion).toBe(BENCHMARK_DATASET_VERSION);
    expect(manifest.frozen).toBe(false);
  });
});
