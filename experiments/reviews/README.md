# Evaluation freeze review records

Review schema `0.2` makes the dry-run evidence binding mandatory; schema `0.1` approval records are
not accepted.

`freeze-review.template.json` is a template, not approval evidence. A human reviewer copies it to
this directory only after reviewing a clean committed candidate and running the exact 20 dry-run
cases. The record must use a stable pseudonym, set `reviewedCommit` to the candidate HEAD, preserve
the human independence attestation, and mark every check truthfully.

The template fixes the exact 20 dry-run case IDs before review: four from each evaluation variant,
covering all seven workflows with two or three cases each. The reviewer records a per-case
reproduction result and note.
Approval requires 20 unique manifest-backed IDs and 20 `MATCHED_EXPECTATION` reproductions; the
aggregate `dryRunCases` number alone is not approval evidence.

From the clean candidate, run the secret-free machine harness before copying the template:

```powershell
pnpm evaluation:freeze:dry-run --run-id=freeze-a-reviewer-b-01 --out=experiments/results/freeze-dry-runs/freeze-a-reviewer-b-01
```

The append-only output contains candidate/config/template/case-manifest provenance and the exact 20
deterministic replays. Its machine `MATCH` field compares the IntentLock result with the authored
oracle. It deliberately says `humanReviewStatus: NOT_PERFORMED`, never writes this review directory,
and never fills `reproduced`, notes, checks, attestation, or approval. The human reviewer inspects
that evidence and the candidate inputs, then separately copies and completes the template. The
reviewer copies the command's `reviewBindingToCopyWithoutChangingHumanFields` object into
`dryRunEvidence`; this binds the review to the direct-child output path, run ID, candidate commit and
tree, and the exact bytes of `manifest.json`, `cases.jsonl`, and `summary.json`. The output directory
name must equal `--run-id`; those three files must remain unchanged through freeze and be committed
in freeze commit B. A fully matching machine summary is necessary diagnostic evidence, not human
approval.

The command exits nonzero after preserving its output when any machine mismatch or evaluation
failure exists. Do not edit that output, approve the template, or freeze that candidate. Diagnose
the case, commit the justified implementation/data correction as a new candidate A, and run a new
append-only output ID. In particular, the deterministic evaluator treats a second identical signer
sequence under one intent idempotency key as a blocked replay even when the state update itself is
idempotent, such as `approve(0)` or an identical Permit2 allowance.

The completed JSON and its three bound dry-run artifacts are the only untracked files the freeze
command permits. The command validates the record against the current HEAD/tree, rehashes and
strictly parses all three named machine artifacts, regenerates the candidate-A case matrix, checks
their source hashes and exact 20 rows, rejects every mismatch/failure, and compares those rows
one-for-one with the human reproductions. It then hashes the review's exact bytes and writes its
repository-relative path and digest to the frozen manifest. It jointly freezes the evaluation and
ablation manifests. Commit the review record, three dry-run artifacts, and both manifests together
as the reviewed candidate's direct child. Runners re-read the tracked artifact bytes and accept that
transition only when those are the commit's exact six changed paths and every semantic digest still
matches. Never turn the template or an AI-generated assessment into `APPROVED` evidence, and never
claim that these Git/content hashes are an external signature.
