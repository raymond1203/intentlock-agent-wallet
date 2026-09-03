# Independent M2 review packets

These generated packets remove the scenario ID, oracle, mutation metadata, and stored author label.
The reviewer should inspect only the relevant packet before recording a decision. Do not edit generated
packets; put answers in a separate review record or GitHub review comment.

| Issue | Packet                                                      | Required fields                              |
| ----- | ----------------------------------------------------------- | -------------------------------------------- |
| #20   | `schema-labeling-10.json`                                   | expected decision, all labels, validity      |
| #21   | `contract-alignment-10.json`                                | aligned, missing/widened fields, notes       |
| #23   | `mutation-validity-20.json`                                 | category, semantic validity, decision, notes |
| #26   | `experiments/configs/baselines/llm-verifier-20-review.json` | rationale, leakage, corrected decision       |

After independent review, the author reveals the oracle and records every disagreement and resolution.
Any hidden-test oracle change follows `benchmark/LABELING.md` and requires a dataset version bump.

v0.2.0 also removes `trace.kind` (a stored class label) and normalizes nested identifiers. The
20-case `double-review-20.json` packet covers 25% of all 80 base cases. D11–D20 cover the additional
bridge/lending/batch cases for #22. Each person copies `submission.template.json` into a separate
submission and fills it independently, referencing the packet SHA-256. Do not edit generated
templates or mark an AI assessment as a human submission. Use distinct stable pseudonyms, not real
names or team identity. Save submissions under `benchmark/labels/submissions/` and disagreements
plus resolutions in `benchmark/labels/adjudications.json`; neither path is overwritten by generators.
`benchmark/labels/review-requirements.json` is only the generated review specification, not evidence
of completion. Compare packet hashes and all 20 decisions before accepting a submission.

For the post-state-only stale-quote and partial-completion mutations in `mutation-validity-20.json`, the correct pre-sign
response is that the available evidence cannot distinguish it. Its stored post-state fault is
scored separately; the reviewer must not guess a pre-sign attack category from an identical input.
