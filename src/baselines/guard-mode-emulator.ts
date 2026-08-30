import { z } from 'zod';

import type { BenchmarkScenario } from '../benchmark/scenario.js';
import type { EconomicEffect } from '../domain/action-ir.js';
import { AssetIdSchema, EvmAddressSchema } from '../domain/intent-contract.js';
import type { BaselineVerdict } from './types.js';

/**
 * Emulator for the publicly documented MetaMask Agent Wallet "Guard Mode" policy.
 *
 * Every rule below is traceable to a public documentation sentence recorded in
 * docs/baselines/guard-mode.md. Behaviour the documentation does not specify is
 * marked ASSUMPTION there and implemented in the way most favourable to the
 * baseline, so the comparison is not a strawman.
 *
 * This is not a reproduction of the private MetaMask backend and must never be
 * reported as one.
 */

export const GUARD_REASON_CODES = {
  /** Documented: anything outside the allowlists is held for user approval. */
  GUARD_APPROVAL_REQUIRED: 'GUARD_APPROVAL_REQUIRED',
  NETWORK_NOT_ALLOWED: 'NETWORK_NOT_ALLOWED',
  ADDRESS_NOT_ALLOWED: 'ADDRESS_NOT_ALLOWED',
  TOKEN_RECIPIENT_NOT_ALLOWED: 'TOKEN_RECIPIENT_NOT_ALLOWED',
  /** Only under the STRICT reading of the address allowlist. */
  APPROVAL_SPENDER_NOT_ALLOWED: 'APPROVAL_SPENDER_NOT_ALLOWED',
  ROLLING_OUTFLOW_EXCEEDED: 'ROLLING_OUTFLOW_EXCEEDED',
  /** Documented: untrackable outflow falls back to the allowlists. */
  OUTFLOW_UNTRACKED_FALLBACK: 'OUTFLOW_UNTRACKED_FALLBACK',
  /** Documented: signatures such as Permit2 are not part of the outflow total. */
  SIGNATURE_OUTSIDE_OUTFLOW: 'SIGNATURE_OUTSIDE_OUTFLOW',
} as const;

export type GuardReasonCode = (typeof GUARD_REASON_CODES)[keyof typeof GUARD_REASON_CODES];

export const GuardModeOutflowLimitSchema = z
  .object({
    chainId: z.number().int().positive(),
    asset: AssetIdSchema,
    maxAmount: z.string().regex(/^(0|[1-9]\d*)$/),
  })
  .strict();

export const GuardModeConfigSchema = z
  .object({
    networkAllowlist: z.array(z.number().int().positive()).min(1),
    addressAllowlist: z.array(EvmAddressSchema).min(1),
    tokenRecipientAllowlist: z.array(EvmAddressSchema).min(1),
    outflowLimits: z.array(GuardModeOutflowLimitSchema),
    rollingWindowSeconds: z.number().int().positive(),
    /**
     * The public documentation names an "Address allowlist" without saying
     * whether an approval spender counts as an address. `STRICT` takes the
     * charitable reading and holds approvals to unlisted spenders; `LITERAL`
     * applies the allowlists only to call targets and token recipients.
     * Results must report which reading produced them.
     */
    approvalSpenderPolicy: z.enum(['STRICT', 'LITERAL']),
  })
  .strict();

export type GuardModeConfig = z.infer<typeof GuardModeConfigSchema>;

/** Documented rolling window length: 24 hours. */
export const ROLLING_WINDOW_SECONDS = 86_400;

interface OutflowEntry {
  atMs: number;
  key: string;
  amount: bigint;
}

function normalize(value: string): string {
  return value.toLowerCase();
}

function budgetKey(chainId: number, asset: string): string {
  return `${String(chainId)}:${normalize(asset)}`;
}

function includesAddress(list: readonly string[], candidate: string): boolean {
  return list.some((entry) => normalize(entry) === normalize(candidate));
}

/**
 * Derives Guard Mode allowlists and limits from the same intent contract the
 * user confirmed. A real operator configures Guard Mode by hand; giving the
 * baseline exactly the user's own scope keeps the comparison fair.
 */
