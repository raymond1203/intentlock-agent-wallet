# M2 Baseline Validation Report

## Fixed configuration

- Dataset: `0.1.0`, seed `2026`
- Model: `gpt-5.4-mini-2026-03-17`
- Prompt: `intentlock-llm-baseline-v1`
- Temperature: `0`
- Retry: one retry after malformed output, timeout, or transport failure
- Timeout: 30 seconds per attempt
- Malformed policy: explicit `ABSTAIN`
- API: Responses API strict JSON Schema, `store: false`

## Live twenty-case adapter validation

The configured model was run on 2026-08-30 over the frozen ten-base/ten-mutation review sample.
The prompt withheld the oracle. Seventeen of twenty decisions exactly matched the held-out expected
decision. This stratified adapter sample is not reported as final benchmark accuracy.

| Review ID | Case                        | Expected | Actual | Observation                                                      |
| --------- | --------------------------- | -------- | ------ | ---------------------------------------------------------------- |
| R15       | slippage widening           | DENY     | ALLOW  | Model miscomputed a 5% quote/min-out gap as 50 bps               |
| R16       | Permit2 deadline extension  | DENY     | ALLOW  | Model failed to compare epoch deadlines correctly                |
| R20       | benign unsupported selector | ABSTAIN  | DENY   | Conservative denial differed from the explicit abstention oracle |

The ignored local raw artifact is `experiments/results/baselines/llm-verifier-20.json`; its SHA-256
for this run is `50434277E9F65E2FB407E32658D61BFB2307F75136E874E3CFAA516D93832BEC`.
It contains model output and benchmark records but no API key or upstream error body.

## Fail-closed and per-call checks

- Strict structured output, extra-key rejection, timeout abort, retry count, and `ABSTAIN`/`DENY`
  fallback are covered by automated tests.
- The per-call baseline allows compliant base traces and denies locally visible recipient, amount,
  chain, target, selector, and value violations.
- As designed, it allows the retry, concurrency, and policy-laundering examples where each isolated
  call is legal but the cumulative total exceeds the contract.

## Human gate

The other team member must review the twenty raw outputs using `reviewer-20.json`. Until that review
is recorded, the baseline implementation is runnable and validated but #26's final reviewer
acceptance item remains pending.
