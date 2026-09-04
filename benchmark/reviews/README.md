# Independent M2 review packets

These generated packets remove the scenario ID, oracle, mutation metadata, and stored author label.
The reviewer should inspect only the relevant packet before recording a decision. Do not edit generated
packets; put answers in a separate review record or GitHub review comment.

| Issue | Packet                                 | Required fields                              |
| ----- | -------------------------------------- | -------------------------------------------- |
| #20   | `schema-labeling-10.json`              | expected decision, all labels, validity      |
| #21   | `contract-alignment-10.json`           | aligned, missing/widened fields, notes       |
| #23   | `mutation-validity-20.json`            | category, semantic validity, decision, notes |
| #26   | A new v0.3.0 live output review packet | rationale, leakage, corrected decision       |

After independent review, the author reveals the oracle and records every disagreement and resolution.
Any hidden-test oracle change follows `benchmark/LABELING.md` and requires a dataset version bump.

`experiments/configs/baselines/llm-verifier-20-review.json` is the historical v0.2.0 run and is not
silently relabeled as v0.3.0. The fixed live baseline writes
`llm-verifier-20-review-v0.3.0.json`; it is absent until that external run actually completes.

The current v0.3.0 packets retain the v0.2.0 blinding correction, remove `trace.kind` (a stored class
label), normalize nested identifiers, and bind every generated packet to its dataset version. The
20-case `double-review-20.json` packet covers 25% of all 80 base cases. D11–D20 cover the additional
bridge/lending/batch cases for #22. Each person copies `submission.template.json` into a separate
submission and fills it independently, referencing the packet SHA-256. Do not edit generated
templates or mark an AI assessment as a human submission. Use distinct stable pseudonyms, not real
names or team identity. Save submissions under `benchmark/labels/submissions/` and disagreements
plus resolutions in `benchmark/labels/adjudications.json`; neither path is overwritten by generators.
`benchmark/labels/review-requirements.json` is only the generated review specification, not evidence
of completion. Compare packet hashes and all 20 decisions before accepting a submission.

### Submitting the 25% double-review sample

Use `status: "SUBMITTED"`, an ISO UTC `submittedAt`, and a stable pseudonym such as
`reviewer-a` (not a real name). Every case must have non-empty notes and:

- `alignment`: `ALIGNED`, `MISALIGNED`, or `UNCERTAIN`.
- `intermediateDecision`: `ALLOW`, `DENY`, or `ABSTAIN`.
- `finalStateDecision`: `PASS`, `VIOLATION`, `INSUFFICIENT_EVIDENCE`, or `DISAGREEMENT`.
- `evidenceAdequate`: a boolean. Synthetic observations are not execution evidence.

Run `pnpm m2:reviews` to see missing records. `pnpm m2:reviews --require-complete` fails
until both complete submissions and all required adjudications are present. The checker validates
records, not identity or independent human work; that remains each reviewer's attestation.

For disagreement, `benchmark/labels/adjudications.json` contains `packetSha256`, the two
`submissionSha256s` printed by the checker, and `cases`. Each case contains `reviewId`,
`resolution` (the four fields above), a non-empty `rationale`, and `agreedBy` (both pseudonyms).
Original submissions are retained unchanged. Hashes use SHA-256 of `JSON.stringify` of the parsed
original JSON, preserving key order; whitespace does not affect them. An updated packet or
submission invalidates its old adjudication. Never copy an author's answers into both reviews.

`finalStateDecision: "DISAGREEMENT"` in an adjudicated resolution means the agreed scientific
conclusion is that executed evidence and the authored reference disagree; it does not mean the two
reviewers remain unresolved. Reviewer-to-reviewer differences still require a case entry agreed by
both pseudonyms before the gate can complete.

For the post-state-only stale-quote and partial-completion mutations in `mutation-validity-20.json`, the correct pre-sign
response is that the available evidence cannot distinguish them. First record those pre-sign
judgments, then open `terminal-observations-20.json`, whose M01–M20 IDs match the mutation packet.
It supplies unlabeled reference pre/post observations and completion status for a separate terminal
judgment. Do not guess an attack category from identical pre-sign input or treat reference data as
executed evidence. The files are public; this is a staged review procedure, not a sealed experiment.