export function guardModeConfigFromScenario(
  scenario: BenchmarkScenario,
  approvalSpenderPolicy: GuardModeConfig['approvalSpenderPolicy'] = 'STRICT',
): GuardModeConfig {
  const { safety } = scenario.intent;
  return GuardModeConfigSchema.parse({
    networkAllowlist: safety.chainScopes.map((scope) => scope.chainId),
    addressAllowlist: safety.chainScopes.flatMap((scope) =>
      scope.allowedTargets.map((permission) => permission.target),
    ),
    tokenRecipientAllowlist: safety.chainScopes.flatMap((scope) => scope.allowedRecipients),
    outflowLimits: safety.assetBudgets.map((budget) => ({
      chainId: budget.chainId,
      asset: budget.asset,
      maxAmount: budget.maxGrossOutflow,
    })),
    rollingWindowSeconds: ROLLING_WINDOW_SECONDS,
    approvalSpenderPolicy,
  });
}

/**
 * Outflow attribution. Transfers leaving the account and bridge departures move
 * value, so they count. Approvals and Permit2 signatures do not, because the
 * public outflow policy states that signatures are excluded. That exclusion is
 * the behaviour under study, not an emulator shortcut.
 */
function outflowByBudget(
  effects: readonly EconomicEffect[],
  account: string,
): { totals: Map<string, bigint>; sawExcludedSignature: boolean } {
  const totals = new Map<string, bigint>();
  let sawExcludedSignature = false;
  const owner = normalize(account);

  for (const effect of effects) {
    switch (effect.kind) {
      case 'TRANSFER': {
        if (normalize(effect.from) !== owner) break;
        const key = budgetKey(effect.chainId, effect.asset);
        totals.set(key, (totals.get(key) ?? 0n) + BigInt(effect.amount));
        break;
      }
      case 'BRIDGE': {
        const key = budgetKey(effect.sourceChainId, effect.asset);
        totals.set(key, (totals.get(key) ?? 0n) + BigInt(effect.amount));
        break;
      }
      case 'APPROVAL':
        if (normalize(effect.owner) === owner) sawExcludedSignature = true;
        break;
      case 'SWAP':
      case 'DEBT':
      case 'OWNERSHIP':
      case 'GAS':
      case 'UNKNOWN':
        break;
    }
  }

  return { totals, sawExcludedSignature };
}

/**
 * Recipients the policy checks: where tokens end up.
 *
 * ASSUMPTION: a transfer into an allowlisted contract is a protocol interaction
 * (a swap paying the router), not a payment to an unapproved party. The public
 * documentation does not spell this out, and treating every router transfer as
 * an unapproved recipient would block all legitimate swaps and turn the
 * baseline into a strawman. The swap output recipient is checked instead,
 * because that is where the user's value actually lands.
 */
function recipientsToCheck(
  effects: readonly EconomicEffect[],
  account: string,
): { chainId: number; recipient: string }[] {
  const owner = normalize(account);
  const recipients: { chainId: number; recipient: string }[] = [];
  for (const effect of effects) {
    if (effect.kind === 'TRANSFER' && normalize(effect.from) === owner) {
      recipients.push({ chainId: effect.chainId, recipient: effect.to });
    }
    if (effect.kind === 'SWAP') {
      recipients.push({ chainId: effect.chainId, recipient: effect.recipient });
    }
    if (effect.kind === 'BRIDGE') {
      recipients.push({ chainId: effect.destinationChainId, recipient: effect.recipient });
    }
  }
  return recipients;
}

export interface GuardModeEvaluation {
  verdict: BaselineVerdict;
  /** Outflow actually committed to the rolling window, empty unless the verdict allows. */
  committed: { key: string; amount: bigint }[];
  /** False when an UNKNOWN effect made the transaction unsimulatable. */
  outflowTracked: boolean;
}

/**
 * Stateful emulator. The public policy adds simulated value to the 24-hour
 * total once a transaction is confirmed, so outflow is committed only for
 * allowed scenarios.
 */
export class GuardModeEmulator {
  private readonly config: GuardModeConfig;
  private readonly history: OutflowEntry[] = [];

  constructor(config: GuardModeConfig) {
    this.config = GuardModeConfigSchema.parse(config);
  }

  private spentInWindow(key: string, atMs: number): bigint {
    const cutoff = atMs - this.config.rollingWindowSeconds * 1000;
    let total = 0n;
    for (const entry of this.history) {
      if (entry.key === key && entry.atMs > cutoff) total += entry.amount;
    }
    return total;
  }

