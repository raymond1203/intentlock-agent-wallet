# 0008 — M2 integration, observability and evidence gates

- Status: proposed, independent re-freeze pending
- Date: 2026-09-03
- Dataset candidate: 0.2.0; supersedes the 40-case v0.1.0 candidate in 0007
- Related: #20–#26, #46, Billy's #47/#48 and review comments on #46

Integrate Billy's Guard Mode and blinding work into #46. Retain the original authors' contributions.
Correct remaining class leakage, invalidate v1 LLM output and rerun the unchanged 20-case selection
with v2 identity-redacted prompts. Do not assume the new score must move in a particular direction.

Expand the inventory to 80 bases with Across/CCTP/Aave decoders. Separate intermediate debt limits
from final debt goals. Add an independent integer post-state oracle with explicit insufficient-data
and disagreement states, and keep PRE_SIGN and POST_STATE metrics separate for every baseline.
Add partial completion as the fifteenth mutation operator; the stale-quote and partial-completion
fixtures are POST_STATE-only, leaving thirteen eligible pre-sign mutation representatives.

The published held-out data is not secret. Disclose contamination, exclude held-out cases from
development review, mark the manifest unfrozen and require human approval before experimental
re-freeze. No test result is claimed for an unseen sealed set.

The candidate data remains EXPECTED_FIXTURE until scenario-specific execution is collected.
Representative Ethereum/Base fork successes do not certify all 80 scenarios, synthetic Permit2
signatures, swap quotes, cross-chain relaying, solvency, allowance consumption or health factor.
The main M2 PR must not claim these gates complete just because CI is green.

Generate a 20-of-80 double-review packet and submission template. Preserve both human decisions
and adjudication before closing the corresponding gates. No independent review is fabricated.
Dependency upgrades remain separate from this research integration.
