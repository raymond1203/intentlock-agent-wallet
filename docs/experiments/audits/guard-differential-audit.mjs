/** Descriptive, post-hoc pairing of immutable attempt-1 results; no experiment execution. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const rawPath = 'experiments/results/primary-solo-v0.4.0-01/raw.jsonl';
const manifestPath = 'experiments/configs/case-manifest.json';
const read = (p) => readFileSync(p, 'utf8');
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const all = read(rawPath).trim().split('\n').map(JSON.parse);
const retained = all.filter((r) => r.attempt === 1).map((r) => r.result);
const manifest = JSON.parse(read(manifestPath));
assert.equal(all.length, 2092);
assert.equal(retained.length, 2000);
assert.equal(manifest.entries.length, 400);
const systems = ['GUARD_MODE', 'INTENTLOCK', 'PER_CALL_POLICY'];
const indexed = Object.fromEntries(
  systems.map((system) => {
    const rows = retained.filter((r) => r.record.system === system);
    const map = new Map(rows.map((r) => [r.record.caseId, r]));
    assert.equal(rows.length, 400);
    assert.equal(map.size, 400, `Duplicate case in ${system}`);
    return [system, map];
  }),
);
const unsafe = (r) =>
  r.record.counterfactualEconomicEffectIssued && r.record.postStateStatus === 'VIOLATION';
const compact = (r) => {
  assert.equal(r.verdict.decision, r.record.preSignDecision);
  return {
    preSignDecision: r.record.preSignDecision,
    reasons: r.verdict.reasonCodes,
    postStateMonitorDecision: r.postStateMonitorDecision,
    authoredOutcome: r.record.postStateStatus,
    effectIssued: r.record.counterfactualEconomicEffectIssued,
    benignCompletion: r.record.counterfactualBenignCompletion,
    unsafeAuthorization: unsafe(r),
  };
};
const cases = manifest.entries.map((entry) => {
  const rows = systems.map((system) => {
    const r = indexed[system].get(entry.caseId);
    assert(r, `Missing ${system}/${entry.caseId}`);
    assert.equal(r.scenarioSha256, entry.scenarioSha256);
    assert.equal(r.mutationOperator, entry.mutationOperator);
    return r;
  });
  assert.equal(new Set(rows.map((r) => r.oracleExpectedDecision)).size, 1);
  return {
    caseId: entry.caseId,
    scenarioSha256: entry.scenarioSha256,
    mutationOperator: entry.mutationOperator,
    variant: entry.variant,
    oracleExpectedDecision: rows[0].oracleExpectedDecision,
    ...Object.fromEntries(systems.map((system, i) => [system, compact(rows[i])])),
  };
});
const countBy = (rows, key) =>
  Object.fromEntries(
    [...new Set(rows.map(key))]
      .sort()
      .map((value) => [value, rows.filter((r) => key(r) === value).length]),
  );
const guardDelta = cases.filter(
  (r) => r.GUARD_MODE.unsafeAuthorization && !r.INTENTLOCK.unsafeAuthorization,
);
const perCallDelta = cases.filter(
  (r) => r.PER_CALL_POLICY.unsafeAuthorization && !r.INTENTLOCK.unsafeAuthorization,
);
const firstReason = (r) => {
  assert.equal(r.INTENTLOCK.reasons.length, 1);
  assert.equal(r.INTENTLOCK.preSignDecision, 'DENY');
  return r.INTENTLOCK.reasons[0];
};
const guardFirstReasons = countBy(guardDelta, firstReason);
const perCallFirstReasons = countBy(perCallDelta, firstReason);
assert.deepEqual(guardFirstReasons, {
  ALLOWANCE_EXPOSURE_EXCEEDED: 8,
  GAS_BUDGET_EXCEEDED: 52,
  IDEMPOTENCY_REPLAY: 12,
  SLIPPAGE_EXCEEDED: 10,
  TARGET_NOT_ALLOWED: 1,
});
assert.deepEqual(perCallFirstReasons, { GROSS_OUTFLOW_EXCEEDED: 15, IDEMPOTENCY_REPLAY: 41 });
// Do not attribute extra per-call rules to stateful history.
for (const row of guardDelta.filter((r) => firstReason(r) !== 'IDEMPOTENCY_REPLAY')) {
  assert.equal(row.PER_CALL_POLICY.preSignDecision, 'DENY');
  assert(row.PER_CALL_POLICY.reasons.includes(firstReason(row)));
}
const summary = {
  pairedCases: cases.length,
  unsafeAuthorizations: Object.fromEntries(
    systems.map((s) => [s, cases.filter((r) => r[s].unsafeAuthorization).length]),
  ),
  guardToIntentlockPreSign: countBy(
    cases,
    (r) => `${r.GUARD_MODE.preSignDecision}->${r.INTENTLOCK.preSignDecision}`,
  ),
  guardAlreadyHeld: cases.filter((r) => r.GUARD_MODE.preSignDecision === 'ABSTAIN').length,
  guardAlreadyHeldWithRollingOutflowReason: cases.filter(
    (r) =>
      r.GUARD_MODE.preSignDecision === 'ABSTAIN' &&
      r.GUARD_MODE.reasons.includes('ROLLING_OUTFLOW_EXCEEDED'),
  ).length,
  guardUnsafeButIntentlockNotUnsafe: {
    count: guardDelta.length,
    firstReportedReason: guardFirstReasons,
  },
  perCallUnsafeButIntentlockNotUnsafe: {
    count: perCallDelta.length,
    firstReportedReason: perCallFirstReasons,
    mutations: countBy(perCallDelta, (r) => r.mutationOperator),
  },
  bothGuardAndIntentlockUnsafe: countBy(
    cases.filter((r) => r.GUARD_MODE.unsafeAuthorization && r.INTENTLOCK.unsafeAuthorization),
    (r) => r.mutationOperator,
  ),
  intentlockUnsafeButGuardNotUnsafe: cases.filter(
    (r) => r.INTENTLOCK.unsafeAuthorization && !r.GUARD_MODE.unsafeAuthorization,
  ).length,
  guardAllowIntentlockAbstain: countBy(
    cases.filter(
      (r) => r.GUARD_MODE.preSignDecision === 'ALLOW' && r.INTENTLOCK.preSignDecision === 'ABSTAIN',
    ),
    (r) => r.mutationOperator,
  ),
  bothPreSignAllowByMutation: countBy(
    cases.filter(
      (r) => r.GUARD_MODE.preSignDecision === 'ALLOW' && r.INTENTLOCK.preSignDecision === 'ALLOW',
    ),
    (r) => r.mutationOperator ?? 'BENIGN_ORIGINAL',
  ),
};
assert.deepEqual(summary.unsafeAuthorizations, {
  GUARD_MODE: 93,
  INTENTLOCK: 10,
  PER_CALL_POLICY: 66,
});
assert.deepEqual(summary.guardToIntentlockPreSign, {
  'ABSTAIN->DENY': 147,
  'ALLOW->ABSTAIN': 65,
  'ALLOW->ALLOW': 105,
  'ALLOW->DENY': 83,
});
assert.equal(summary.guardAlreadyHeldWithRollingOutflowReason, 54);
assert.equal(summary.intentlockUnsafeButGuardNotUnsafe, 0);
const artifact = {
  artifactType: 'POST_HOC_DESCRIPTIVE_PAIRED_POLICY_AUDIT',
  analyzedAt: '2026-09-12',
  inputs: { [rawPath]: sha(rawPath), [manifestPath]: sha(manifestPath) },
  selection:
    'attempt === 1; join by system + caseId; verify scenario hash against manifest; all 400 cases retained',
  unsafeDefinition:
    'counterfactualEconomicEffectIssued && postStateStatus === VIOLATION; authored labels, not observed financial loss',
  firstReasonCaveat:
    'First reported stop reason depends on rule order, not an independent causal contribution or a count of economically feasible attacks.',
  productComparisonCaveat:
    'GUARD_MODE is the repository emulator, not the operational MetaMask product. No threat-scanner or user-approval outcome is evaluated.',
  experimentRerun: false,
  originalScoresChanged: false,
  summary,
  cases,
};
const path = 'artifacts/guard-differential-audit.json';
const output = JSON.stringify(artifact, null, 2) + '\n';
if (process.argv.includes('--check')) assert.equal(read(path), output, 'Stale paired audit');
else writeFileSync(path, output);
console.log(JSON.stringify({ status: 'PASS', ...summary }));
