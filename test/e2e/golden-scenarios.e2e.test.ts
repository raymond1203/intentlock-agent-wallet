import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { encodeFunctionData } from 'viem';

import {
  IntentLockMetaMaskAdapter,
  type MetaMaskExecutionReceipt,
  type MetaMaskWalletExecutor,
} from '../../src/adapters/metamask/adapter.js';
import {
  buildMetaMaskSendTransactionArgs,
  MetaMaskCliExecutor,
} from '../../src/adapters/metamask/cli.js';
import type { EconomicEffect } from '../../src/domain/action-ir.js';
import type { IntentContract } from '../../src/domain/intent-contract.js';
import { decodeBatchCalldata, type BatchDecoderOptions } from '../../src/effects/batch-decoder.js';
import { SWAP_ROUTER_02_ABI } from '../../src/effects/swap-decoder.js';
import { InMemoryIntentLedger } from '../../src/monitor/ledger.js';

const AddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const Bytes32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const fixture = z
  .object({
    schemaVersion: z.literal('0.1'),
    fork: z.object({
      chainId: z.literal(1),
      blockNumber: z.literal(25773000),
      blockHash: Bytes32Schema,
    }),
    addresses: z.object({
      account: AddressSchema,
      recipient: AddressSchema,
      attacker: AddressSchema,
      usdc: AddressSchema,
      weth: AddressSchema,
      swapRouter02: AddressSchema,
    }),
    codehashes: z.object({ usdc: Bytes32Schema, swapRouter02: Bytes32Schema }),
    scenarios: z.array(
      z.object({
        id: z.string(),
        class: z.enum(['NORMAL', 'ATTACK', 'DRIFT']),
        target: z.enum(['usdc', 'swapRouter02']),
        data: z.string().regex(/^0x[0-9a-fA-F]*$/),
        quotedAmountOut: z.string().optional(),
        codehashDrift: z.boolean().optional(),
        expectedDecision: z.enum(['ALLOW', 'DENY', 'ESCALATE']),
        expectedCode: z.string().optional(),
      }),
    ),
  })
  .strict()
  .parse(
    JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, '../../benchmark/scenarios/golden/scenarios.json'),
        'utf8',
      ),
    ),
  );

const TX_HASH = `0x${'ab'.repeat(32)}` as const;

function contract(idempotencyKey: string): IntentContract {
  return {
    version: '0.1',
    account: fixture.addresses.account,
    nonce: '1',
    idempotencyKey,
    safety: {
      chainScopes: [
        {
          chainId: 1,
          allowedTargets: [
            { target: fixture.addresses.usdc, selectors: ['0xa9059cbb', '0x095ea7b3'] },
            { target: fixture.addresses.swapRouter02, selectors: ['0x04e45aaf'] },
          ],
          allowedRecipients: [fixture.addresses.account, fixture.addresses.recipient],
        },
      ],
      assetBudgets: [
        {
          chainId: 1,
          asset: fixture.addresses.usdc,
          maxGrossOutflow: '2000000',
          maxAllowanceExposure: '1000000',
        },
      ],
      maxGasWei: '10000000000000000',
      maxSlippageBps: 100,
      expiresAt: '2026-09-05T00:00:00+09:00',
    },
    finalStateGoals: [
      {
        kind: 'MIN_ASSET_BALANCE',
        chainId: 1,
        asset: fixture.addresses.usdc,
        account: fixture.addresses.recipient,
        minAmount: '1',
      },
    ],
  };
}

function decoderFor(scenario: (typeof fixture.scenarios)[number]): BatchDecoderOptions {
  const drift: `0x${string}` = `0x${'11'.repeat(32)}`;
  const usdcCodehash = fixture.codehashes.usdc as `0x${string}`;
  const routerCodehash = fixture.codehashes.swapRouter02 as `0x${string}`;
  return {
    contracts: {
      [fixture.addresses.usdc]: { kind: 'ERC20', codehash: usdcCodehash },
      [fixture.addresses.swapRouter02]: {
        kind: 'SWAP_ROUTER_02',
        codehash: routerCodehash,
      },
    },
    observedCodehashes: {
      [fixture.addresses.usdc]: scenario.codehashDrift ? drift : usdcCodehash,
      [fixture.addresses.swapRouter02]: routerCodehash,
    },
    requireCodehash: true,
    ...(scenario.quotedAmountOut ? { quotedAmountOut: scenario.quotedAmountOut } : {}),
  };
}

function observed(effects: readonly EconomicEffect[]): EconomicEffect[] {
  return effects.map((effect) => ({
    ...effect,
    phase: 'OBSERVED',
    provenance: { ...effect.provenance, source: 'RECEIPT' },
  }));
}

