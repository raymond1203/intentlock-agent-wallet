# Reboot checkpoint — 2026-09-05

This is a historical pause record, not the current work status. The subsequent completed M2/M3
run and merge are described in [research-closeout.md](research-closeout.md). Do not repeat this
checkpoint's resume instructions or infer that its old blockers are still present.

The author requested a safe pause before rebooting the laptop. No experiment or API request is
running. The build was interrupted intentionally; rebuild before using `dist/`.

## Saved state

- Branch: `codex/m2-raymond-work`; existing PR: #46.
- Implementation commit: `2caf9c7f27a28c0335c1503c5b5625b243150532` (local, not pushed yet).
- Selected review model: one human author plus disclosed AI-assisted review (ADR 0011).
- `pnpm check` passed: 51 test files passed, 2 skipped; 593 tests passed, 12 skipped.
- Existing 80-case M2 fork evidence and canonical 20-case live LLM result were preserved.
- Actual AI D01–D20 and R01–R20 reviews were committed. They include negative and uncertain
  findings; they are not independent human approval.
- Generated M2 validation has not yet been refreshed after this implementation commit.
- No freeze dry run, frozen manifest, primary M3 run, ablation run, or adaptive run was started.
- `paper/final-source.md` exists with nine result assembly slots. It is not the finished paper.
- Final author approval and actual Notion submission remain pending.

## Resume order

1. Inspect this branch and working tree, then run `pnpm build` (the prior build was interrupted).
2. Before selecting candidate A, complete the remaining source/documentation review:
   - `docs/experiments/m2-supplemental-ai-audit.md` has not yet been created. Inspect all S01–S10
     label/taxonomy/validity fields and M01–M20 mutation pre-sign/terminal outcomes. The prior
     reviewer inspected S01–S10 and M01, but not M02–M20. Preserve S10 invalid/UNKNOWN caveats.
   - Compare Guard Mode public documentation against the emulator and record assumptions for
     #25. Prior read-only review noticed broad source comments about ERC20 approval exclusions
     and unknown-rule fallback, while explanatory docs correctly label assumptions.
   - Check the stale-quote taxonomy row against the current POST_STATE_FIXTURE labeling policy.
   - `docs/experiments/m4-method-and-novelty-ai-audit.md` has not yet been created. Complete the
     skeptical novelty, conditional-guarantee, and architecture-to-code audit for #32/#33.
   - Correct architecture figure wording in `src/experiments/figures.ts` before candidate A:
     “taint-aware extraction”, “Atomic ledger”, and “mismatch freezes follow-up signing” may
     overclaim the implementation compared with the current manuscript. No correction made yet.
3. Test any changes, commit them, regenerate M2 validation from tracked AI review inputs, and
   verify `experimentReady: true` without converting `m2Complete: false` into human approval.
4. Follow `solo-closeout-playbook.md`: clean candidate A, exact 20-case deterministic dry run,
   actual AI freeze review, exact six-file direct-child freeze B, then primary 400 × 5 runs.
5. Preserve first attempts and append operational retries separately; run 8 × 400 ablations and
   40 scripted adaptive episodes, commit results, generate analysis and figures, audit, assemble.

## Review and integration cautions

- Recompute the real aggregates without importing the production aggregation implementation.
- A sample of case-manifest indices 0,10,...390 is benign-only. Use an explicitly mixed sample
  such as `10*k + (k%5)`, k=0..39 (8 per variant), for the 40-case AI spot review.
- Update #20–#35 with issue-specific evidence and the authorized solo review criteria. Keep #35
  open until real author approval and private Notion submission checks have occurred.
- Do not use CodeRabbit or add AI co-author trailers.
- Do not casually squash PR #46: main would lose the required evidence source ancestry and
  freeze lineage. The existing history also contains two historical Claude trailers, so ordinary
  history-preserving integration would retain them. Resolve this explicitly before merging.
- Reuse the existing locally configured, already-authorized API key without printing its value.
- Do not collect previously completed team-registration identity details into GitHub.
