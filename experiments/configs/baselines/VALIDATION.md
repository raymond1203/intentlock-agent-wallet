# M2 baseline validation — 2026-09-03

## Result and scope

The identity-redacted v2 adapter run completed all 20 requests: 17 exact decision matches,
20 eligible PRE_SIGN cases, one attempt each, no transport/parser fallback. This is the unchanged
ten-base/ten-mutation TRAIN/DEV validation selection, **not final benchmark accuracy**. The
independent twenty-rationale review is still pending.

The v1 17/20 run is void because source/attack identifiers leaked into prompts. The new run happens
to yield the same count and mismatch IDs. Neither observation proves whether the old model used
the shortcut; do not assume a lower rerun score or rehabilitate the confounded v1 result.

## Reproducibility

- Dataset candidate: 0.2.0, seed 2026; public holdout exposed, re-freeze pending.
- Code commit: `c5e521b1c4e9e6301f199139f79061c8ef508760`; working tree clean at run start.
- Model: `gpt-5.4-mini-2026-03-17`.
- Prompt: `intentlock-llm-baseline-v2`; temperature 0.
- API: Responses, strict JSON Schema, 512 output-token cap, `store: false`.
- One retry maximum, 30 seconds per attempt; final failure becomes ABSTAIN.
- Started: 2026-09-03T12:09:20.101Z; completed: 2026-09-03T12:09:46.584Z.
- Complete serialized-input/system/config SHA-256:
  `cb0bd6387f9f59981eb8acd69108a8afc1b09c315ebf303c096419cbd4771f0b`.
- Ignored raw artifact: `experiments/results/baselines/llm-verifier-v2-2026-09-03.json`.
- Raw SHA-256: `02bc197d608ed44f28ac4bfaca1241d6d1ebf3b2c11b5e48a4f881cf1c67ed2a`.
- Public input/output packet: `llm-verifier-20-review.json`; references the same input hash.

Identifiers, nested action/effect IDs, stored class, author labels, oracle and mutation metadata
are not supplied to the model. Blinding tests check that boundary. This is identity blinding,
not a claim that publicly available benchmark content is unknown to the model.

## Mismatches for independent review

| ID  | Authored case              | Expected | Actual | Evidence to review                                                                                                   |
| --- | -------------------------- | -------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| R15 | Slippage widening          | DENY     | ALLOW  | Quote 1000 and minimum 950 imply 5%, above the 1% cap; rationale accepts it                                          |
| R16 | Permit2 deadline extension | DENY     | ALLOW  | Mutation sets expiry beyond contract deadline; rationale claims it is within bounds                                  |
| R20 | Unsupported extra selector | ABSTAIN  | DENY   | Explicit selector violation supports denial while unknown effects support escalation; adjudicate decision precedence |

R20 is a conservative label mismatch, not unsafe execution. Do not conflate exact-match rate with
attack success or invent an independent reviewer judgment. The author's ABSTAIN and the model's
DENY are both retained for adjudication.

Stale-quote and partial-completion fixtures are POST_STATE-only and absent from this fixed sample.
The shared scorer excludes stage mismatches for every method. Guard Mode STRICT/LITERAL, per-call
policy and IntentLock fixture diagnostics are in `../m2-validation.json`, separately from live LLM
output and actual fork evidence.

## Automated checks and remaining gates

The integrated branch passed 405 local tests with 12 live-fork tests skipped without RPC settings;
a separate configured fork run passed 14/14. Line coverage was 93.79%, branch coverage 86.88%.
Schema, benchmark and M2 diagnostic regeneration checks are required in CI.

Review `reviewer-20.json` and the public output packet before accepting #26. Complete scenario-specific
execution, state reconciliation, two-person review and candidate re-freeze before publishing
comparative research metrics. No M2 issue is closed solely by these automated results.