  evaluate(scenario: BenchmarkScenario, evaluatedAt = '2026-08-30T00:00:00Z'): GuardModeEvaluation {
    const atMs = Date.parse(evaluatedAt);
    const account = scenario.intent.account;
    const effects = scenario.trace.expectedEffects;
    const reasonCodes: GuardReasonCode[] = [];

    const outflowTracked = !effects.some((effect) => effect.kind === 'UNKNOWN');

    for (const action of scenario.trace.actions) {
      if (!this.config.networkAllowlist.includes(action.chainId)) {
        reasonCodes.push(GUARD_REASON_CODES.NETWORK_NOT_ALLOWED);
      }
      if (!includesAddress(this.config.addressAllowlist, action.target)) {
        reasonCodes.push(GUARD_REASON_CODES.ADDRESS_NOT_ALLOWED);
      }
    }

    for (const { chainId, recipient } of recipientsToCheck(effects, account)) {
      if (!this.config.networkAllowlist.includes(chainId)) {
        reasonCodes.push(GUARD_REASON_CODES.NETWORK_NOT_ALLOWED);
      }
      const approvedRecipient =
        includesAddress(this.config.tokenRecipientAllowlist, recipient) ||
        includesAddress(this.config.addressAllowlist, recipient);
      if (!approvedRecipient) {
        reasonCodes.push(GUARD_REASON_CODES.TOKEN_RECIPIENT_NOT_ALLOWED);
      }
    }

    const { totals, sawExcludedSignature } = outflowByBudget(effects, account);
    if (sawExcludedSignature) reasonCodes.push(GUARD_REASON_CODES.SIGNATURE_OUTSIDE_OUTFLOW);

    if (this.config.approvalSpenderPolicy === 'STRICT') {
      for (const effect of effects) {
        if (effect.kind !== 'APPROVAL' || normalize(effect.owner) !== normalize(account)) continue;
        if (BigInt(effect.amount) === 0n) continue;
        if (!includesAddress(this.config.addressAllowlist, effect.spender)) {
          reasonCodes.push(GUARD_REASON_CODES.APPROVAL_SPENDER_NOT_ALLOWED);
        }
      }
    }

    if (!outflowTracked) {
      // Documented fallback: when a transaction cannot be simulated the policy
      // relies on the allowlists rather than blocking.
      reasonCodes.push(GUARD_REASON_CODES.OUTFLOW_UNTRACKED_FALLBACK);
    } else {
      for (const [key, amount] of totals) {
        const limit = this.config.outflowLimits.find(
          (candidate) => budgetKey(candidate.chainId, candidate.asset) === key,
        );
        if (limit === undefined) continue;
        if (this.spentInWindow(key, atMs) + amount > BigInt(limit.maxAmount)) {
          reasonCodes.push(GUARD_REASON_CODES.ROLLING_OUTFLOW_EXCEEDED);
        }
      }
    }

    const blocking = reasonCodes.filter(
      (code) =>
        code !== GUARD_REASON_CODES.SIGNATURE_OUTSIDE_OUTFLOW &&
        code !== GUARD_REASON_CODES.OUTFLOW_UNTRACKED_FALLBACK,
    );

    if (blocking.length > 0) {
      return {
        verdict: {
          baseline: 'GUARD_MODE_EMULATOR',
          decision: 'ABSTAIN',
          rationale:
            'Outside the configured allowlists or the rolling outflow limit, so the job is held for user approval instead of being auto-executed.',
          reasonCodes: [...new Set([...reasonCodes, GUARD_REASON_CODES.GUARD_APPROVAL_REQUIRED])],
          checkedUnits: scenario.trace.actions.length,
          attempts: 1,
        },
        committed: [],
        outflowTracked,
      };
    }

    const committed = outflowTracked ? [...totals].map(([key, amount]) => ({ key, amount })) : [];
    for (const entry of committed) {
      this.history.push({ atMs, key: entry.key, amount: entry.amount });
    }

    return {
      verdict: {
        baseline: 'GUARD_MODE_EMULATOR',
        decision: 'ALLOW',
        rationale: outflowTracked
          ? 'Every call, recipient, and network is allowlisted and the simulated value fits the remaining 24-hour outflow.'
          : 'The transaction could not be simulated, so the policy fell back to the allowlists, which permit it.',
        reasonCodes: [...new Set(reasonCodes)],
        checkedUnits: scenario.trace.actions.length,
        attempts: 1,
      },
      committed,
      outflowTracked,
    };
  }
}

/** One-shot evaluation with allowlists derived from the scenario's own contract. */
export function evaluateGuardMode(
  scenario: BenchmarkScenario,
  evaluatedAt = '2026-08-30T00:00:00Z',
  approvalSpenderPolicy: GuardModeConfig['approvalSpenderPolicy'] = 'STRICT',
): BaselineVerdict {
  return new GuardModeEmulator(
    guardModeConfigFromScenario(scenario, approvalSpenderPolicy),
  ).evaluate(scenario, evaluatedAt).verdict;
}
