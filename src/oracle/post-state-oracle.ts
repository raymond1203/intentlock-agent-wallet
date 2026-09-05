import { z } from 'zod';
import {
  StateDeltaExpectationSchema,
  StateObservationSchema,
  type StateDeltaExpectation,
} from '../benchmark/scenario.js';
import { EconomicEffectSchema, type EconomicEffect } from '../domain/action-ir.js';
import { IntentContractSchema, type IntentContract } from '../domain/intent-contract.js';

export type StateObservation = z.infer<typeof StateObservationSchema>;
export interface OracleInput {
  contract: IntentContract;
  preState: StateObservation[];
  postState: StateObservation[];
  evidenceLevel: 'EXPECTED_FIXTURE' | 'EXECUTED_FORK';
  /** Ordered economic events; balances alone cannot recover gross outflow. */
  observedEffects?: readonly EconomicEffect[];
  expectedPostState?: readonly StateObservation[];
  expectedDeltas?: readonly StateDeltaExpectation[];
  receipts?: readonly {
    chainId: number;
    transactionHash: string;
    status: 'success' | 'reverted';
    gasCostWei?: string;
  }[];
  requiredReceiptCount?: number;
  executionComplete: boolean;
}
export interface OracleResult {
  status: 'PASS' | 'VIOLATION' | 'INSUFFICIENT_EVIDENCE' | 'DISAGREEMENT';
  decision: 'ALLOW' | 'DENY' | 'ESCALATE';
  evidenceLevel: OracleInput['evidenceLevel'];
  finalGoals: { index: number; satisfied: boolean | null; actual: string | null; code: string }[];
  deltas: { key: string; before: string; after: string; delta: string }[];
  violations: { code: string; key: string; amount: string }[];
  allowanceExposure: { key: string; amount: string }[];
  missing: string[];
  disagreements: { key: string; expected: string; actual: string | null }[];
}
const norm = (value: string): string => value.toLowerCase();
const numeric = (value: string): boolean => /^-?(0|[1-9]\d*)$/.test(value);
export function observationKey(o: StateObservation): string {
  return [
    o.chainId,
    norm(o.subject),
    o.field,
    norm(o.asset ?? ''),
    norm(o.counterparty ?? ''),
    o.tokenId ?? '',
  ].join(':');
}
function stateMap(
  rows: readonly StateObservation[],
  missing: string[],
  side: string,
): Map<string, StateObservation> {
  const map = new Map<string, StateObservation>();
  for (const row of rows) {
    const key = observationKey(row);
    if (map.has(key)) missing.push(`${side}:duplicate:${key}`);
    map.set(key, row);
  }
  return map;
}
/** Independent of the guardrail monitor and of stored benchmark labels. All arithmetic is bigint. */
export function evaluatePostState(input: OracleInput): OracleResult {
  const contract = IntentContractSchema.parse(input.contract);
  const missing: string[] = [];
  const preRows = z.array(StateObservationSchema).parse(input.preState);
  const postRows = z.array(StateObservationSchema).parse(input.postState);
  const pre = stateMap(preRows, missing, 'pre');
  const post = stateMap(postRows, missing, 'post');
  if (!input.executionComplete) missing.push('execution:partial');
  if (input.evidenceLevel === 'EXECUTED_FORK') {
    if ([...preRows, ...postRows].some((row) => row.source === 'EXPECTED_FIXTURE'))
      missing.push('executed:synthetic-state');
    if (
      !input.receipts?.length ||
      input.requiredReceiptCount === undefined ||
      input.receipts.length !== input.requiredReceiptCount
    )
      missing.push('receipts:incomplete');
    if (
      input.receipts?.some(
        (row) => !/^0x[a-fA-F0-9]{64}$/.test(row.transactionHash) || row.status !== 'success',
      )
    )
      missing.push('receipts:invalid-or-reverted');
    if (
      new Set(input.receipts?.map((r) => `${String(r.chainId)}:${r.transactionHash}`)).size !==
      (input.receipts?.length ?? 0)
    )
      missing.push('receipts:duplicate');
    for (const scope of contract.safety.chainScopes) {
      if (!input.receipts?.some((r) => r.chainId === scope.chainId))
        missing.push(`receipts:chain:${String(scope.chainId)}`);
    }
  }
  const violations: OracleResult['violations'] = [];
  const finalGoals = contract.finalStateGoals.map(
    (goal, index): OracleResult['finalGoals'][number] => {
      const matches = postRows.filter((row) => {
        if (row.chainId !== goal.chainId) return false;
        switch (goal.kind) {
          case 'MIN_ASSET_BALANCE':
          case 'MIN_ASSET_BALANCE_DELTA':
            return (
              row.field === 'BALANCE' &&
              norm(row.subject) === norm(goal.account) &&
              norm(row.asset ?? '') === norm(goal.asset)
            );
          case 'MAX_DEBT':
            return (
              row.field === 'DEBT' &&
              norm(row.subject) === norm(goal.account) &&
              norm(row.asset ?? '') === norm(goal.asset)
            );
          case 'MIN_POSITION':
          case 'MIN_POSITION_DELTA':
            return (
              row.field === 'POSITION' &&
              norm(row.subject) === norm(goal.account) &&
              norm(row.asset ?? '') === norm(goal.asset) &&
              norm(row.counterparty ?? '') === norm(goal.protocol)
            );
          case 'MIN_HEALTH_FACTOR':
            return (
              row.field === 'HEALTH_FACTOR' &&
              norm(row.subject) === norm(goal.account) &&
              norm(row.counterparty ?? '') === norm(goal.protocol)
            );
          case 'NO_RESIDUAL_ALLOWANCE':
            return (
              row.field === 'ALLOWANCE' &&
              norm(row.subject) === norm(goal.owner) &&
              norm(row.asset ?? '') === norm(goal.asset) &&
              norm(row.counterparty ?? '') === norm(goal.spender)
            );
          case 'OWNER_IS':
            return (
              row.field === 'OWNER' &&
              norm(row.subject) === norm(goal.collection) &&
              row.tokenId === goal.tokenId
            );
        }
      });
      let row = matches[0];
      if (matches.length > 1 && row) {
        if (
          goal.kind === 'MAX_DEBT' &&
          matches.every((r) => numeric(r.value) && BigInt(r.value) >= 0n)
        ) {
          row = { ...row, value: matches.reduce((sum, r) => sum + BigInt(r.value), 0n).toString() };
        } else {
          missing.push(`goal:ambiguous:${String(index)}`);
          row = undefined;
        }
      }
      const deltaGoal =
        goal.kind === 'MIN_ASSET_BALANCE_DELTA' || goal.kind === 'MIN_POSITION_DELTA';
      if (!row || (goal.kind !== 'OWNER_IS' && (!numeric(row.value) || BigInt(row.value) < 0n))) {
        missing.push(`goal:${String(index)}`);
        return {
          index,
          satisfied: null,
          actual: row?.value ?? null,
          code: 'MISSING_OR_INVALID_STATE',
        };
      }
      let gap: bigint;
      let satisfied: boolean;
      let actualValue = row.value;
      if (goal.kind === 'OWNER_IS') {
        satisfied = norm(row.value) === norm(goal.owner);
        gap = satisfied ? 0n : 1n;
      } else {
        let actual = BigInt(row.value);
        if (deltaGoal) {
          const before = pre.get(observationKey(row));
          if (!before || !numeric(before.value) || BigInt(before.value) < 0n) {
            missing.push(`goal:pre:${String(index)}`);
            return {
              index,
              satisfied: null,
              actual: null,
              code: 'MISSING_OR_INVALID_STATE',
            };
          }
          actual -= BigInt(before.value);
          actualValue = actual.toString();
        }
        const minimum =
          goal.kind === 'MIN_ASSET_BALANCE' || goal.kind === 'MIN_POSITION'
            ? BigInt(goal.minAmount)
            : goal.kind === 'MIN_ASSET_BALANCE_DELTA' || goal.kind === 'MIN_POSITION_DELTA'
              ? BigInt(goal.minIncrease)
              : goal.kind === 'MIN_HEALTH_FACTOR'
                ? BigInt(goal.minWad)
                : undefined;
        const maximum = goal.kind === 'MAX_DEBT' ? BigInt(goal.maxAmount) : 0n;
        gap = minimum === undefined ? actual - maximum : minimum - actual;
        satisfied = gap <= 0n;
      }
      if (!satisfied)
        violations.push({
          code: `FINAL_${goal.kind}`,
          key: observationKey(row),
          amount: gap.toString(),
        });
      return {
        index,
        satisfied,
        actual: actualValue,
        code: satisfied ? 'SATISFIED' : 'FINAL_GOAL_VIOLATION',
      };
    },
  );
  const deltas: OracleResult['deltas'] = [];
  for (const [key, after] of post) {
    const before = pre.get(key);
    if (!before) {
      missing.push(`pre:${key}`);
      continue;
    }
    if (numeric(before.value) && numeric(after.value))
      deltas.push({
        key,
        before: before.value,
        after: after.value,
        delta: (BigInt(after.value) - BigInt(before.value)).toString(),
      });
  }
  const exposures = new Map<string, bigint>();
  for (const row of postRows.filter(
    (row) => row.field === 'ALLOWANCE' && norm(row.subject) === norm(contract.account),
  )) {
    if (!numeric(row.value) || BigInt(row.value) < 0n || !row.asset || !row.counterparty) {
      missing.push(`allowance:${observationKey(row)}`);
      continue;
    }
    const key = `${String(row.chainId)}:${norm(row.asset)}`;
    exposures.set(key, (exposures.get(key) ?? 0n) + BigInt(row.value));
  }
  const gross = new Map<string, bigint>();
  let gas = 0n;
  if (input.evidenceLevel === 'EXECUTED_FORK') {
    for (const receipt of input.receipts ?? []) {
      if (!receipt.gasCostWei || !/^(0|[1-9]\d*)$/.test(receipt.gasCostWei)) {
        missing.push(`receipt:gas:${receipt.transactionHash}`);
      } else {
        gas += BigInt(receipt.gasCostWei);
      }
    }
  }
  if (!input.observedEffects) missing.push('gross-outflow:ordered-events-required');
  for (const effect of z.array(EconomicEffectSchema).parse(input.observedEffects ?? [])) {
    if (input.evidenceLevel === 'EXECUTED_FORK' && effect.phase !== 'OBSERVED')
      missing.push(`effect:not-observed:${effect.id}`);
    if (effect.kind === 'UNKNOWN') missing.push(`effect:unknown:${effect.id}`);
    if (effect.kind === 'TRANSFER' && norm(effect.from) === norm(contract.account)) {
      const key = `${String(effect.chainId)}:${norm(effect.asset)}`;
      gross.set(key, (gross.get(key) ?? 0n) + BigInt(effect.amount));
    }
    // BRIDGE is a source-departure abstraction; don't also supply its duplicate ERC20 flow.
    if (effect.kind === 'BRIDGE') {
      const key = `${String(effect.sourceChainId)}:${norm(effect.asset)}`;
      gross.set(key, (gross.get(key) ?? 0n) + BigInt(effect.amount));
    }
    if (
      input.evidenceLevel === 'EXPECTED_FIXTURE' &&
      effect.kind === 'GAS' &&
      norm(effect.payer) === norm(contract.account)
    )
      gas += BigInt(effect.maxFeeWei);
  }
  for (const [key, amount] of gross) {
    const budget = contract.safety.assetBudgets.find(
      (b) => `${String(b.chainId)}:${norm(b.asset)}` === key,
    );
    const gap = amount - BigInt(budget?.maxGrossOutflow ?? '0');
    if (gap > 0n) violations.push({ code: 'GROSS_OUTFLOW_EXCEEDED', key, amount: gap.toString() });
  }
  for (const [key, amount] of exposures) {
    const budget = contract.safety.assetBudgets.find(
      (b) => `${String(b.chainId)}:${norm(b.asset)}` === key,
    );
    const gap = amount - BigInt(budget?.maxAllowanceExposure ?? '0');
    if (gap > 0n)
      violations.push({ code: 'ALLOWANCE_EXPOSURE_EXCEEDED', key, amount: gap.toString() });
  }
  if (gas > BigInt(contract.safety.maxGasWei))
    violations.push({
      code: 'GAS_BUDGET_EXCEEDED',
      key: 'gas',
      amount: (gas - BigInt(contract.safety.maxGasWei)).toString(),
    });
  const disagreements: OracleResult['disagreements'] = [];
  for (const expected of input.expectedPostState ?? []) {
    const actual = post.get(observationKey(expected));
    if (!actual || norm(actual.value) !== norm(expected.value))
      disagreements.push({
        key: observationKey(expected),
        expected: expected.value,
        actual: actual?.value ?? null,
      });
  }
  const expectedDeltaRows = z.array(StateDeltaExpectationSchema).parse(input.expectedDeltas ?? []);
  const seenDeltaKeys = new Set<string>();
  for (const expected of expectedDeltaRows) {
    const key = observationKey({
      ...expected,
      value: expected.delta,
      source: 'EXPECTED_FIXTURE',
    });
    if (seenDeltaKeys.has(key)) {
      missing.push(`expected-delta:duplicate:${key}`);
      continue;
    }
    seenDeltaKeys.add(key);
    const actual = deltas.find((candidate) => candidate.key === key)?.delta;
    const matches =
      actual !== undefined &&
      (expected.comparison === 'EXACT'
        ? BigInt(actual) === BigInt(expected.delta)
        : expected.comparison === 'AT_LEAST'
          ? BigInt(actual) >= BigInt(expected.delta)
          : BigInt(actual) <= BigInt(expected.delta));
    if (!matches)
      disagreements.push({
        key,
        expected: `${expected.comparison}:${expected.delta}`,
        actual: actual ?? null,
      });
  }
  // Missing evidence prevents a terminal claim. Once the available evidence is complete,
  // however, a proven contract violation remains a violation even when the observed outcome
  // also differs from the authored prediction. `DISAGREEMENT` is reserved for unexpected but
  // otherwise contract-satisfying outcomes.
  const status = missing.length
    ? 'INSUFFICIENT_EVIDENCE'
    : violations.length
      ? 'VIOLATION'
      : disagreements.length
        ? 'DISAGREEMENT'
        : 'PASS';
  return {
    status,
    decision: status === 'PASS' ? 'ALLOW' : status === 'VIOLATION' ? 'DENY' : 'ESCALATE',
    evidenceLevel: input.evidenceLevel,
    finalGoals,
    deltas,
    violations,
    allowanceExposure: [...exposures].map(([key, amount]) => ({ key, amount: amount.toString() })),
    missing: [...new Set(missing)],
    disagreements,
  };
}