function successfulExecutor(
  decoder: BatchDecoderOptions,
): MetaMaskWalletExecutor & { calls: number } {
  return {
    calls: 0,
    sendTransaction(request) {
      this.calls += 1;
      const decoded = decodeBatchCalldata(
        {
          chainId: request.chainId,
          target: request.to,
          caller: request.from,
          data: request.data,
          valueWei: request.valueWei,
        },
        decoder,
      );
      return Promise.resolve({
        status: 'SUCCESS',
        transactionHash: TX_HASH,
        gasUsedWei: '0',
        observedEffects: observed(decoded.effects),
        finalGoalChecks: [{ goalIndex: 0, satisfied: true, evidence: 'pinned-fork post-state' }],
      });
    },
  };
}

describe('MetaMask fixed-fork golden scenarios', () => {
  it('contains exactly five normal and five attack/drift cases', () => {
    expect(fixture.scenarios).toHaveLength(10);
    expect(fixture.scenarios.filter((scenario) => scenario.class === 'NORMAL')).toHaveLength(5);
    expect(fixture.scenarios.filter((scenario) => scenario.class !== 'NORMAL')).toHaveLength(5);
  });

  for (const scenario of fixture.scenarios) {
    // Preserve immutable M1 inputs/evidence. G05 used floor(quote*0.99), one unit below
    // the exact bound; its historical ALLOW label is not the corrected monitor's expectation.
    const legacyRoundedMinimum = scenario.id === 'G05-bounded-swap';
    const expectedDecision = legacyRoundedMinimum ? 'DENY' : scenario.expectedDecision;
    const expectedCode = legacyRoundedMinimum ? 'SLIPPAGE_EXCEEDED' : scenario.expectedCode;
    it(`${scenario.id}: current policy ${expectedDecision}`, async () => {
      const decoder = decoderFor(scenario);
      const executor = successfulExecutor(decoder);
      const adapter = new IntentLockMetaMaskAdapter(executor);
      const target = fixture.addresses[scenario.target] as `0x${string}`;
      const audit = await adapter.execute({
        contract: contract(scenario.id),
        action: { chainId: 1, target, data: scenario.data as `0x${string}` },
        decoder,
        evaluatedAt: '2026-08-29T00:00:00Z',
        simulationStatus: 'SUCCESS',
      });

      expect(audit.preDecision.kind).toBe(expectedDecision);
      if (audit.preDecision.kind !== 'ALLOW') {
        expect(audit.preDecision.code).toBe(expectedCode);
      }
      if (expectedDecision === 'ALLOW') {
        expect(audit.status).toBe('EXECUTED_VERIFIED');
        expect(audit.postDecision?.kind).toBe('ALLOW');
        expect(audit.effectMismatches).toEqual([]);
        expect(audit.signerInvoked).toBe(true);
        expect(executor.calls).toBe(1);
      } else {
        expect(audit.status).toBe('BLOCKED');
        expect(audit.signerInvoked).toBe(false);
        expect(executor.calls).toBe(0);
      }
    });
  }

  it('allows the G05 swap with the exact rounded-up minimum without rewriting historical fixtures', async () => {
    const historical = fixture.scenarios.find((scenario) => scenario.id === 'G05-bounded-swap');
    if (!historical?.quotedAmountOut) throw new Error('G05 quote missing');
    expect(historical.expectedDecision).toBe('ALLOW');
    const decoder = decoderFor(historical);
    const minimum = (BigInt(historical.quotedAmountOut) * 9900n + 9999n) / 10000n;
    const data = encodeFunctionData({
      abi: SWAP_ROUTER_02_ABI,
      functionName: 'exactInputSingle',
      args: [
        {
          tokenIn: fixture.addresses.usdc as `0x${string}`,
          tokenOut: fixture.addresses.weth as `0x${string}`,
          fee: 500,
          recipient: fixture.addresses.recipient as `0x${string}`,
          amountIn: 1000000n,
          amountOutMinimum: minimum,
          sqrtPriceLimitX96: 0n,
        },
      ],
    });
    const executor = successfulExecutor(decoder);
    const audit = await new IntentLockMetaMaskAdapter(executor).execute({
      contract: contract('g05-exact-bound-control'),
      action: { chainId: 1, target: fixture.addresses.swapRouter02 as `0x${string}`, data },
      decoder,
      evaluatedAt: '2026-08-29T00:00:00Z',
      simulationStatus: 'SUCCESS',
    });
    expect(audit.status).toBe('EXECUTED_VERIFIED');
    expect(executor.calls).toBe(1);
  });
});

