# Base scenario validation — candidate 0.4.0

## Deterministic reference checks

The 80 bases comprise transfer/approval 20, swap/batched swap 20, bridge 15, lending 15 and
batch/revoke/recovery 10. All pass schema validation, ABI-to-effect construction, reference
post-state oracle checks and the pre-sign IntentLock ALLOW path. The split has 48 TRAIN, 16 DEV
and 16 publicly exposed HIDDEN_TEST records. It is not a secret held-out set and re-freeze is pending.

The v0.3.0 correction pinned all 38 swap effects to QuoterV2 fixture outputs and exact 100bps minima,
uses account-side delta references, corrects Permit2 SignatureTransfer semantics, applies one
chain-independent Aave position tolerance, separates principal-only from full-debt repayment, and
funds every ordered prefix. These are authored fixture corrections, not new execution results.

ADR 0010 adds the v0.4.0 correction: generated terminal ERC-20 allowance subtracts each later
matching `transferFrom` consumption. Seven `SWAP_BATCH` cases now have zero residual allowance.
Expected decisions, labels, oracle operators, splits, pinned quotes, action order and calldata are
unchanged across this bump.

`pnpm benchmark:check` verifies generator reproducibility. `pnpm m2:validate --check` checks
the committed reference diagnostics and review packets. Reference PASS is not execution evidence.

## Actual pinned-fork checks

On 2026-09-03, 14/14 integration tests passed against pinned Ethereum block 25773000 and Base
block 50080000. They validate block/code hashes, fixture operations, decoders and representative
signed transfer/Aave-supply paths. Both chain-specific Aave checks collect successful receipts,
query actual balances and positions, and pass the EXECUTED_FORK oracle for their smoke-test goals.

These checks remain representative smoke tests rather than the canonical 80-scenario replay. A later
clean committed v0.4.0 candidate produced the canonical scenario-specific evidence: all 80 bases
executed, all 80 strict authored goals passed, all 80 synthetic references were checked, and there
were zero reference disagreements. The compact record is
`benchmark/evidence/m2-execution-v0.4.0.json`; its content-addressed raw inputs are under
`benchmark/evidence/raw/v0.4.0/sha256/`. Generated state rows remain explicitly marked
EXPECTED_FIXTURE and are not substituted for those execution records.

A later clean v0.3.0 collector run completed 80/80 normal executions, but reconciliation found seven
synthetic reference disagreements in terminal allowance. ADR 0010 rejects that run and every
derived baseline/freeze candidate. It is diagnostic history, not v0.4.0 execution evidence.

The public summary is `experiments/configs/m2-fork-validation.json`. Historical Aave position amounts
were 9,999,998 and 9,999,999 for 10,000,000 underlying units supplied. The smoke test deliberately
requires a positive position, not nominal equality; generated lending goals still need rounding-aware
execution verification. Do not silently relax those authored goals to turn a failure into a pass.

## Remaining acceptance work

The v0.4.0 execution requirements for #21/#22 are machine-complete: 80/80 strict-authored
executions and 80/80 synthetic reference checks passed with zero disagreements. The fixed live
20-case LLM run and its public review packet are also complete; older v0.2.0 and rejected v0.3.0
outputs are not reused.

- Record two independent human submissions for the exact v0.4.0 packet, all required adjudications,
  contract reviews and staged mutation review.
- Complete the independent human rationale review for the 20-case LLM packet.
- Freeze only the exact reviewed candidate after all machine and human gates pass.

The human acceptance gates and M2 completion remain open until those reviews are complete.
