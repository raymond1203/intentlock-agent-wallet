import { keccak256, toHex, type Hex } from 'viem';

import type { EconomicEffect } from '../../domain/action-ir.js';
import type { GuardDecision } from '../../domain/guard-decision.js';
import { IntentContractSchema, type IntentContract } from '../../domain/intent-contract.js';
import { hashIntentContract } from '../../domain/intent-hash.js';
import { decodeBatchCalldata, type BatchDecoderOptions } from '../../effects/batch-decoder.js';
import { comparePredictedAndObserved, type EffectMismatch } from '../../effects/types.js';
import { InMemoryIntentLedger } from '../../monitor/ledger.js';
import { evaluateIntent, type FinalGoalCheck } from '../../monitor/monitor.js';
import { createReservationRequest } from '../../monitor/reservation.js';

export interface MetaMaskTransactionRequest {
  chainId: number;
  from: `0x${string}`;
  to: `0x${string}`;
  data: Hex;
  valueWei: string;
}

export interface MetaMaskExecutionReceipt {
  status: 'SUCCESS' | 'FAILED';
  transactionHash?: `0x${string}`;
  gasUsedWei: string;
  observedEffects: readonly EconomicEffect[];
  finalGoalChecks: readonly FinalGoalCheck[];
}

export interface MetaMaskWalletExecutor {
  sendTransaction(request: MetaMaskTransactionRequest): Promise<MetaMaskExecutionReceipt>;
}

export interface GuardedExecutionRequest {
  contract: IntentContract;
  action: {
    chainId: number;
    target: `0x${string}`;
    data: Hex;
    valueWei?: string;
  };
  decoder: BatchDecoderOptions;
  evaluatedAt: string;
  simulationStatus: 'SUCCESS' | 'FAILED' | 'UNAVAILABLE';
  /** GAS or trace-derived effects produced by the pinned simulator. */
  simulationEffects?: readonly EconomicEffect[];
  acceptedEffects?: readonly EconomicEffect[];
}

export type GuardedExecutionStatus =
  'BLOCKED' | 'EXECUTED_VERIFIED' | 'EXECUTED_MISMATCH' | 'EXECUTION_FAILED';

export interface GuardedExecutionAudit {
  version: '0.1';
  logId: `0x${string}`;
  intentHash: `0x${string}`;
  status: GuardedExecutionStatus;
  evaluatedAt: string;
  decodeStatus: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';
  preDecision: GuardDecision;
  postDecision?: GuardDecision;
  signerInvoked: boolean;
  reservationId?: string;
  transactionHash?: `0x${string}`;
  effectMismatches: readonly EffectMismatch[];
}

function logId(request: GuardedExecutionRequest, intentHash: `0x${string}`): `0x${string}` {
  return keccak256(
    toHex(
      JSON.stringify({
        intentHash,
        chainId: request.action.chainId,
        target: request.action.target.toLowerCase(),
        data: request.action.data.toLowerCase(),
        valueWei: request.action.valueWei ?? '0',
        evaluatedAt: request.evaluatedAt,
      }),
    ),
  );
}

function ledgerDenied(
  intentHash: `0x${string}`,
  evaluatedAt: string,
  reason: string,
): GuardDecision {
  return {
    kind: 'DENY',
    intentHash,
    evaluatedAt,
    code: 'LEDGER_RESERVATION_REJECTED',
    reason,
    violatedInvariant: 'cumulative reservation limits',
    evidence: [
      {
        path: 'ledger.reserve',
        expected: 'atomic reservation succeeds',
        actual: reason,
        source: 'LEDGER',
      },
    ],
  };
}

function receiptMismatchDenied(
  intentHash: `0x${string}`,
  evaluatedAt: string,
  mismatches: readonly EffectMismatch[],
): GuardDecision {
  return {
    kind: 'DENY',
    intentHash,
    evaluatedAt,
    code: 'RECEIPT_EFFECT_MISMATCH',
    reason: 'Observed receipt effects differ from the effects authorized before signing.',
    violatedInvariant: 'predicted effects equal observed effects',
    evidence: [
      {
        path: 'receipt.effects',
        expected: 'same economic multiset as predicted effects',
        actual: JSON.stringify(mismatches),
        source: 'RECEIPT',
      },
    ],
  };
}

export class IntentLockMetaMaskAdapter {
  public constructor(
    private readonly executor: MetaMaskWalletExecutor,
    private readonly ledger: InMemoryIntentLedger = new InMemoryIntentLedger(),
  ) {}

