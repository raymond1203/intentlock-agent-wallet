# M2 completion plan — current v0.4.0 status (2026-09-04)

## Historical audited remote state — 2026-09-03

- #20–#26 are OPEN. Main contains M1, not M2.
- #46 contains the first 40 bases, 14 mutations and per-call/LLM adapters.
- Billy's #47 contains the public-docs Guard Mode emulator (26 tests).
- Billy's #48 fixes identifier leakage and removes two held-out examples from development review.
- Billy's reviews on #46 identify F1 identity leakage, F2 held-out exposure and F3 an
  indistinguishable pre-sign stale-quote case. No completed independent labels are submitted yet.
- #22 reports unsupported bridge/lending calldata; #24 has no implementation on the remote.
- Dependency PRs #42–#45 are outside this M2 integration; do not mix upgrades into the experiment.

## Historical integration order

1. Integrate #47/#48 in the existing #46 branch, preserving Billy's work.
2. Remove residual class hints, invalidate v1 output, separate PRE_SIGN and POST_STATE scoring,
   and rerun the same 20-case LLM adapter validation with the approved local key.
3. Add source-grounded Across/CCTP/Aave decoders, fail closed on unsupported variants, and
   construct the missing 15 bridge + 15 lending + 10 batch/recovery bases.
4. Implement exact integer state comparison, final goals, receipt disagreement and explicit
   missing-evidence states. Expected fixtures must never be reported as executed observations.
5. Generate deterministic labels, shared baseline input/scoring and review packets; run unit,
   schema, generation and available pinned-fork validation.
6. Post evidence to #20–#26 and update #46. Keep unfulfilled execution/human-review gates open.

## Completion gates (not assumptions)

| Gate | Required evidence                                                                    |
| ---- | ------------------------------------------------------------------------------------ |
| #20  | Schema/label/split tests + 10 independently submitted labels                         |
| #21  | 40 bases + scenario-specific normal execution + 10 contract reviews                  |
| #22  | 40 additional bases + source/destination execution + 10 reviews                      |
| #23  | Mutation coverage/replay/validity + 20 independent reviews                           |
| #24  | Exact oracle for 80 bases, zero synthetic disagreements + two reviewers/adjudication |
| #25  | Official-source mapping + emulator tests + independent implementation review         |
| #26  | Fixed settings + v0.4.0 leakage-free live 20 + 20 rationale reviews                  |

## Research-integrity constraints

- v1 17/20 is invalid because identifiers exposed labels. The direction of the rerun is unknown;
  neither a lower score nor the model's use of that shortcut can be assumed in advance.
- Previously published held-out cases are exposed. Removing them from a packet cannot undo
  publication; document contamination and do not claim a secret/unseen test set.
- A post-state-only case is not a pre-sign false negative. Report denominators by stage.
- Human review, API availability and chain execution are separate gates. AI tests are not a
  substitute for either person's independent labels.
- The user explicitly declined CodeRabbit. Authentication was stopped; review uses source
  inspection and tests, not CodeRabbit. No automated or human approval is fabricated.

## Historical implementation checkpoint

- Integrated Billy's #47/#48 locally into the existing #46 branch; no additional PR created.
- Inventory expanded to 80 bases and 15 mutation operators, including partial completion.
- Added Across/CCTP/Aave decoders, explicit fixture evidence/stages, cumulative debt-peak checks,
  exact-state oracle, 20-of-80 double-review packets and generated CI checks.
- Removed residual class leakage and separated cross-stage policy/outcome differences from
  same-stage disagreements. Corrected Guard Mode product-equivalence and fail-open overclaims.
- Local check: 405 passed; configured Ethereum/Base fork integration: 14 passed. Representative
  supply showed 1–2 units of position rounding, so nominal fixture equality is not execution proof.
- Live v2 validation: 17/20 exact matches, clean source commit, all requests completed in one
  attempt. Full input/output hash and mismatch details are in the baseline validation report.

## Historical next-work note (superseded)

1. Build per-scenario execution collectors: valid Permit2 signing, pinned swap quotes, batch-account
   setup, and receipts/gas/allowance snapshots. Start with the existing transfer/approval cases.
2. Extend collectors to Aave lifecycle and cross-chain fixtures. Resolve rounding and debt/solvency
   from actual state. Clearly identify any simulated relayer/attestation; do not silently relax goals.
3. Reconcile predicted effects and actual observations per scenario. Independently label and resolve
   differences; policy violations and realized loss remain different evaluation targets.
4. Both humans submit blind reviews and adjudication using stable pseudonyms. Re-freeze the candidate,
   rerun affected baselines, then merge #46 and close only acceptance-complete M2 issues.

At the 2026-09-03 checkpoint, M2 was **not complete**: all 80 scenario-specific executions,
independent labels, and experimental re-freeze still remained. The checkpoint below supersedes the
execution-count part of that statement; a clean strict-authored rerun and the human gates remain.

## Execution checkpoint — 2026-09-04

- The scenario-specific collector now covers Permit2 signing, pinned QuoterV2 reads, isolated
  ERC-7821 batch execution, Across/CCTP local relay fixtures, and Aave lifecycle post-state.
