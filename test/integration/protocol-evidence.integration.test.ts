import { mkdir, writeFile } from 'node:fs/promises';
import { createPublicClient, createWalletClient, encodeFunctionData, http } from 'viem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AnvilFork, loadForkConfig } from '../../scripts/anvil-harness.ts';
import {
  BENCHMARK_ACCOUNT,
  decoderOptions,
  fixtureAddress,
} from '../../scripts/extended-benchmark.js';
import { AAVE_V3_ABI } from '../../src/effects/protocol-decoders.js';
import { decodeErc20Log, ERC20_ABI } from '../../src/effects/erc20-decoder.js';
import { evaluatePostState, type StateObservation } from '../../src/oracle/post-state-oracle.js';
import { required } from '../../src/domain/required.js';
import type { IntentContract } from '../../src/domain/intent-contract.js';

for (const filename of ['ethereum-25773000', 'base-50080000']) {
  const original = loadForkConfig(`experiments/configs/forks/${filename}.json`);
  const config = { ...original, port: original.port + 30 };
  describe.skipIf(!process.env[config.rpcEnvVar])(
    `${filename}: representative Aave execution evidence`,
    () => {
      let fork: AnvilFork | undefined;
      beforeAll(async () => {
        fork = await AnvilFork.start(config);
      }, 120_000);
      afterAll(async () => {
        await fork?.stop();
      });
      it('collects actual supply receipts, balance/position state, and exact oracle output', async () => {
        const local = required(fork);
        const snapshot = await local.snapshot();
        try {
          const chainId = config.chainId;
          const token = fixtureAddress(chainId, 'usdc');
          const pool = fixtureAddress(chainId, 'aaveV3Pool');
          const reserve = required(
            decoderOptions(chainId).lendingReserves?.find(
              (r) => r.asset.toLowerCase() === token.toLowerCase(),
            ),
          );
          const initial = 100_000_000n,
            amount = 10_000_000n;
          await local.dealErc20(token, BENCHMARK_ACCOUNT, initial);
          const positionBefore = await local.erc20BalanceOf(reserve.aToken, BENCHMARK_ACCOUNT);
          const client = createPublicClient({ transport: http(local.url) });
          const wallet = createWalletClient({
            account: BENCHMARK_ACCOUNT,
            transport: http(local.url),
          });
          const sent = [];
          for (const [to, data] of [
            [
              token,
              encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [pool, amount] }),
            ],
            [
              pool,
              encodeFunctionData({
                abi: AAVE_V3_ABI,
                functionName: 'supply',
                args: [token, amount, BENCHMARK_ACCOUNT, 0],
              }),
            ],
          ] as const) {
            const hash = await wallet.sendTransaction({ chain: null, to, data });
            sent.push(await client.waitForTransactionReceipt({ hash }));
          }
          expect(sent.every((r) => r.status === 'success')).toBe(true);
          const balanceAfter = await local.erc20BalanceOf(token, BENCHMARK_ACCOUNT);
          const positionAfter = await local.erc20BalanceOf(reserve.aToken, BENCHMARK_ACCOUNT);
          expect(balanceAfter).toBe(initial - amount);
          expect(positionAfter).toBeGreaterThan(positionBefore);
          const state = (
            field: 'BALANCE' | 'POSITION',
            value: bigint,
            source: StateObservation['source'],
          ): StateObservation => ({
            chainId,
            subject: BENCHMARK_ACCOUNT,
            asset: token,
            field,
            value: value.toString(),
            source,
            ...(field === 'POSITION' ? { counterparty: pool } : {}),
          });
          const pre = [
            state('BALANCE', initial, 'FIXED_FORK'),
            state('POSITION', positionBefore, 'FIXED_FORK'),
          ];
          const post = [
            state('BALANCE', balanceAfter, 'POST_STATE'),
            state('POSITION', positionAfter, 'POST_STATE'),
          ];
          const contract: IntentContract = {
            version: '0.1',
            account: BENCHMARK_ACCOUNT,
            nonce: '0',
            idempotencyKey: 'protocol-smoke',
            safety: {
              chainScopes: [
                {
                  chainId,
                  allowedTargets: [{ target: pool, selectors: ['0x617ba037'] }],
                  allowedRecipients: [BENCHMARK_ACCOUNT, reserve.aToken],
                },
              ],
              assetBudgets: [
                {
                  chainId,
                  asset: token,
                  maxGrossOutflow: amount.toString(),
                  maxAllowanceExposure: amount.toString(),
                },
              ],
              maxGasWei: '1000000000000000000',
              maxSlippageBps: 0,
              expiresAt: '2026-09-05T00:00:00Z',
            },
            finalStateGoals: [
              {
                kind: 'MIN_ASSET_BALANCE',
                chainId,
                account: BENCHMARK_ACCOUNT,
                asset: token,
                minAmount: (initial - amount).toString(),
              },
              {
                kind: 'MIN_POSITION',
                chainId,
                account: BENCHMARK_ACCOUNT,
                protocol: pool,
                asset: token,
                minAmount: (positionBefore + 1n).toString(),
              },
            ],
          };
          const flows = sent.flatMap((receipt) =>
            receipt.logs
              .filter((log) => log.address.toLowerCase() === token.toLowerCase())
              .flatMap(
                (log, index) =>
                  decodeErc20Log({
                    chainId,
                    token: log.address,
                    topics: log.topics,
                    data: log.data,
                    logIndex: index,
                  }).effects,
              ),
          );
          const receipts = sent.map((r) => ({
            chainId,
            transactionHash: r.transactionHash,
            status: r.status,
            gasCostWei: (r.gasUsed * r.effectiveGasPrice).toString(),
          }));
          const oracle = evaluatePostState({
            contract,
            preState: pre,
            postState: post,
            observedEffects: flows,
            evidenceLevel: 'EXECUTED_FORK',
            executionComplete: true,
            receipts,
            requiredReceiptCount: 2,
          });
          expect(oracle.status).toBe('PASS');
          await mkdir('experiments/results/m2', { recursive: true });
          await writeFile(
            `experiments/results/m2/${filename}-aave-smoke.json`,
            JSON.stringify(
              {
                kind: 'REPRESENTATIVE_NOT_BASE_SCENARIO_REPLAY',
                chainId,
                pinnedBlock: config.forkBlockNumber,
                pinnedHash: config.forkBlockHash,
                receipts,
                pre,
                post,
                oracle,
              },
              null,
              2,
            ),
          );
        } finally {
          await local.revert(snapshot);
        }
      }, 90_000);
    },
  );
}
