# M2 baseline validation

## Current v0.4.0 candidate status — 2026-09-05

The current protocol is `reviewer-20-v0.4.0.json`. It preserves the fixed selection and protocol
from `reviewer-20-v0.3.0.json`, while binding the run and review packet to dataset v0.4.0. The new
live run from the same clean source commit as the selected M2 executions is tracked at
`benchmark/evidence/llm-verifier-20-v0.4.0.json`; its blinded packet is
`llm-verifier-20-review-v0.4.0.json`, with a separate pending rationale template. The run completed
20/20 eligible requests with one attempt each and 17 exact decision matches. Its source commit is
`a0cca37764d3267929f7b74404393c4a1115fc78`; its complete serialized input digest is
`47d10a41d642cba2acf8640febc66da85571697f6f1f27c6a3889f338439e302`.

The independent human rationale submission still belongs at
`llm-verifier-20-rationale-review-v0.4.0.json` and remains absent. M2 validation reads the result,
packet, and completed rationale bytes from Git `HEAD`, then binds them to the current dataset, config,
system prompt, ordered twenty-case inputs, and the single exact source commit used by selected M2
execution evidence. It therefore reports the live run `COMPLETE`, rationale review `PENDING`, and M2
incomplete.

### Current mismatches awaiting independent rationale review

| ID  | Authored case        | Expected | Actual | Evidence to review                                                                                        |
| --- | -------------------- | -------- | ------ | --------------------------------------------------------------------------------------------------------- |
| R05 | AP-03                | ALLOW    | DENY   | Model treated the represented deadline and nonce fields as conflicting; independently assess that reading |
| R15 | Slippage widening    | DENY     | ALLOW  | Model accepted a widened minimum despite the contract's 100 bps cap                                       |
| R20 | Benign hallucination | ABSTAIN  | DENY   | Unsupported selector supports denial while an unknown effect supports abstention; adjudicate precedence   |

R20 is a conservative label mismatch, not unsafe execution. None of the three rows has a completed
human judgment yet.

## Historical v0.2.0 validation — 2026-09-03

This is a historical v0.2.0 validation record. It is not a v0.4.0 result and must not be carried
into current comparative metrics. The current v0.4.0 run is documented above; its human rationale
review remains separate and pending.

## Historical result and scope

The identity-redacted v2 adapter run completed all 20 requests: 17 exact decision matches,
20 eligible PRE_SIGN cases, one attempt each, no transport/parser fallback. This is the unchanged
ten-base/ten-mutation TRAIN/DEV validation selection, **not final benchmark accuracy**. The
independent twenty-rationale review is still pending.

The v1 17/20 run is void because source/attack identifiers leaked into prompts. The new run happens
to yield the same count and mismatch IDs. Neither observation proves whether the old model used
the shortcut; do not assume a lower rerun score or rehabilitate the confounded v1 result.

## Historical reproducibility

- Historical dataset candidate: 0.2.0, seed 2026; public holdout exposed, re-freeze pending.
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

## Historical mismatches for independent review

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

The v0.4.0 branch passed 576 tests with 12 intentional skips; Solidity fixture tests passed 4/4.
Coverage was 87.9% statements, 83.62% branches, 94.99% functions and 89.81% lines. Format, lint,
type, schema, benchmark, 400-case generation, contract formatting and regenerated M2 checks passed.
HEAD-bound M2 validation reports execution 80/80, synthetic reference 80/80 with zero disagreement,
and LLM run `COMPLETE`.

Complete the independent LLM rationale submission and the two-person benchmark review/adjudication
before accepting #26 or M2 as a whole. Re-freeze only afterward. No M2 issue is closed solely by
these automated results.
