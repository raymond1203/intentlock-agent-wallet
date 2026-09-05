# Exact-state oracle and evidence levels

`evaluatePostState` is independent of the guardrail monitor and stored labels. It uses integer
arithmetic for balance/debt/position deltas, allowance summed across spenders, ordered gross
outflow and gas. Net balance loss is not substituted for gross outflow.

- PASS / VIOLATION: supplied evidence is complete for the requested checks.
- INSUFFICIENT_EVIDENCE: missing/duplicate/invalid states, partial execution, absent economic
  events or missing/reverted/duplicate receipts. This is not an ALLOW.
- DISAGREEMENT: expected and observed states differ. Preserve both instead of silently replacing
  the label with the monitor's answer.

`EXPECTED_FIXTURE` runs are deterministic reference checks only. `EXECUTED_FORK` additionally
requires receipt coverage, real observation sources and OBSERVED effects. Receipt hashes must be
provided by the trusted local execution collector; the pure oracle does not fetch or authenticate
caller-supplied JSON. Completeness of the observation surface remains a collector assumption.
Executed receipt gas costs are mandatory and counted once, not duplicated from GAS effects.
Debt goals sum observations across protocols; ambiguous duplicate balance goals are not accepted.

The oracle checks economic state and ordered outflow, not every calldata authorization rule. The
integration report compares authored labels only when their observation stage is POST_STATE.
Differences between pre-sign policy labels and final-state outcomes are recorded separately, not
scored as oracle errors: a risky approval or widened slippage need not cause realized loss.
Inherited synthetic mutation states are not independent ground truth. Execution/reconciliation and
adjudication are required before using final-state oracle labels as experimental targets.

Final goals include balance minima, position minima, debt maxima, exact ownership, residual
allowance and health factor (integer WAD). A health-factor floor is not inferred from token amounts;
it needs an actual protocol query. The current lending fixtures do not claim health-factor evidence.

Evaluation stages are separate. `scoreDecision` excludes POST_STATE-only stale-quote fixtures from
every PRE_SIGN denominator, including IntentLock. A label taxonomy describes authored causes;
post-state evidence alone does not establish whether an identical effect was malicious or accidental.

## Remaining execution gates

The 80 base fixtures are not 80 fork receipts. Synthetic Permit2 signatures, simplified swap quotes,
bridge destination settlement, allowance consumption, Aave interest/rounding and solvency remain
explicit execution work. A complete submission must collect per-scenario evidence, reconcile it,
and rerun all affected baselines after independent data re-freeze. Do not count fixture PASS as that.

## Independent review

The 25% double-review sample is 20 of 80 bases, stratified across workflows and drawn from TRAIN/DEV.
Both reviewers must submit separate decisions referencing the packet hash. Disagreements need an
adjudication entry. Blank templates and automated test runs are not independent human reviews.
