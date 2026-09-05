import { required } from '../../src/domain/required.js';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BenchmarkScenarioSchema } from '../../src/benchmark/scenario.js';
import {
  GuardModeEmulator,
  guardModeConfigFromScenario,
  evaluateGuardMode,
} from '../../src/baselines/guard-mode-emulator.js';
const base = BenchmarkScenarioSchema.parse(
  JSON.parse(readFileSync('benchmark/scenarios/base/transfer/tr-01.json', 'utf8')),
);
describe('Guard Mode integration boundaries', () => {
  it('does not bypass a nested target allowlist', () => {
    const s = structuredClone(base);
    required(s.trace.expectedEffects[0]).provenance.target = `0x${'ab'.repeat(20)}`;
    expect(evaluateGuardMode(s).decision).toBe('ABSTAIN');
  });
  it('does not bypass a nested network allowlist', () => {
    const s = structuredClone(base);
    const effect = required(s.trace.expectedEffects[0]);
    if (effect.kind === 'TRANSFER') effect.chainId = 10;
    expect(evaluateGuardMode(s).reasonCodes).toContain('NETWORK_NOT_ALLOWED');
  });
  it('does not silently treat an unvalued outflow as free', () => {
    const config = guardModeConfigFromScenario(base);
    config.outflowLimits = [];
    expect(new GuardModeEmulator(config).evaluate(base).verdict.reasonCodes).toContain(
      'OUTFLOW_LIMIT_UNDEFINED',
    );
  });
  it('holds invalid or backwards timestamps without committing outflow', () => {
    const engine = new GuardModeEmulator(guardModeConfigFromScenario(base));
    expect(engine.evaluate(base, 'invalid').verdict.decision).toBe('ABSTAIN');
    engine.evaluate(base, '2026-08-30T00:00:00Z');
    const result = engine.evaluate(base, '2026-08-29T00:00:00Z');
    expect(result.verdict.reasonCodes).toContain('INVALID_EVALUATION_TIME');
    expect(result.committed).toEqual([]);
  });
});
