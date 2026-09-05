# Research issue closeout map

Current workflow: `SOLO_AI_ASSISTED`, selected by the user on 2026-09-05. ADR 0011 and the
[current playbook](solo-closeout-playbook.md) supersede the legacy two-person gates listed below.
The table retains the original issue plan for traceability. Current reporting must distinguish
machine/AI completion, experiment readiness, final author approval and actual external submission.

This file is an evidence map, not a completion claim. An issue is ready to close only when every
machine-verifiable check and every explicitly human acceptance gate below has a real artifact.

## M2 — benchmark and baselines

| Issue                         | Implemented evidence                                                         | Remaining closeout gate                                         |
| ----------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------- |
| #20 schema, labels, split     | v0.4 schemas, labeling guide, deterministic split and case-manifest checks   | independent 10-case labeling submission                         |
| #21 transfer/approval/swap 40 | 40 schema-valid bases, coverage checks and clean fixed-fork evidence         | independent 10-case contract review                             |
| #22 bridge/lending/batch 40   | 40 schema-valid bases, cross-chain metadata and clean fixed-fork evidence    | independent 10-case review                                      |
| #23 mutations                 | deterministic operators, semantic-validity checks, no-op/invalid distinction | independent 20-mutation review and adjudication                 |
| #24 oracle                    | exact delta oracle, 80-case execution evidence and zero-disagreement gate    | two independent 20-case submissions and adjudication            |
| #25 Guard Mode emulator       | STRICT/LITERAL public-document emulator and tests                            | source-to-rule human review; never claim production equivalence |
| #26 LLM/per-call baselines    | fixed policy, fail-closed handling and bound 20-case API run                 | independent 20-case rationale review                            |

Current machine checkpoint: source commit `a0cca37764d3267929f7b74404393c4a1115fc78`
has 80/80 clean fork executions, 80/80 synthetic references checked with zero disagreement, and a
20-case live LLM run with 17 exact matches. These machine facts do not satisfy any human gate;
`experiments/configs/m2-validation.json` therefore keeps M2 incomplete.

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

1. Preserve the completed clean v0.4 candidate, fixed-fork evidence and LLM run. The clean v0.3
   80/80 replay remains rejected diagnostic provenance under ADR 0010.
2. Complete the LLM rationale review plus both M2 benchmark submissions and adjudication.
3. Complete the 20-case experiment dry-run review, freeze config/data/code digests, and commit only
   the frozen manifest.
4. Run the full five-system offline comparison once under the frozen retry policy.
5. Run scripted adaptive and actual one-factor ablation suites from the same frozen source.
6. Generate tables and figures from immutable raw runs, then replace result placeholders.
7. Run the local identity audit with a private forbidden-term list and complete two independent
   Notion submission reviews.

No automation may fill, approve, or impersonate a human-review artifact.
