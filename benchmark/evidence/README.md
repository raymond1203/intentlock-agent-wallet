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

`fixtureCorrections` and `fixtureCorrected` distinguish diagnostic executions that increased the
isolated account's starting balance from runs that used authored prefix funding unchanged. The
top-level strict counts exclude corrected fixtures rather than silently treating them as normal.
