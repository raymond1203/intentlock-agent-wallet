# Published benchmark evidence

`m2-execution-diagnostic-20260904.json` is a compact, traceable diagnostic snapshot of the first
complete path execution over the 80 v0.2.0 base scenarios. It retains every listed attempt, selects
the last listed attempt per scenario for its `latest` view, records scenario and raw-file SHA-256
hashes, and omits raw calldata and full receipt logs. Because these attempts came from a dirty
worktree and predate collector digests, the artifact is not an independently reproducible frozen run.

Raw failure messages remain only in ignored local run directories. The published artifact contains
their broad failure class and SHA-256 hash so provider URLs, tokens, headers, or response bodies are
not copied into Git.

This artifact is deliberately marked `purpose: Diagnostic evidence`, `humanReview: PENDING`, and
`m2Complete: false`. Its source runs used a dirty integration worktree, so it is evidence for the
v0.2.0 defect analysis rather than a frozen performance result. See
`docs/experiments/m2-execution-findings-20260904.md` for interpretation and the proposed v0.3.0
correction policy.

The current dataset is v0.3.0. No v0.3.0 execution artifact is published yet, so current-version
validation reports `NOT_COLLECTED` and zero executed bases. A future artifact must be produced from
the exact v0.3.0 scenario hashes; the validator never carries these v0.2.0 counts forward.
For v0.3.0 publishing, attempts remain chronological: the first complete attempt per scenario is
selected and cannot be overwritten by a later failure; if no attempt completes, the latest failure
is selected. Every earlier and later attempt is still retained in the public attempt history.

Unlike the historical v0.2.0 diagnostic, every v0.3.0 attempt must also retain its exact collector
JSON bytes below `benchmark/evidence/raw/v0.3.0/sha256/`. The published attempt records both the
repository-relative content-addressed path and SHA-256. `validate-m2` reads those bytes from Git
`HEAD` (not from an ignored run directory or the mutable worktree), checks the hash and strict raw
schema, and independently recomputes completion plus both post-state oracle views. A summary whose
receipts, observations, effects, provenance, oracle, selection, or aggregates differ from the
tracked raw bundle is rejected.

`fixtureCorrections` and `fixtureCorrected` distinguish diagnostic executions that increased the
isolated account's starting balance from runs that used authored prefix funding unchanged. The
top-level strict counts exclude corrected fixtures rather than silently treating them as normal.
