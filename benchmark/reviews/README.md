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
