# 0007 — M2 benchmark freeze and baseline boundary

- Status: proposed pending independent review
- Date: 2026-08-30
- Dataset version: 0.1.0

## Decision

Freeze forty curated base scenarios as four equal workflow groups and use a grouped-stratified
24/8/8 train/dev/hidden-test split. Keep a base scenario and every mutation in the same split.
Use exact integer effects and expected post-state as the oracle representation; model explanations
are never oracle evidence.

Implement fourteen deterministic mutation operators with seed `2026`. Separate ABI-decodable
semantic violations from intentionally invalid or unknown calldata. Human reviewers receive blind
packets without scenario IDs, stored labels, oracle decisions, or mutation metadata.

Compare IntentLock with two narrower baselines:

1. a top-level per-call policy that deliberately carries no cumulative accepted-effect state; and
2. a prompt-only LLM verifier pinned to `gpt-5.4-mini-2026-03-17`, prompt version
   `intentlock-llm-baseline-v1`, temperature zero, one retry, 30-second timeout, and explicit
   abstention after malformed output.

The oracle is withheld from both baseline inputs and joined only for scoring. The LLM verifier is
not presented as DRIFT, AgentSpec, Progent, or any other system reproduction.

## Consequences

- Hidden-test changes require reviewer approval, a dataset version bump, contamination disclosure,
  and full result regeneration.
- The per-call baseline is expected to miss retry, concurrency, and policy-laundering violations
  that only appear after cumulative aggregation.
- A twenty-case live LLM adapter run is validation evidence, not final benchmark performance.
- Pinned-fork execution and every independent review remain explicit gates; automated schema,
  decoder, monitor, and fake-client tests cannot replace them.
