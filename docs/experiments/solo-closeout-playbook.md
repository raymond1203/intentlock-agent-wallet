# Current M2–M4 execution procedure

The user selected one author with AI-assisted review on 2026-09-05. ADR 0011 supersedes the previous
two-person operational plan for this run. The historical human playbook remains a description of
the legacy procedure, not a claim that its reviews occurred.

## Status meanings

- Machine evidence complete: the named commands and artifacts exist and pass their checks.
- Experiment ready: explicit `SOLO_AI_ASSISTED` checks permit collection of results.
- AI reviewed: the recorded AI inspected the named inputs and retained findings and limitations.
- Author approval pending: the author has not yet attested final verification.
- Submitted: the real submission was delivered and confirmed outside this repository.

Neither experiment readiness nor AI review is human approval. M2's historical `m2Complete` field
must not be used alone to infer author approval or the readiness of the selected review mode.

## Execution order

1. Preserve v0.4's 80 execution records and live 20-case baseline with their original source binding.
2. Validate actual AI benchmark and rationale reviews, disclose uncertainty, and commit the selected
   protocol plus all semantic code/configuration changes as a clean candidate.
3. Run the exact 20-case freeze dry run from that candidate. Inspect its immutable outputs and
   create an AI freeze review, explicitly leaving final author approval pending.
4. Freeze both manifests in the required direct-child commit with the review and its three bound
   dry-run files. No unrelated code or paper edits belong in that commit.
5. Run all 400 cases against five systems. Preserve first-attempt failures and record operational
   retries separately. Commit the complete primary artifacts before downstream runs.
6. Run all preregistered ablation arms and all 40 scripted adaptive episodes, then commit artifacts.
7. Generate tables and figures from the committed results and perform AI recomputation checks.
8. Assemble the Korean manuscript with the actual generated results. Check claim-to-source links,
   the conditional guarantee, evidence limits, word count, identifiers, and image rendering.
9. Give the author the final manuscript and a concrete approval checklist. Actual identity terms,
   the contest wallet address, Notion page, and final submission records stay private.

## Author's final checkpoint

The author checks the manuscript's main claims against the provided tables and sources, confirms
the AI-assisted methodology disclosure, and reviews unresolved findings. The final Notion preview
must also be checked for word count, image visibility, comment permissions and anonymous sharing.
The team-registration facts previously handled outside the repository are not collected again.

No blank review answer is auto-filled as the author's opinion. If an external submission location
or private term list is needed, request only the missing access or local file, never a public
GitHub record of identity values.
