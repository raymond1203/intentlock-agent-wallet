import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  GUARD_REASON_CODES,
  GuardModeEmulator,
  ROLLING_WINDOW_SECONDS,
  evaluateGuardMode,
  guardModeConfigFromScenario,
} from '../../src/baselines/guard-mode-emulator.js';
import { BenchmarkScenarioSchema, type BenchmarkScenario } from '../../src/benchmark/scenario.js';

function load(relativePath: string): BenchmarkScenario {
  const path = resolve(import.meta.dirname, '../../benchmark/scenarios', `${relativePath}.json`);
  return BenchmarkScenarioSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

const BASE_TRANSFER = load('base/transfer/tr-01');
const BASE_APPROVAL = load('base/transfer/ap-01');
const BASE_SWAP = load('base/swap/ss-01');

describe('guardModeConfigFromScenario', () => {
  it('derives the allowlists from the user contract so the baseline is not handicapped', () => {
    const config = guardModeConfigFromScenario(BASE_TRANSFER);
    expect(config.networkAllowlist).toEqual([1]);
    expect(config.addressAllowlist).toContain(BASE_TRANSFER.trace.actions[0]?.target);
    expect(config.rollingWindowSeconds).toBe(ROLLING_WINDOW_SECONDS);
    expect(config.approvalSpenderPolicy).toBe('STRICT');
  });

  it('defaults the rolling window to the documented 24 hours', () => {
    expect(ROLLING_WINDOW_SECONDS).toBe(86_400);
  });
});

describe('benign scenarios are not blocked', () => {
  it.each([
    ['transfer', BASE_TRANSFER],
    ['approval', BASE_APPROVAL],
    ['swap', BASE_SWAP],
  ])('allows the base %s scenario under both readings', (_name, scenario) => {
    expect(evaluateGuardMode(scenario, undefined, 'STRICT').decision).toBe('ALLOW');
    expect(evaluateGuardMode(scenario, undefined, 'LITERAL').decision).toBe('ALLOW');
  });

  it('does not treat a router transfer as an unapproved token recipient', () => {
    const verdict = evaluateGuardMode(BASE_SWAP);
    expect(verdict.reasonCodes).not.toContain(GUARD_REASON_CODES.TOKEN_RECIPIENT_NOT_ALLOWED);
  });
});

describe('violations the public policy catches', () => {
  it.each([
    ['recipient substitution', 'tr-01-recipient-substitution-2026', 'TOKEN_RECIPIENT_NOT_ALLOWED'],
    ['chain substitution', 'tr-01-chain-substitution-2026', 'NETWORK_NOT_ALLOWED'],
    ['token substitution', 'tr-01-token-substitution-2026', 'ADDRESS_NOT_ALLOWED'],
    ['amount inflation', 'tr-01-amount-inflation-2026', 'ROLLING_OUTFLOW_EXCEEDED'],
    ['retry double spend', 'tr-01-retry-double-spend-2026', 'ROLLING_OUTFLOW_EXCEEDED'],
    ['concurrency race', 'tr-01-concurrency-race-2026', 'ROLLING_OUTFLOW_EXCEEDED'],
    ['policy laundering', 'tr-01-policy-laundering-2026', 'ROLLING_OUTFLOW_EXCEEDED'],
  ])('holds %s for user approval', (_name, fixture, reason) => {
    const verdict = evaluateGuardMode(load(`mutations/${fixture}`));
    expect(verdict.decision).toBe('ABSTAIN');
    expect(verdict.reasonCodes).toContain(reason);
    expect(verdict.reasonCodes).toContain(GUARD_REASON_CODES.GUARD_APPROVAL_REQUIRED);
  });
});

describe('documented gaps the public policy does not cover', () => {
  it('allows an unlimited approval because signatures are outside the outflow calculation', () => {
    const verdict = evaluateGuardMode(load('mutations/ap-01-unlimited-approval-2026'));
    expect(verdict.decision).toBe('ALLOW');
    expect(verdict.reasonCodes).toContain(GUARD_REASON_CODES.SIGNATURE_OUTSIDE_OUTFLOW);
  });

  it('allows a widened Permit2 deadline for the same reason', () => {
    expect(evaluateGuardMode(load('mutations/ap-03-deadline-extension-2026')).decision).toBe(
      'ALLOW',
    );
  });

  it.each([
    ['slippage widening', 'ss-01-slippage-widening-2026'],
    ['stale quote', 'ss-01-stale-quote-2026'],
    ['gas inflation', 'tr-01-gas-inflation-2026'],
  ])('allows %s because the public rules carry no such limit', (_name, fixture) => {
    expect(evaluateGuardMode(load(`mutations/${fixture}`)).decision).toBe('ALLOW');
  });

  it('falls back to the allowlists instead of blocking when a call cannot be simulated', () => {
    const scenario = load('mutations/tr-01-benign-hallucination-2026');
    const evaluation = new GuardModeEmulator(guardModeConfigFromScenario(scenario)).evaluate(
      scenario,
    );
    expect(evaluation.outflowTracked).toBe(false);
    expect(evaluation.verdict.decision).toBe('ALLOW');
    expect(evaluation.verdict.reasonCodes).toContain(GUARD_REASON_CODES.OUTFLOW_UNTRACKED_FALLBACK);
    expect(evaluation.committed).toEqual([]);
  });
});

describe('address allowlist reading', () => {
  const hiddenBatch = load('mutations/bs-01-hidden-batch-2026');

  it('holds a hidden approval to an unlisted spender under the strict reading', () => {
    const verdict = evaluateGuardMode(hiddenBatch, undefined, 'STRICT');
    expect(verdict.decision).toBe('ABSTAIN');
    expect(verdict.reasonCodes).toContain(GUARD_REASON_CODES.APPROVAL_SPENDER_NOT_ALLOWED);
  });

  it('allows the same batch under the literal reading', () => {
    expect(evaluateGuardMode(hiddenBatch, undefined, 'LITERAL').decision).toBe('ALLOW');
  });

  it('still allows an unlimited approval to an allowlisted spender under the strict reading', () => {
    expect(
      evaluateGuardMode(load('mutations/ap-01-unlimited-approval-2026'), undefined, 'STRICT')
        .decision,
    ).toBe('ALLOW');
  });
});

describe('rolling 24-hour outflow', () => {
  it('accumulates only across confirmed transactions and expires with the window', () => {
    const emulator = new GuardModeEmulator(guardModeConfigFromScenario(BASE_TRANSFER));

    const first = emulator.evaluate(BASE_TRANSFER, '2026-08-30T00:00:00Z');
    expect(first.verdict.decision).toBe('ALLOW');
    expect(first.committed).toHaveLength(1);

    const second = emulator.evaluate(BASE_TRANSFER, '2026-08-30T01:00:00Z');
    expect(second.verdict.decision).toBe('ABSTAIN');
    expect(second.verdict.reasonCodes).toContain(GUARD_REASON_CODES.ROLLING_OUTFLOW_EXCEEDED);
    expect(second.committed).toEqual([]);

    const afterWindow = emulator.evaluate(BASE_TRANSFER, '2026-08-31T02:00:00Z');
    expect(afterWindow.verdict.decision).toBe('ALLOW');
  });

  it('does not charge a blocked scenario against the window', () => {
    const emulator = new GuardModeEmulator(guardModeConfigFromScenario(BASE_TRANSFER));
    emulator.evaluate(load('mutations/tr-01-recipient-substitution-2026'), '2026-08-30T00:00:00Z');
    expect(emulator.evaluate(BASE_TRANSFER, '2026-08-30T00:30:00Z').verdict.decision).toBe('ALLOW');
  });

  it('ignores assets that carry no configured limit', () => {
    const config = { ...guardModeConfigFromScenario(BASE_TRANSFER), outflowLimits: [] };
    const emulator = new GuardModeEmulator(config);
    expect(emulator.evaluate(BASE_TRANSFER, '2026-08-30T00:00:00Z').verdict.decision).toBe('ALLOW');
    expect(emulator.evaluate(BASE_TRANSFER, '2026-08-30T00:10:00Z').verdict.decision).toBe('ALLOW');
  });
});

describe('verdict shape', () => {
  it('reports the baseline name and the number of checked calls', () => {
    const verdict = evaluateGuardMode(BASE_SWAP);
    expect(verdict.baseline).toBe('GUARD_MODE_EMULATOR');
    expect(verdict.checkedUnits).toBe(BASE_SWAP.trace.actions.length);
    expect(verdict.attempts).toBe(1);
    expect(verdict.rationale.length).toBeGreaterThan(10);
  });
});