  public async execute(input: GuardedExecutionRequest): Promise<GuardedExecutionAudit> {
    const contract = IntentContractSchema.parse(input.contract);
    // Caller-owned values must not change between validation, awaited reservation and settlement.
    // Decoder options are consumed synchronously below and never read after the first await.
    const request: GuardedExecutionRequest = {
      ...input,
      contract,
      action: { ...input.action },
      acceptedEffects: structuredClone(input.acceptedEffects ?? []),
      simulationEffects: structuredClone(input.simulationEffects ?? []),
    };
    const intentHash = hashIntentContract(contract);
    const auditLogId = logId(request, intentHash);
    const decoded = decodeBatchCalldata(
      {
        chainId: request.action.chainId,
        target: request.action.target,
        caller: contract.account as `0x${string}`,
        data: request.action.data,
        valueWei: request.action.valueWei ?? '0',
      },
      request.decoder,
    );
    const candidateEffects = [...decoded.effects, ...(request.simulationEffects ?? [])];
    const preDecision = evaluateIntent({
      contract,
      acceptedEffects: request.acceptedEffects ?? [],
      candidateEffects,
      candidateDecodeStatus: decoded.status,
      simulationStatus: request.simulationStatus,
      evaluatedAt: request.evaluatedAt,
    });
    const base = {
      version: '0.1' as const,
      logId: auditLogId,
      intentHash,
      evaluatedAt: request.evaluatedAt,
      decodeStatus: decoded.status,
      signerInvoked: false,
      effectMismatches: [] as readonly EffectMismatch[],
    };
    if (preDecision.kind !== 'ALLOW') {
      return { ...base, status: 'BLOCKED', preDecision };
    }

    const reserveResult = await this.ledger.reserve(
      createReservationRequest(
        contract,
        intentHash,
        candidateEffects,
        auditLogId,
        request.evaluatedAt,
      ),
    );
    if (reserveResult.kind === 'REJECTED') {
      return {
        ...base,
        status: 'BLOCKED',
        preDecision: ledgerDenied(intentHash, request.evaluatedAt, reserveResult.reason),
      };
    }
    if (reserveResult.kind === 'DUPLICATE') {
      return {
        ...base,
        status: 'BLOCKED',
        preDecision: ledgerDenied(
          intentHash,
          request.evaluatedAt,
          `idempotent execution already has a ${reserveResult.reservation.status} reservation`,
        ),
        reservationId: reserveResult.reservation.reservationId,
      };
    }
    const reservation = reserveResult.reservation;
    const receipt = await this.executor.sendTransaction({
      chainId: request.action.chainId,
      from: contract.account as `0x${string}`,
      to: request.action.target,
      data: request.action.data,
      valueWei: request.action.valueWei ?? '0',
    });
    if (receipt.status === 'FAILED') {
      await this.ledger.settleFailed(
        reservation.reservationId,
        receipt.gasUsedWei,
        request.evaluatedAt,
      );
      return {
        ...base,
        status: 'EXECUTION_FAILED',
        preDecision,
        signerInvoked: true,
        reservationId: reservation.reservationId,
        ...(receipt.transactionHash ? { transactionHash: receipt.transactionHash } : {}),
      };
    }

    const effectMismatches = comparePredictedAndObserved(candidateEffects, receipt.observedEffects);
    const postDecision =
      effectMismatches.length > 0
        ? receiptMismatchDenied(intentHash, request.evaluatedAt, effectMismatches)
        : evaluateIntent({
            contract,
            acceptedEffects: request.acceptedEffects ?? [],
            candidateEffects,
            candidateDecodeStatus: decoded.status,
            simulationStatus: 'SUCCESS',
            evaluatedAt: request.evaluatedAt,
            finalGoalChecks: receipt.finalGoalChecks,
          });
    const observedAmounts = createReservationRequest(
      contract,
      intentHash,
      receipt.observedEffects,
      auditLogId,
      request.evaluatedAt,
    ).amounts;
    if (postDecision.kind === 'ALLOW') {
      await this.ledger.settleExecuted(
        reservation.reservationId,
        observedAmounts,
        request.evaluatedAt,
      );
    } else {
      await this.ledger.settleViolated(
        reservation.reservationId,
        observedAmounts,
        request.evaluatedAt,
      );
    }
    return {
      ...base,
      status: postDecision.kind === 'ALLOW' ? 'EXECUTED_VERIFIED' : 'EXECUTED_MISMATCH',
      preDecision,
      postDecision,
      signerInvoked: true,
      reservationId: reservation.reservationId,
      ...(receipt.transactionHash ? { transactionHash: receipt.transactionHash } : {}),
      effectMismatches,
    };
  }
}
