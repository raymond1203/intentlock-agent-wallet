# Base scenario validation — candidate 0.3.0

## Deterministic reference checks

The 80 bases comprise transfer/approval 20, swap/batched swap 20, bridge 15, lending 15 and
batch/revoke/recovery 10. All pass schema validation, ABI-to-effect construction, reference
post-state oracle checks and the pre-sign IntentLock ALLOW path. The split has 48 TRAIN, 16 DEV
and 16 publicly exposed HIDDEN_TEST records. It is not a secret held-out set and re-freeze is pending.

The v0.3.0 correction pins all 38 swap effects to QuoterV2 fixture outputs and exact 100bps minima,
uses account-side delta references, corrects Permit2 SignatureTransfer semantics, applies one
chain-independent Aave position tolerance, separates principal-only from full-debt repayment, and
funds every ordered prefix. These are authored fixture corrections, not new execution results.

`pnpm benchmark:check` verifies generator reproducibility. `pnpm m2:validate --check` checks
the committed reference diagnostics and review packets. Reference PASS is not execution evidence.

## Actual pinned-fork checks

On 2026-09-03, 14/14 integration tests passed against pinned Ethereum block 25773000 and Base
block 50080000. They validate block/code hashes, fixture operations, decoders and representative
signed transfer/Aave-supply paths. Both chain-specific Aave checks collect successful receipts,
query actual balances and positions, and pass the EXECUTED_FORK oracle for their smoke-test goals.

These checks are **representative, not 80 scenario-specific v0.3.0 replays**. The current-version
per-base executed count therefore remains zero. Live evidence is kept separate from generated JSON; generated state rows
are explicitly marked EXPECTED_FIXTURE.

The public summary is `experiments/configs/m2-fork-validation.json`. Historical Aave position amounts
were 9,999,998 and 9,999,999 for 10,000,000 underlying units supplied. The smoke test deliberately
requires a positive position, not nominal equality; generated lending goals still need rounding-aware
execution verification. Do not silently relax those authored goals to turn a failure into a pass.

## Remaining acceptance work

- Replace synthetic Permit2 signatures with reproducible valid signatures.
- Execute route quotes with pinned pool state, accounting for fees and minimum-output reverts.
- Exercise actual source bridge deposits and an explicit destination settlement fixture; report
  simulated relaying/attestation honestly, never as real cross-chain production settlement.
- Execute Aave borrow/repay/withdraw with solvency, interest, rounding and allowance consumption.
- Collect per-action receipts, gas and complete state observations for each base; reconcile
  mismatches rather than adjusting expected values silently.
- Record the independent contract reviews and 25% double-label/adjudication process.

Until these are complete, #21/#22 execution acceptance and M2 completion remain open.