- All 80 base paths completed after retaining failed RPC attempts and retrying only incomplete cases.
  Seventy-seven used authored prefix funding unchanged; LE-09, LE-10, and LE-15 required an explicit
  local account funding correction. Latest diagnostic results are 69 PASS and 11 lending VIOLATION,
  with no missing execution evidence. The compact artifact is
  `benchmark/evidence/m2-execution-diagnostic-20260904.json`.
- The run exposed a material candidate defect: 38 swap actions declare a 100 bps maximum but their
  encoded minima imply about 9,999 bps against the pinned quote. It also exposed fabricated absolute
  post-state rows, incorrect Permit2 spender annotations, and 1–3 atomic-unit Aave rounding/interest
  gaps. See `docs/experiments/m2-execution-findings-20260904.md`.
- At that checkpoint, the 80-execution gate was evidenced diagnostically, but not as a clean frozen
  run. Dataset correction/versioning, regenerated packets, two independent human submissions,
  adjudication, and re-freeze remained open. That diagnostic did not authorize closing #20–#26.

## Historical v0.3.0 correction checkpoint — 2026-09-04

- The approved correction policy is implemented in the authored source and regenerated dataset:
  pinned QuoterV2 minima, delta references, Permit2 one-use semantics, deterministic Aave rounding
  and interest rules, and ordered-prefix funding.
- The v0.2.0 80-path artifact remains historical defect-discovery evidence. It is not counted as a
  v0.3.0 execution. At this checkpoint, v0.3.0 status was zero executed / `NOT_COLLECTED` until the
  corrected candidate could be committed cleanly and replayed.
- Review packets were regenerated with empty human fields. Two independent submissions,
  adjudication, the clean 80-path replay, live 20-case model baseline, and re-freeze were still
  human or external execution gates.

## Rejected v0.3.0 clean replay — historical diagnostic

- A later clean v0.3.0 run completed all 80 authored paths and reported 80/80 normal final-goal
  `PASS`. That count did not establish reference correctness.
- Independent reconciliation found seven synthetic reference disagreements: BS-01, BS-02, BS-04,
  BS-05, BS-07, BS-08 and BS-10 retained the approval amount as terminal allowance after a matching
  `transferFrom` had consumed it.
- ADR 0010 corrects the residual allowance to approval minus later matching consumption and bumps
  the dataset to v0.4.0. Decisions, labels, splits, quotes, calldata and oracle operators stay fixed.
- The v0.3.0 run, any v0.3.0 LLM result and every derived freeze candidate are rejected diagnostic
  provenance. They cannot contribute rows, reviews, counts or hashes to current M2 completion.

## Current v0.4.0 executable work, in order

Current status is zero collected v0.4.0 executions, no version-matched live LLM output, no two
complete independent human submissions, and no valid freeze. Generated packets and an offline
`syntheticReferenceDisagreementCount: 0` field are specifications, not proof that the executed gate
has passed.

1. Commit one exact v0.4.0 candidate and make the source tree clean. Run the repository, contract,
   schema and generator checks before using external RPC or model services.
2. Collect all 80 executions into append-only directories and publish only exact v0.4.0 bytes:

   ```powershell
   pnpm m2:execute --out=experiments/results/m2-v0.4.0-attempt-01
   pnpm m2:evidence --runs=experiments/results/m2-v0.4.0-attempt-01 --out=benchmark/evidence/m2-execution-v0.4.0.json --require-all-executed
   pnpm m2:validate
   pnpm m2:validate --check
   ```

   A retry uses `m2-v0.4.0-attempt-02` and both run directories are passed to `--runs=` in actual
   chronological order. Acceptance requires 80 complete strict-authored executions and **zero
   synthetic reference disagreements**. Any nonzero count invalidates the candidate evidence even
   if all 80 normal execution decisions are PASS.

3. While the exact candidate remains clean, run the fixed current live baseline:

   ```powershell
   pnpm baseline:llm:run
   ```

   Its canonical tracked result is `benchmark/evidence/llm-verifier-20-v0.4.0.json`; its public review packet is
   `experiments/configs/baselines/llm-verifier-20-review-v0.4.0.json`. The independent human rationale
   submission belongs at
   `experiments/configs/baselines/llm-verifier-20-rationale-review-v0.4.0.json`; `m2:validate` binds
   the Git-`HEAD` bytes to the current ordered sample, redacted inputs, config and packet hashes, and
   the single exact M2 execution source commit. The pending `.template.json` file is not a completed
   human submission. Do not reuse v0.2.0 or v0.3.0 packets or results.

4. Two actual people independently complete submissions derived from
   `benchmark/reviews/submission.template.json`, then adjudicate every disagreement against the exact
   v0.4.0 packet. Automated checks cannot attest human identity or independence.
5. Run `pnpm m2:reviews --require-complete` and repeat M2 validation. Freeze only the commit bound to
   the accepted execution, live baseline, two submissions and adjudication. Until then, M2 and its
   dependent issues remain open.
