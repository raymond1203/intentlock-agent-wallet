# 0011 — Single-author execution with disclosed AI-assisted review

- Status: selected by the user on 2026-09-05, implementation in progress
- Supersedes: the mandatory two-person workflow in ADR 0008/0010 for current work only
- Dataset: v0.4.0; no scenario, oracle, seed, model, split or quote change

## Context

The user will perform the remaining work alone and explicitly selected one person plus AI-assisted
review. The earlier project plan required two independent human submissions at several milestones.
That internal procedure does not describe the available reviewers and must not be reported as
completed. Existing machine evidence remains valid for its stated scope.

## Decision

The current workflow explicitly selects `SOLO_AI_ASSISTED`. Legacy human-review records and the
two-human validation path remain available and must retain their original checks. An AI record
uses reviewer type `AI`, makes no independent-human or blinded-review claim, records actual
case-specific observations, and binds its inputs to hashes. It is never written as a human
submission or retroactively attributed to the author.

Experiment readiness and final human approval are separate states. In the selected mode, completed
machine evidence and documented AI checks can make experiments ready while author approval remains
`PENDING`. Starting experiments is not an attestation that the author has inspected the outputs.
The author must review the final evidence and manuscript before submission.

The machine gates remain: all 80 strict-authored base executions, zero synthetic-reference
disagreements, the bound 20-case LLM run, matching dataset/configuration/input hashes, clean source
commits, and a reviewed 20-case dry run. Frozen primary, ablation and adaptive runs retain the
preregistered samples, retry policy, first-attempt denominators and append-only artifacts.

The final manuscript states that development and evaluation are author-led and AI-assisted. It
does not claim two independent human annotations, a blind human evaluation, external replication,
or production MetaMask validation. Final private identity checks and submission remain the author's
responsibility; no team identifiers or personal checklist answers are required in GitHub.

## Scope of the evidence

The 80 base executions establish reproducible normal paths under the authored contracts. The
400-case comparison evaluates contract-conditioned offline counterfactual decisions. It does not
measure natural-language compiler fidelity, collection of actual user consent, or production
transaction loss. Scripted adaptive episodes test the local signer boundary with a fake executor.

AI review records must retain adverse findings. In particular, broad contract allowlists,
confirmation-dependent requests with pre-authored contracts, and idempotent revocation from zero
must not be generalized into stronger natural-language authorization or nonzero cleanup claims.
An LLM decision matching the oracle does not by itself establish a correct rationale.

## Consequences

- M2 machine readiness can unblock M3 without inventing another reviewer.
- AI freeze records have their own identity and provenance fields; human approval stays pending.
- Issue acceptance criteria and manuscript wording must reflect the selected protocol.
- Automated completion, author review, and external submission are reported separately.
- No dataset or outcome is changed to improve an observed score.
- Historical records retain the procedure under which they were generated.

## Evidence

The user explicitly answered “본인 1명 + AI 보조 검토” when asked whether a second independent
human would participate in final research review. This is a workflow choice, not a completed
review or a change to the contest's team-registration requirements.