describe('MetaMask signing boundary failure modes', () => {
  const scenario = fixture.scenarios[0];
  if (!scenario) throw new Error('golden fixture must contain at least one scenario');
  const decoder = decoderFor(scenario);
  const request = {
    contract: contract('failure-mode'),
    action: {
      chainId: 1,
      target: fixture.addresses.usdc as `0x${string}`,
      data: scenario.data as `0x${string}`,
    },
    decoder,
    evaluatedAt: '2026-08-29T00:00:00Z',
    simulationStatus: 'SUCCESS' as const,
  };

  it('records a receipt-effect mismatch as a violated ledger reservation', async () => {
    const ledger = new InMemoryIntentLedger();
    const executor: MetaMaskWalletExecutor = {
      sendTransaction(): Promise<MetaMaskExecutionReceipt> {
        return Promise.resolve({
          status: 'SUCCESS',
          transactionHash: TX_HASH,
          gasUsedWei: '0',
          observedEffects: [],
          finalGoalChecks: [{ goalIndex: 0, satisfied: true, evidence: 'checked' }],
        });
      },
    };
    const audit = await new IntentLockMetaMaskAdapter(executor, ledger).execute(request);
    expect(audit.status).toBe('EXECUTED_MISMATCH');
    expect(audit.postDecision).toMatchObject({ kind: 'DENY', code: 'RECEIPT_EFFECT_MISMATCH' });
    expect(ledger.snapshot().reservations[0]?.status).toBe('VIOLATED');
  });

  it('settles a reverted transaction without claiming post-state verification', async () => {
    const executor: MetaMaskWalletExecutor = {
      sendTransaction() {
        return Promise.resolve({
          status: 'FAILED' as const,
          transactionHash: TX_HASH,
          gasUsedWei: '0',
          observedEffects: [],
          finalGoalChecks: [],
        });
      },
    };
    const audit = await new IntentLockMetaMaskAdapter(executor).execute({
      ...request,
      contract: contract('failed-transaction'),
    });
    expect(audit.status).toBe('EXECUTION_FAILED');
    expect(audit.postDecision).toBeUndefined();
  });

  it('does not call the signer twice for the same idempotency key', async () => {
    const executor = successfulExecutor(decoder);
    const adapter = new IntentLockMetaMaskAdapter(executor);
    const first = await adapter.execute({ ...request, contract: contract('one-shot') });
    const second = await adapter.execute({ ...request, contract: contract('one-shot') });
    expect(first.status).toBe('EXECUTED_VERIFIED');
    expect(second.status).toBe('BLOCKED');
    expect(second.preDecision).toMatchObject({
      kind: 'DENY',
      code: 'LEDGER_RESERVATION_REJECTED',
    });
    expect(executor.calls).toBe(1);
  });

  it('includes simulator gas effects in the pre-sign budget decision', async () => {
    const executor = successfulExecutor(decoder);
    const audit = await new IntentLockMetaMaskAdapter(executor).execute({
      ...request,
      contract: contract('gas-overrun'),
      simulationEffects: [
        {
          id: 'simulated-gas',
          phase: 'PREDICTED',
          provenance: {
            callPath: [],
            target: fixture.addresses.usdc,
            selector: '0xa9059cbb',
            source: 'SIMULATION',
          },
          kind: 'GAS',
          chainId: 1,
          payer: fixture.addresses.account,
          maxFeeWei: '10000000000000001',
        },
      ],
    });
    expect(audit).toMatchObject({
      status: 'BLOCKED',
      signerInvoked: false,
      preDecision: { kind: 'DENY', code: 'GAS_BUDGET_EXCEEDED' },
    });
    expect(executor.calls).toBe(0);
  });

  it('constructs the documented mm wallet command without shell interpolation', async () => {
    const runner = { run: vi.fn() };
    runner.run.mockResolvedValue({ exitCode: 0, stdout: '{}', stderr: '' });
    const receipt: MetaMaskExecutionReceipt = {
      status: 'SUCCESS',
      transactionHash: TX_HASH,
      gasUsedWei: '0',
      observedEffects: [],
      finalGoalChecks: [],
    };
    const cli = new MetaMaskCliExecutor(runner, () => receipt);
    const transaction = {
      chainId: 1,
      from: fixture.addresses.account as `0x${string}`,
      to: fixture.addresses.usdc as `0x${string}`,
      data: scenario.data as `0x${string}`,
      valueWei: '0',
    };
    await expect(cli.sendTransaction(transaction)).resolves.toBe(receipt);
    expect(runner.run).toHaveBeenCalledWith('mm', buildMetaMaskSendTransactionArgs(transaction));
  });
});
