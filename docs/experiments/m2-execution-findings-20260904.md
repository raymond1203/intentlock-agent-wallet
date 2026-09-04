# M2 v0.2.0 execution findings — 2026-09-04

## Status and scope

The v0.2.0 candidate has now been executed for all 80 base scenarios on the pinned Ethereum and
Base forks. Failed network attempts remain in the evidence history and successful retries supersede
them only for the latest-result view. This is diagnostic evidence from a dirty integration worktree,
not a frozen benchmark score or a substitute for independent human review.

Public evidence: `benchmark/evidence/m2-execution-diagnostic-20260904.json`.

| Measure                                                           |  Result |
| ----------------------------------------------------------------- | ------: |
| Base scenarios attempted                                          | 80 / 80 |
| Diagnostic executions completed                                   | 80 / 80 |
| Executions without authored prefix-funding correction             | 77 / 80 |
| Final-goal PASS                                                   |      69 |
| Final-goal PASS without authored prefix-funding correction        |      68 |
| Final-goal VIOLATION                                              |      11 |
| Missing execution evidence                                        |       0 |
| Scenarios disagreeing with the synthetic absolute-state reference |      68 |
| Disagreeing reference observation rows                            |     150 |

The execution result is not the final M2 result. `humanReview` remains `PENDING`, the dataset remains
unfrozen, and the observed mismatches require a versioned data decision before performance claims.

LE-09, LE-10, and LE-15 authored an account balance below the amount required by an earlier action
prefix. The diagnostic collector increased only the isolated local test account's starting balance
and recorded the exact correction. LE-10 reaches PASS only under that correction. These three runs
demonstrate the remaining execution path but do not satisfy an unchanged-authored-fixture gate.

## Final-goal violations

All eleven are lending lifecycle cases. The amounts below are the atomic-unit gap above a zero-debt
maximum or below a minimum position; they are not percentages.

| Scenario | Goal             | Gap | Observation                                             |
| -------- | ---------------- | --: | ------------------------------------------------------- |
| LE-02    | minimum position |   1 | aToken balance rounds below the nominal supplied amount |
| LE-03    | maximum debt = 0 |   2 | variable debt accrues between borrow and nominal repay  |
| LE-04    | maximum debt = 0 |   1 | variable debt accrues between borrow and nominal repay  |
| LE-05    | maximum debt = 0 |   3 | variable debt accrues across the multi-action lifecycle |
| LE-06    | maximum debt = 0 |   3 | variable debt accrues across the multi-action lifecycle |
| LE-07    | maximum debt = 0 |   1 | variable debt accrues between borrow and nominal repay  |
| LE-09    | minimum position |   2 | aToken balance rounds below the nominal supplied amount |
| LE-11    | maximum debt = 0 |   2 | variable debt accrues between borrow and nominal repay  |
| LE-12    | maximum debt = 0 |   1 | variable debt accrues between borrow and nominal repay  |
| LE-13    | maximum debt = 0 |   3 | two nominal installments do not cover accrued debt      |
| LE-15    | maximum debt = 0 |   2 | variable debt accrues between borrow and nominal repay  |

These are reproducible protocol semantics, not RPC failures. A temporary 30-second receipt timeout
on LE-13 was eliminated by allowing complex forked Aave transactions up to 120 seconds to mine.

## Candidate defects exposed by execution

### Swap quote and slippage units

Thirty-eight swap actions were quoted from the pinned QuoterV2 deployments. The candidate records a
maximum slippage of 100 bps, but every authored `minAmountOut` implies approximately 9,999 bps of
slippage against the real pinned-block quote. For example, BS-01 stores a WETH quote/minimum of
`1000`/`990` wei for 1 USDC while QuoterV2 returns `526301279457898` wei.

The calls can therefore execute successfully while violating the natural-language 1% constraint.
Execution PASS alone must not be presented as contract alignment. Correcting this requires changing
the quote, minimum, encoded calldata, expected effects, and dependent post-state—not merely changing
the displayed reference value.

### Synthetic absolute-state references

The 150 reference-row disagreements comprise 97 balances, 30 allowances, 14 positions, and 9 debts.
Many synthetic rows assume a recipient or protocol reserve starts at zero, whereas the fixed fork has
pre-existing balances. A transfer delta may be correct even when the authored absolute post-balance
is not. AP-04 and AP-08 additionally annotate a router allowance for Permit2 SignatureTransfer,
although the direct Permit2 caller is the one-use spender and no such router allowance is created.

The final-state oracle and the synthetic reference comparison are intentionally separate. A scenario
can satisfy its explicit goals while disagreeing with a fabricated absolute reference.

### Lending terminal semantics

Repaying the nominal borrowed principal does not guarantee zero variable debt one or more blocks
later. Likewise, the observable aToken balance can round one or two atomic units below the nominal
deposit. Treating these as generic collector tolerances would silently change user intent.

For an intent that says “repay the loan” and requires zero debt, the executable plan should use a
full-debt repayment mechanism with an explicitly budgeted interest buffer, then continue to require
zero. If the intent instead says “repay principal,” the contract must state a predeclared residual-
debt bound. Position rounding needs a versioned, chain-independent measurement/tolerance rule agreed
before seeing held-out results.

## Proposed v0.3.0 correction policy

This section is a proposal, not an applied relabeling.

1. Recompute every swap quote at the existing pinned block and route. Set `minAmountOut` from the
   declared `maxSlippageBps`, update calldata and dependent effects, and record the quote provenance.
2. Replace fabricated third-party/protocol absolute balances with pinned pre-state plus expected
   delta, or compare deltas for those rows. Keep account-owned allowance, position, and debt goals as
   directly observed final-state checks.
3. Correct Permit2 SignatureTransfer spender/allowance semantics for AP-04 and AP-08. Preserve the
   underlying token approval to Permit2 as setup evidence, not a router allowance claim.
4. For zero-debt intents, encode full repayment and an explicit interest buffer. For principal-only
   intents, preserve nominal repayment and declare a bounded residual before execution.
5. Adopt one documented Aave position measurement rule and validate it on both pinned networks.
   Do not choose per-case tolerances from these eleven observed gaps.
6. Bump the dataset version, regenerate schemas/manifests/splits/review packets, rerun affected
   baselines, and execute a clean 80-case run from the committed candidate.
7. Complete the two independent human submissions and adjudicate every disagreement before freeze.

Until these steps are approved and completed, the defensible claim is that the collector executed
all v0.2.0 paths (77 without and 3 with explicit prefix-funding correction) and discovered material
data-contract defects—not that M2 is complete or that the current candidate has a 69/80 benchmark
success rate.
