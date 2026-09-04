# M2 completion plan — 2026-09-03

## Audited remote state

- #20–#26 are OPEN. Main contains M1, not M2.
- #46 contains the first 40 bases, 14 mutations and per-call/LLM adapters.
- Billy's #47 contains the public-docs Guard Mode emulator (26 tests).
- Billy's #48 fixes identifier leakage and removes two held-out examples from development review.
- Billy's reviews on #46 identify F1 identity leakage, F2 held-out exposure and F3 an
  indistinguishable pre-sign stale-quote case. No completed independent labels are submitted yet.
- #22 reports unsupported bridge/lending calldata; #24 has no implementation on the remote.
- Dependency PRs #42–#45 are outside this M2 integration; do not mix upgrades into the experiment.

## Execution order

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
| #24  | Exact oracle for 80 bases and generated traces + two reviewers on 25% + adjudication |
| #25  | Official-source mapping + emulator tests + independent implementation review         |
| #26  | Fixed settings + leakage-free live 20 + 20 rationale reviews                         |

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

## Implemented in this integration

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

## Next executable work, in order

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
- The 80-execution gate is now evidenced diagnostically, but not yet as a clean frozen run. Dataset
  correction/versioning, regenerated packets, two independent human submissions, adjudication, and
  re-freeze remain open. Do not merge #46 or close #20–#26 before those gates are satisfied.
