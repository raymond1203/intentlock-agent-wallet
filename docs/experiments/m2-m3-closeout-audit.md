# M2–M3 closeout acceptance audit

## Assessment: ready for scoped implementation closeout, with caveats

Audit date: 2026-09-05 KST. Inspected repository HEAD:
`8e8d97ec9e7f6ddfab75fbc5e57de75cecffc978` (the history-preserving PR #46 merge).
GitHub issue bodies #20–31 were read while all twelve remained OPEN. This document neither changes
GitHub status nor records author approval. Reviewer: AI, source-visible, non-independent;
`SOLO_AI_ASSISTED`, `independentHumanReviewClaim=false`, `finalAuthorApproval=PENDING`.

The current issue acceptance criteria can be closed as the bounded implementation/experiment tasks
described below. This is **not** a declaration that every natural-language contract is aligned, that
independent human review occurred, or that research submission is complete. The frozen
`experiments/configs/m2-validation.json` deliberately retains `experimentReady=true` and
`m2Complete=false`; the latter final-author gate is not changed by issue closeout.

## Current checks performed

- Re-ran eight focused test files: **126/126 tests passed**, 2026-09-05 09:37 KST. The files were
  `test/benchmark/scenario.test.ts`, `mutations.test.ts`, `ai-assisted-review-gate.test.ts`,
  `test/oracle/post-state-oracle.test.ts`, `test/baselines/guard-mode-emulator.test.ts`,
  `llm-verifier.test.ts`, `per-call-policy.test.ts`, and `test/experiments/protocol.test.ts`.
- Re-ran `node docs/experiments/audits/m3-metrics-recompute.mjs --self-test`; constant/paired
  bootstrap self-tests passed. Separately ran the same checker with `--secondary` at
  `2026-09-05T00:37:45.202Z`: primary tables, the 40-case mixed sample, ablation tables and adaptive
  counts matched. This checker uses Node builtins, not the production aggregator/bootstrap.
- Read the current source-bound M2 validation summary: 80 base cases, 80 strict-authored executions,
  80 final-goal passes, 80 reference checks and zero reference disagreements. Execution evidence is
  bound to historical source `a0cca37764d3267929f7b74404393c4a1115fc78`; it is not relabeled as a
  fresh execution of the patched M3 implementation.
- Rechecked all 40 adaptive public transcripts / 160 entries with the production public-field
  validator and separate credential/identity/address patterns. Details are below.
- No model, RPC, wallet or blockchain call was made during this closeout audit. No source, frozen
  input, original raw result, review answer or GitHub issue was modified by it.

## Per-criterion issue mapping

AC1–AC4 refer, in order, to the four current acceptance checkboxes on each linked issue.
“Met” is limited by the qualification in the same row and the standing caveats below.

| Issue                                                                                             | AC1                                                                                                                                                                                                  | AC2                                                                                                                                                                                          | AC3                                                                                                                                                                                     | AC4                                                                                                                                                                | Closeout interpretation                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#20](https://github.com/raymond1203/intentlock-agent-wallet/issues/20) schema/labels/split       | Met: ten-case `benchmark/scenarios/golden/benchmark.json` validates in `scenario.test.ts`.                                                                                                           | Met: `benchmark/LABELING.md` has positive/negative examples for all 17 vocabulary labels.                                                                                                    | Met: its split section records grouped 48/16/16 assignment, exposed legacy `HIDDEN_TEST`, version/PR/contamination procedure. ADR 0011 supersedes the old reviewer staffing assumption. | Met: `m2-supplemental-ai-audit.md` inspects S01–S10 individually, including invalid S10 and co-occurring labels.                                                   | Schema validity is not execution feasibility. Generated labels encode a primary cause, not exhaustive multilabel ground truth.                                                                              |
| [#21](https://github.com/raymond1203/intentlock-agent-wallet/issues/21) transfer/approval/swap 40 | Met: TR/AP/SS/BS each have ten cases; schema tests and M2 validation report all 40 normal strict-authored executions/reference passes.                                                               | Met within the defined detector: `src/benchmark/dedup.ts` normalizes addresses/numbers and uses same structure plus token Jaccard threshold 0.85; the 40-case no-duplicate assertion passed. | Met: `benchmark/scenarios/base/coverage.json` and per-case `criticalFieldsPresent` record coverage. Coverage is recorded, not uniformly complete.                                       | Met: D01–D10 in `benchmark/reviews/ai-assisted-review-v0.4.0.json` contain ten substantive contract/label assessments; exact selection below.                      | Conditional contract enforcement only; an AI review being complete does not make every contract aligned.                                                                                                    |
| [#22](https://github.com/raymond1203/intentlock-agent-wallet/issues/22) bridge/lending/batch 40   | Met in the documented fixed-fork/authored-fixture harness: BR=15, LE=15, BA=10 and all 40 selected executions/reference checks PASS.                                                                 | Met: D11–D20 have separate `intermediateDecision` and `finalStateDecision`; scenario safety effects and `finalStateGoals` remain separate.                                                   | Met: cross-chain base inputs plus `chain-substitution` and `partial-completion` fixtures explicitly cover the cases; terminal missingness remains INSUFFICIENT_EVIDENCE.                | Met: D11–D20 have ten substantive AI assessments; exact selection below.                                                                                           | Paired-fork destination fixtures do not prove live relayer/attestation delivery or bridge liveness.                                                                                                         |
| [#23](https://github.com/raymond1203/intentlock-agent-wallet/issues/23) mutation operators        | Met for the declared fifteen economic-effect/operator categories: `docs/attack-taxonomy.md`, `benchmark/scenarios/mutations/coverage.json`, `MUTATION_OPERATOR_IDS`.                                 | Met: the same-seed deep-equality test passed for every operator in `mutations.test.ts`.                                                                                                      | Met: 12 semantic candidates, one INVALID_CALLDATA, two POST_STATE_FIXTURE operators are separate; their observation-stage tests passed.                                                 | Met: supplemental audit records M01–M20 pre-sign judgments separately from terminal reference assessments.                                                         | This is not independent coverage of every possible injection surface, malicious proxy/callback, scheduling interleaving or real exploit. M12/M13 share visible input; 18 terminal references are inherited. |
| [#24](https://github.com/raymond1203/intentlock-agent-wallet/issues/24) oracle / 25% review       | Met: `src/oracle/post-state-oracle.ts`, passing oracle/mutation tests and source-bound M2 rows give deterministic contract/reference decisions; M3 uses frozen authored labels with explicit stages. | Met: validation retains disagreements/cross-stage differences separately; zero current reference disagreements is reported without discarding historical rejected evidence.                  | Met: D01–D20 form 20/80=25%; AI record preserves ALIGNED=7, MISALIGNED=2, UNCERTAIN=11 and six inadequate-evidence judgments.                                                           | Met: oracle/domain code uses bigint/integer strings; passing tests cover amount/exposure and state-delta boundaries.                                               | AI judgments are not two-person agreement or a replacement of frozen canonical labels. Historical M2 fork evidence and M3 expected fixtures remain different evidence levels.                               |
| [#25](https://github.com/raymond1203/intentlock-agent-wallet/issues/25) Guard Mode emulator       | Met: `docs/baselines/guard-mode.md` and supplemental audit link official trading-mode/outflow policy pages and distinguish source facts from assumptions.                                            | Met: emulator tests cover Permit2, approval exposure and hidden batch; the focused emulator test file passed now, and integration coverage is separately present.                            | Met: generated results are qualified as public-rule STRICT emulator results; STRICT/LITERAL fallback, valuation and assumed confirmation differ from production.                        | Met: supplemental audit's official-source-to-implementation table provides the AI inspection.                                                                      | Neither public documentation omissions nor emulator ALLOW prove production MetaMask vulnerabilities.                                                                                                        |
| [#26](https://github.com/raymond1203/intentlock-agent-wallet/issues/26) LLM / per-call baselines  | Met: frozen config, exact model `gpt-5.4-mini-2026-03-17`, v2 prompt, temperature 0 and retry/timeout/malformed policy are bound in manifests.                                                       | Met: passing LLM tests exercise timeout/parser failure and explicit ABSTAIN; primary failures remain visible.                                                                                | Met: the case-manifest/hash checks cover every system/case; the model does not receive the oracle, while the same oracle scores all arms.                                               | Met: R01–R20 in `experiments/configs/baselines/llm-verifier-20-ai-review-v0.4.0.json` contain rationale support, corrected decision, leakage assessment and notes. | 17/20 canonical decision agreement is not 17/20 rationale accuracy or final benchmark accuracy. The old human-only validation narrative is superseded below.                                                |
| [#27](https://github.com/raymond1203/intentlock-agent-wallet/issues/27) freeze                    | Met at the recorded freeze checkout: config-driven `scripts/run-evaluation.ts` produced the complete primary run from B. Its exact-commit/clean-tree requirements still apply.                       | Met: ADRs 0010–0012, versioned manifests and hash-bound source A→freeze B preserve changes and reasons.                                                                                      | Met: `experiments/PROTOCOL.md` and frozen metrics explicitly define offline counterfactual unsafe authorization.                                                                        | Met: `experiments/reviews/freeze-review.ai-v0.4.0.json` binds the accepted run02 twenty-case dry run, lists each reproduced result and review notes.               | A is `89c742e…`, B is `58b36e2…`. The earlier unapproved dry run is retained; the acceptance record does not claim a new live LLM call in the deterministic dry run.                                        |
| [#28](https://github.com/raymond1203/intentlock-agent-wallet/issues/28) primary 400×5             | Met: independent checker verifies 400 unique frozen cases per each of five systems and 2,000 first-attempt records.                                                                                  | Met: every raw record's run ID maps to the manifest's source/freeze/config hashes, with case-level provenance checked; hashes are not redundantly embedded in every JSONL row.               | Met: raw retains 2,092 rows including 92 retries; first-attempt 92 LLM failures remain in main denominators, latency and cost.                                                          | Met: `m3-primary-metrics-ai-audit.md` plus the independent checker inspect 40 selected cases × 5 systems=200 first rows (10% of cases and rows).                   | Operational recovery only supplies later outputs. It never changes the first-attempt main table or model-failure history.                                                                                   |
| [#29](https://github.com/raymond1203/intentlock-agent-wallet/issues/29) adaptive subset           | Met: `adaptive-solo-v0.4.0-01/episodes.jsonl` contains 40 unique episodes / 160 plans, five families × eight.                                                                                        | Met: typed outcomes separate ATTACK_SUCCESS, NORMAL_FAILURE, SAFE_BLOCK and INCONCLUSIVE; all forty observed outcomes are SAFE_BLOCK, zero signer calls.                                     | Met for these public transcripts: 40 production validator passes and separate patterns yielded zero credential, identity and EVM-address findings; method below.                        | Met: `m3-secondary-ai-audit.md` records ten preselected full-episode deterministic replays, all exact matches.                                                     | The ten are blocked attacker-attempt reproductions, not ten observed benign-task failures. No adaptive-model, fork-execution or production-signer performance claim.                                        |
| [#30](https://github.com/raymond1203/intentlock-agent-wallet/issues/30) ablations                 | Met: frozen manifest and secondary audit distinguish three one-factor arms from semantic/symbolic/hybrid stage comparisons and confirmation policy.                                                  | Met: independent checks verify all eight arms reuse the same 400-case split and scenario hashes/seed.                                                                                        | Met: ablation result tables report both unsafe counts and benign completion, including always-confirm 0/400 unsafe and 0/160 completion.                                                | Met: secondary audit's configuration table records actual flags and source paths checked against `ablations.ts` / `sequential-symbolic.ts`.                        | Stateless disables both accepted-effect accumulation and duplicate recognition; shallow decoding is fail-closed availability loss, not silent hidden-effect dropping.                                       |
| [#31](https://github.com/raymond1203/intentlock-agent-wallet/issues/31) analysis / figures        | Met for canonical research outputs: `scripts/analyze-results.ts` regenerates nine primary/ablation/adaptive table files, metadata and four root SVGs from one invocation with three run IDs.         | Met: protocol, primary/secondary audit and generated tables state all denominators, missingness and failure retention.                                                                       | Met: 16 primary and 38 secondary CI checks are documented and the independent checker passed again.                                                                                     | Met: separate builtins-only arithmetic reproduces raw aggregates, mixed sample, token cost and cluster-bootstrap intervals without production imports.             | Korean submission conversion/Notion preview is a separate M4 deliverable, not covered by the canonical analysis command. Degenerate corpus CIs do not imply deployment certainty.                           |

## Exact ten-case review mapping for #21 and #22

The mapping is taken from `scripts/validate-m2.ts`'s `first` and `second` arrays, then matched to
the ordered D01–D20 packet and the completed AI record. Each group has ten unique review IDs and
ten unique base IDs; no schema S-case or LLM R-case was incorrectly counted as a contract review.

| Issue | Review IDs | Base cases                                                           |
| ----- | ---------- | -------------------------------------------------------------------- |
| #21   | D01–D10    | TR-01, TR-07, AP-01, AP-03, AP-05, SS-01, SS-07, BS-01, BS-07, BS-08 |
| #22   | D11–D20    | BR-01, BR-02, BR-05, BR-07, LE-01, LE-03, LE-05, LE-08, BA-01, BA-06 |

All D records preserve intermediate/terminal decisions and evidence-adequacy notes. The six false
`evidenceAdequate` values remain false. No human response or final-author acceptance was supplied
or inferred by this check. All twenty authored contract observations being inspected is not a claim
that all twenty natural-language instructions were faithfully encoded.

## Adaptive transcript privacy check and replay evidence

Input: `experiments/results/adaptive-solo-v0.4.0-01/episodes.jsonl`, SHA-256
`b0c1b4c1701df35f201d8cb1a2a2f15d5ec944975712541dc091bfcace7ee86b`.

The check parsed all forty JSONL objects and inspected the `transcript` arrays only (160 entries),
not arbitrary local environment files. `assertAdaptiveTranscriptSafe` rejects forbidden private
state/oracle/credential keys and sensitive text. A separate scan of serialized public transcripts
checked API-key patterns, email addresses, credential-bearing URLs, Windows absolute paths,
known repository/team identifier strings and exact forty-hex EVM addresses (excluding longer
hashes): **zero matches for every category**. Public transcripts contain action fingerprints, not
raw personal wallet addresses. This is evidence about the actual fixed transcripts, not a proof
that regexes can identify every kind of PII in arbitrary future inputs. No secret value was read
or printed.

The previously completed ten-replay record in `m3-secondary-ai-audit.md` checks TR-01, AP-01,
SS-01, BS-01, BR-01, BR-05, LE-01, LE-08, BA-01 and BA-07. It records full JSON equality,
including public decisions, reason order, hashes, seeds, signer count and outcome, with network
fetch forbidden. The original `human-review-10.packet.json` remains pending with zero completed
human reviews; the AI replay document is separate. This closeout does not relabel that packet.

## Explicit supersession of frozen historical prose

Some frozen artifacts still describe the original two-person review workflow. Preserve their bytes:

- `benchmark/LABELING.md`: old independent-adjudication staffing and the sentence “freeze remains
  blocked” do not describe the authorized solo-AI freeze. Its primary-source/multilabel wording
  must be read with ADRs 0010–0012 and the supplemental audit's stage/evidence caveats.
- `benchmark/reviews/README.md` and original generated review packets: human-only submission
  instructions remain the **unperformed alternative**, not the current AI completion status.
- `experiments/configs/baselines/VALIDATION.md`: pending independent-human rationale language and
  the older test count are historical. The completed separate AI record is the current #26
  acceptance evidence; human rationale approval has not occurred.

For this study the authoritative staffing decision is
`docs/decisions/0011-solo-ai-assisted-research-review.md`, the recorded AI assessments, frozen
review protocol and exact run manifests. An issue-close comment should link this supersession and
the appropriate actual artifact, not merely check every historical human box. No label, original
packet, runtime or frozen file is rewritten to manufacture agreement.

## Items that are not satisfied and must remain unclaimed

1. Final author approval, independent human review and actual anonymous submission are not
   complete in these records. They are not implicit consequences of closing #20–31.
2. Full natural-language/contract semantic alignment, unseen holdout performance, live bridge
   settlement, arbitrary attack-surface coverage and production MetaMask equivalence are not
   established. They are stated scope limits, not silently repaired by automated checks.
3. M3 main LLM results still include the 92 first-attempt failures. Later recovery obtained outputs
   for all 400 cases but must remain a post-hoc operational appendix; no replacement main metric.
4. The recorded twenty/ten AI reviews are source-visible and non-independent. Their notes include
   negative findings. “Reviewed” must not be replaced with “all labels passed” or “human consensus.”

No missing implementation acceptance item was found within these disclosed bounds. Closing the
twelve scoped tasks is compatible with keeping the final-author/submission gate open.
