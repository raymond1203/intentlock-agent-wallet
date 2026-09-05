import { createPublicClient, createWalletClient, encodeFunctionData, http } from 'viem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  IntentLockMetaMaskAdapter,
  type MetaMaskWalletExecutor,
} from '../../src/adapters/metamask/adapter.js';
import type { IntentContract } from '../../src/domain/intent-contract.js';
import { AnvilFork, loadForkConfig } from '../../scripts/anvil-harness.ts';
import { decodeBatchCalldata } from '../../src/effects/batch-decoder.js';
import { decodeErc20Log, ERC20_ABI } from '../../src/effects/erc20-decoder.js';

const baseConfig = loadForkConfig('experiments/configs/forks/ethereum-25773000.json');
// Vitest may execute integration files concurrently; each Anvil process owns a distinct port.
const config = { ...baseConfig, port: baseConfig.port + 10 };
const hasUpstream = (process.env[config.rpcEnvVar] ?? '') !== '';

const ACCOUNT = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const USDC_CODEHASH = '0xd80d4b7c890cb9d6a4893e6b52bc34b56b25335cb13716e0d1d31383e6b41505';

async function stopIfStarted(value: AnvilFork | undefined): Promise<void> {
  if (value) await value.stop();
}

describe.skipIf(!hasUpstream)('effect decoders against the pinned Ethereum fork', () => {
  let fork: AnvilFork;

  beforeAll(async () => {
    fork = await AnvilFork.start(config);
  }, 120_000);

  afterAll(async () => {
    await stopIfStarted(fork);
  });

  it('decodes only after the live bytecode matches the frozen decoder identity', async () => {
    const fingerprint = await fork.healthcheck();
    const usdc = fingerprint.contracts.find((entry) => entry.key === 'usdc');
    expect(usdc?.codehash.toLowerCase()).toBe(USDC_CODEHASH);
    if (!usdc) throw new Error('pinned fork fingerprint is missing USDC');

    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [RECIPIENT, 1_000_000n],
    });
    const decoded = decodeBatchCalldata(
      { chainId: 1, target: USDC, caller: ACCOUNT, data },
      {
        contracts: { [USDC]: { kind: 'ERC20', codehash: USDC_CODEHASH } },
        observedCodehashes: { [USDC]: usdc.codehash },
        requireCodehash: true,
      },
    );

    expect(decoded.status).toBe('COMPLETE');
    expect(decoded.effects).toMatchObject([
      { kind: 'TRANSFER', asset: USDC, from: ACCOUNT, to: RECIPIENT, amount: '1000000' },
    ]);
  });

  it('fails closed when the observed fork identity is altered', () => {
    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [RECIPIENT, 1n],
    });
    const decoded = decodeBatchCalldata(
      { chainId: 1, target: USDC, caller: ACCOUNT, data },
      {
        contracts: { [USDC]: { kind: 'ERC20', codehash: USDC_CODEHASH } },
        observedCodehashes: { [USDC]: `0x${'11'.repeat(32)}` },
        requireCodehash: true,
      },
    );

    expect(decoded.status).toBe('UNKNOWN');
    expect(decoded.effects[0]).toMatchObject({
      kind: 'UNKNOWN',
      reason: 'codehash does not match pinned decoder',
    });
  });

  it('enforces the guard before a real Anvil signer and verifies the receipt post-state', async () => {
    const snapshot = await fork.snapshot();
    try {
      const amount = 1_000_000n;
      await fork.dealErc20(USDC, ACCOUNT, amount);
      const recipientBefore = await fork.erc20BalanceOf(USDC, RECIPIENT);
      const fingerprint = await fork.healthcheck();
      const usdc = fingerprint.contracts.find((entry) => entry.key === 'usdc');
      if (!usdc) throw new Error('pinned fork fingerprint is missing USDC');
      const publicClient = createPublicClient({ transport: http(fork.url) });
      const walletClient = createWalletClient({ account: ACCOUNT, transport: http(fork.url) });
      const executor: MetaMaskWalletExecutor = {
        async sendTransaction(request) {
          const transactionHash = await walletClient.sendTransaction({
            account: request.from,
            chain: null,
            to: request.to,
            data: request.data,
            value: BigInt(request.valueWei),
          });
          const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash });
          const observedEffects = receipt.logs
            .filter((log) => log.address.toLowerCase() === USDC.toLowerCase())
            .flatMap(
              (log, index) =>
                decodeErc20Log({
                  chainId: 1,
                  token: USDC,
                  topics: log.topics,
                  data: log.data,
                  logIndex: index,
                  codehash: usdc.codehash,
                }).effects,
            );
          const recipientAfter = await fork.erc20BalanceOf(USDC, RECIPIENT);
          return {
            status: receipt.status === 'success' ? 'SUCCESS' : 'FAILED',
            transactionHash,
            gasUsedWei: (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
            observedEffects,
            finalGoalChecks: [
              {
                goalIndex: 0,
                satisfied: recipientAfter === recipientBefore + amount,
                evidence: `recipient balance ${recipientAfter.toString()}`,
              },
            ],
          };
        },
      };
      const contract: IntentContract = {
        version: '0.1',
        account: ACCOUNT,
        nonce: '1',
        idempotencyKey: 'live-fork-transfer',
        safety: {
          chainScopes: [
            {
              chainId: 1,
              allowedTargets: [{ target: USDC, selectors: ['0xa9059cbb'] }],
              allowedRecipients: [ACCOUNT, RECIPIENT],
            },
          ],
          assetBudgets: [
            {
              chainId: 1,
              asset: USDC,
              maxGrossOutflow: amount.toString(),
              maxAllowanceExposure: '0',
            },
          ],
          maxGasWei: '10000000000000000',
          maxSlippageBps: 0,
          expiresAt: '2026-09-05T00:00:00+09:00',
        },
        finalStateGoals: [
          {
            kind: 'MIN_ASSET_BALANCE',
            chainId: 1,
            asset: USDC,
            account: RECIPIENT,
            minAmount: (recipientBefore + amount).toString(),
          },
        ],
      };
      const data = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'transfer',
        args: [RECIPIENT, amount],
      });
      const audit = await new IntentLockMetaMaskAdapter(executor).execute({
        contract,
        action: { chainId: 1, target: USDC, data },
        decoder: {
          contracts: { [USDC]: { kind: 'ERC20', codehash: USDC_CODEHASH } },
          observedCodehashes: { [USDC]: usdc.codehash },
          requireCodehash: true,
        },
        evaluatedAt: '2026-08-29T00:00:00Z',
        simulationStatus: 'SUCCESS',
      });

      expect(audit).toMatchObject({
        status: 'EXECUTED_VERIFIED',
        signerInvoked: true,
        preDecision: { kind: 'ALLOW' },
        postDecision: { kind: 'ALLOW' },
        effectMismatches: [],
      });
      expect(await fork.erc20BalanceOf(USDC, RECIPIENT)).toBe(recipientBefore + amount);
    } finally {
      await fork.revert(snapshot);
    }
  }, 60_000);
});
