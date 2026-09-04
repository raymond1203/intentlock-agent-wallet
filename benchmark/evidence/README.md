# Published benchmark evidence

## Current v0.4.0 status

The current dataset candidate is v0.4.0. The tracked artifact
`m2-execution-v0.4.0.json` and its content-addressed raw bundle were collected from clean source
commit `a0cca37764d3267929f7b74404393c4a1115fc78` and published in commit
`76c28b4419d6fc92f01c262e0c9e5574f1407451`. Independent validation reports 80 complete
strict-authored executions, 80 final-goal passes, 80 synthetic references checked, zero synthetic
reference disagreements, and no missing scenario. Human review has not been completed, so
`humanReview: PENDING` and `m2Complete: false` remain mandatory.

ADR 0010 corrected the generated terminal ERC-20 allowance for seven `SWAP_BATCH` cases. The
approval is consumed by a later matching `transferFrom`, so the terminal residual is zero rather
than the original approved amount. The current completion and freeze gate requires all 80 clean
authored-fixture executions **and zero synthetic reference disagreements**. Normal execution PASS
alone is insufficient.

For v0.4.0 publishing, attempts remain chronological: the first complete attempt per scenario is
selected and cannot be overwritten by a later failure; if no attempt completes, the latest failure
is selected. Every earlier and later attempt is retained in the public attempt history. Each exact
collector JSON is copied below `benchmark/evidence/raw/v0.4.0/sha256/`; the compact artifact should
be written to `benchmark/evidence/m2-execution-v0.4.0.json`.

The published attempt records both the repository-relative content-addressed path and SHA-256.
`validate-m2` reads those bytes from Git `HEAD` (not from an ignored run directory or the mutable
worktree), checks the hash and strict raw schema, and independently recomputes completion plus both
post-state oracle views. A summary whose receipts, observations, effects, provenance, oracle,
selection, aggregates, or synthetic-reference disagreement count differs from the tracked raw
bundle is rejected.

`fixtureCorrections` and `fixtureCorrected` distinguish diagnostic executions that increased the
isolated account's starting balance from runs that used authored prefix funding unchanged. The
top-level strict counts exclude corrected fixtures rather than silently treating them as normal.

## Historical diagnostics

`m2-execution-diagnostic-20260904.json` is a compact, traceable diagnostic snapshot of the first
complete path execution over the 80 v0.2.0 base scenarios. It retains every listed attempt, selects
the last listed attempt per scenario for its `latest` view, records scenario and raw-file SHA-256
hashes, and omits raw calldata and full receipt logs. Because these attempts came from a dirty
worktree and predate collector digests, the artifact is not an independently reproducible frozen run.

Raw failure messages remain only in ignored local run directories. The published artifact contains
their broad failure class and SHA-256 hash so provider URLs, tokens, headers, or response bodies are
not copied into Git. It is deliberately marked `purpose: Diagnostic evidence`,
`humanReview: PENDING`, and `m2Complete: false`. See
`docs/experiments/m2-execution-findings-20260904.md` for the v0.2.0 defect analysis and v0.3.0
correction history.

A later clean v0.3.0 replay completed 80/80 normal executions, but independent reconciliation found
seven synthetic terminal-allowance disagreements. ADR 0010 therefore rejects that run and every
derived v0.3.0 baseline or freeze candidate for M2 completion. The intentionally uncommitted local
artifact remains diagnostic provenance only; none of its rows, counts, reviews, or hashes may be
carried forward into v0.4.0 evidence.
