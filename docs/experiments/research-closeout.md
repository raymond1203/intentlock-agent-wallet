# Research issue closeout map

This file is an evidence map, not a completion claim. An issue is ready to close only when every
machine-verifiable check and every explicitly human acceptance gate below has a real artifact.

## M2 — benchmark and baselines

| Issue                         | Implemented evidence                                                                 | Remaining closeout gate                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| #20 schema, labels, split     | v0.3 schemas, labeling guide, deterministic split and case-manifest checks           | independent 10-case labeling submission                                               |
| #21 transfer/approval/swap 40 | 40 schema-valid base scenarios and coverage checks                                   | clean fixed-fork evidence; independent 10-case contract review                        |
| #22 bridge/lending/batch 40   | 40 schema-valid base scenarios, cross-chain and prefix/final-goal metadata           | clean fixed-fork evidence; independent 10-case review                                 |
| #23 mutations                 | deterministic operators, semantic-validity checks, no-op/invalid distinction         | independent 20-mutation review and adjudication                                       |
| #24 oracle                    | exact delta oracle, integer violation/exposure fields, review gate                   | 80-case v0.3 execution evidence; two independent 20-case submissions and adjudication |
| #25 Guard Mode emulator       | STRICT/LITERAL public-document emulator and tests                                    | source-to-rule human review; never claim production equivalence                       |
| #26 LLM/per-call baselines    | fixed prompt/model policy, structured output, fail-closed timeout/malformed handling | 20-case API run and independent rationale review                                      |

## M3 — experiments

| Issue                                      | Implemented evidence                                                                                                           | Remaining closeout gate                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| #27 freeze                                 | candidate config, deterministic 400-case generator, code/config/data digests                                                   | M2 complete evidence; real 20-case human dry-run review; clean freeze commit                    |
| #28 primary offline comparison             | append-only five-system runner, sequential accepted-prefix IntentLock, explicit failure/confirmation/detection-ordinal records | frozen config; one complete 400×5 run; 10% human recomputation                                  |
| #29 scripted adaptive signer-boundary test | preregistered 40 cases, three-replan cap, redacted append-only transcript                                                      | clean immutable run; 10 human reproductions; keep `OFFLINE_SCRIPTED_SIGNER_BOUNDARY_ONLY` scope |
| #30 runtime ablation                       | preregistered arm manifest and one-factor evaluator                                                                            | frozen primary commit; complete arm runs; human config-diff review                              |
| #31 analysis                               | grouped bootstrap, paired strongest-baseline interval, figures, per-case atomic exposures and detection ordinals               | complete primary/adaptive/ablation raw results; human sample calculation                        |

The 400-case comparison is `OFFLINE_COUNTERFACTUAL_REPLAY`. `REPLAYED` never means that an EVM
transaction or authorization was actually issued. Actual execution claims require separate
`EXECUTED_FORK` receipt and post-state evidence.

## M4 — paper and submission

| Issue                                      | Implemented evidence                                              | Remaining closeout gate                                                                         |
| ------------------------------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| #32 introduction/related work              | primary-source claim table, takeaways and scoped novelty draft    | frozen result insertion; independent adversarial novelty review                                 |
| #33 method/conditional guarantee           | state-machine draft, proof sketch and architecture generator      | human counterexample review against implementation                                              |
| #34 evaluation/limitations/recommendations | result structure, limitations checklist and five design proposals | generated tables/figures; trace five claims to raw results; remove every placeholder            |
| #35 final audit                            | word/format/path/PII/address/ENS/metadata/placeholder scanner     | private identity-term list; two independent checklists; Notion preview/dry run; final hash/time |

## Required execution order

1. Land the candidate on a clean commit and run all repository checks.
2. Collect v0.3 fixed-fork evidence without overwriting attempts.
3. Complete the M2 human review packet and adjudication.
4. Complete the 20-case experiment dry-run review, freeze config/data/code digests, and commit only
   the frozen manifest.
5. Run the full five-system offline comparison once under the frozen retry policy.
6. Run scripted adaptive and actual one-factor ablation suites from the same frozen source.
7. Generate tables and figures from immutable raw runs, then replace result placeholders.
8. Run the local identity audit with a private forbidden-term list and complete two independent
   Notion submission reviews.

No automation may fill, approve, or impersonate a human-review artifact.
