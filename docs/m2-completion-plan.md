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
