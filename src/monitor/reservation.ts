import { aggregateEffects, type EconomicEffect } from '../domain/action-ir.js';
import type { IntentContract } from '../domain/intent-contract.js';

export interface ReservationAmounts {
  grossOutflow: Record<string, string>;
  allowanceExposure: Record<string, string>;
  gasWei: string;
}

export interface ReservationLimits {
  grossOutflow: Record<string, string>;
  allowanceExposure: Record<string, string>;
  gasWei: string;
}

export interface ReservationRequest {
  intentHash: `0x${string}`;
  account: string;
  nonce: string;
  idempotencyKey: string;
  decisionLogId: string;
  amounts: ReservationAmounts;
  limits: ReservationLimits;
  createdAt: string;
}

function mapToRecord(map: ReadonlyMap<string, bigint>): Record<string, string> {
  return Object.fromEntries([...map.entries()].map(([key, value]) => [key, value.toString()]));
}

export function createReservationRequest(
  contract: IntentContract,
  intentHash: `0x${string}`,
  effects: readonly EconomicEffect[],
  decisionLogId: string,
  createdAt: string,
  idempotencyKey = contract.idempotencyKey,
): ReservationRequest {
  const totals = aggregateEffects(effects, contract.account);
  const grossOutflow: Record<string, string> = {};
  const allowanceExposure: Record<string, string> = {};
  for (const budget of contract.safety.assetBudgets) {
    const key = `${String(budget.chainId)}:${budget.asset.toLowerCase()}`;
    grossOutflow[key] = budget.maxGrossOutflow;
    allowanceExposure[key] = budget.maxAllowanceExposure;
  }
  return {
    intentHash,
    account: contract.account,
    nonce: contract.nonce,
    idempotencyKey,
    decisionLogId,
    amounts: {
      grossOutflow: mapToRecord(totals.grossOutflow),
      allowanceExposure: mapToRecord(totals.allowanceExposure),
      gasWei: totals.gasWei.toString(),
    },
    limits: { grossOutflow, allowanceExposure, gasWei: contract.safety.maxGasWei },
    createdAt,
  };
}
