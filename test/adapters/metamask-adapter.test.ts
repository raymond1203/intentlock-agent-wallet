import { encodeFunctionData } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import {
  IntentLockMetaMaskAdapter,
  type GuardedExecutionRequest,
  type MetaMaskExecutionReceipt,
} from '../../src/adapters/metamask/adapter.js';
import type { EconomicEffect } from '../../src/domain/action-ir.js';
import { decodeBatchCalldata } from '../../src/effects/batch-decoder.js';
import { ERC20_ABI } from '../../src/effects/erc20-decoder.js';
import { InMemoryIntentLedger } from '../../src/monitor/ledger.js';

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const TOKEN = '0x3333333333333333333333333333333333333333';
const OTHER = '0x4444444444444444444444444444444444444444';
const EVALUATED_AT = '2026-09-04T00:00:00Z';

function request(): GuardedExecutionRequest {
  return {
    contract: {
      version: '0.1',
      account: ACCOUNT,
      nonce: '1',
      idempotencyKey: 'snapshot-regression',
      safety: {
        chainScopes: [
          {
            chainId: 1,
            allowedTargets: [{ target: TOKEN, selectors: ['0xa9059cbb'] }],
            allowedRecipients: [RECIPIENT],
          },
        ],
        assetBudgets: [
          { chainId: 1, asset: TOKEN, maxGrossOutflow: '100', maxAllowanceExposure: '0' },
        ],
        maxGasWei: '10',
        maxSlippageBps: 100,
        expiresAt: '2026-09-06T00:00:00Z',
      },
      finalStateGoals: [
        {
          kind: 'MIN_ASSET_BALANCE',
          chainId: 1,
          asset: TOKEN,
          account: RECIPIENT,
          minAmount: '10',
        },
      ],
    },
    action: {
      chainId: 1,
      target: TOKEN,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'transfer',
        args: [RECIPIENT, 10n],
      }),
      valueWei: '0',
    },
    decoder: { contracts: { [TOKEN]: { kind: 'ERC20' } } },
    evaluatedAt: EVALUATED_AT,
    simulationStatus: 'SUCCESS',
  };
}

function observedReceipt(input: GuardedExecutionRequest): MetaMaskExecutionReceipt {
  const decoded = decodeBatchCalldata(
    {
      chainId: input.action.chainId,
      target: input.action.target,
      caller: ACCOUNT,
      data: input.action.data,
      valueWei: input.action.valueWei ?? '0',
    },
    input.decoder,
  );
  return {
    status: 'SUCCESS',
    gasUsedWei: '0',
    observedEffects: structuredClone([...decoded.effects, ...(input.simulationEffects ?? [])]),
    finalGoalChecks: [{ goalIndex: 0, satisfied: true, evidence: 'local regression fixture' }],
  };
}

function pausedLedger() {
  const ledger = new InMemoryIntentLedger();
  const reserve = ledger.reserve.bind(ledger);
  let release = (): void => undefined;
  const pause = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(ledger, 'reserve').mockImplementation(async (input) => {
    await pause;
    return reserve(input);
  });
  return { ledger, release };
}

describe('MetaMask adapter caller-input snapshot', () => {
  const mutations: [string, (input: GuardedExecutionRequest) => void][] = [
    [
      'calldata',
      (input) => {
        input.action.data = encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'transfer',
          args: [OTHER, 99n],
        });
      },
    ],
    [
      'chain',
      (input) => {
        input.action.chainId = 8453;
      },
    ],
    [
      'target',
      (input) => {
        input.action.target = OTHER;
      },
    ],
    [
      'value',
      (input) => {
        input.action.valueWei = '999';
      },
    ],
    [
      'action replacement',
      (input) => {
        input.action = { chainId: 8453, target: OTHER, data: '0x', valueWei: '999' };
      },
    ],
  ];

  it.each(mutations)('keeps checked %s across the awaited reservation', async (_name, mutate) => {
    const input = request();
    const expectedTransaction = {
      chainId: input.action.chainId,
      from: ACCOUNT,
      to: input.action.target,
      data: input.action.data,
      valueWei: '0',
    };
    const executor = { sendTransaction: vi.fn().mockResolvedValue(observedReceipt(input)) };
    const { ledger, release } = pausedLedger();
    const pending = new IntentLockMetaMaskAdapter(executor, ledger).execute(input);
    expect(executor.sendTransaction).not.toHaveBeenCalled();
    mutate(input);
    release();
    const audit = await pending;
    expect(executor.sendTransaction).toHaveBeenCalledExactlyOnceWith(expectedTransaction);
    expect(audit).toMatchObject({ status: 'EXECUTED_VERIFIED', signerInvoked: true });
  });

  it('keeps nested effects, contract and evaluation time stable during execution', async () => {
    const input = request();
    const gas: EconomicEffect = {
      id: 'gas',
      phase: 'PREDICTED',
      kind: 'GAS',
      chainId: 1,
      payer: ACCOUNT,
      maxFeeWei: '1',
      provenance: { callPath: [], target: TOKEN, selector: '0xa9059cbb', source: 'SIMULATION' },
    };
    const previous: EconomicEffect = {
      id: 'previous',
      phase: 'PREDICTED',
      kind: 'TRANSFER',
      chainId: 1,
      asset: TOKEN,
      from: ACCOUNT,
      to: RECIPIENT,
      amount: '1',
      provenance: { callPath: [0], target: TOKEN, selector: '0xa9059cbb', source: 'CALLDATA' },
    };
    input.simulationEffects = [gas];
    input.acceptedEffects = [previous];
    const receipt = observedReceipt(input);
    let releaseReceipt = (): void => undefined;
    const receiptPause = new Promise<void>((resolve) => {
      releaseReceipt = resolve;
    });
    const executor = {
      sendTransaction: vi.fn(async () => {
        await receiptPause;
        return receipt;
      }),
    };
    const pending = new IntentLockMetaMaskAdapter(executor).execute(input);
    await vi.waitFor(() => {
      expect(executor.sendTransaction).toHaveBeenCalledOnce();
    });
    gas.maxFeeWei = '999';
    gas.provenance.target = OTHER;
    previous.amount = '999';
    input.acceptedEffects = [];
    input.contract.account = OTHER;
    input.contract.safety.maxGasWei = '0';
    input.evaluatedAt = '2030-01-01T00:00:00Z';
    releaseReceipt();
    expect(await pending).toMatchObject({
      status: 'EXECUTED_VERIFIED',
      evaluatedAt: EVALUATED_AT,
      postDecision: { kind: 'ALLOW', evaluatedAt: EVALUATED_AT },
    });
  });

  it('preserves normal execution and the one-call idempotency boundary', async () => {
    const input = request();
    const original = structuredClone(input);
    const executor = { sendTransaction: vi.fn().mockResolvedValue(observedReceipt(input)) };
    const adapter = new IntentLockMetaMaskAdapter(executor);
    expect((await adapter.execute(input)).status).toBe('EXECUTED_VERIFIED');
    expect((await adapter.execute(input)).status).toBe('BLOCKED');
    expect(executor.sendTransaction).toHaveBeenCalledOnce();
    expect(input).toEqual(original);
  });
});
