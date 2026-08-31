# M2 Baseline Protocol

IntentLock is compared with two deliberately narrower baselines over the same benchmark scenario,
Intent Contract, decoded ActionIR effects, and held-out oracle. The oracle is used for scoring only;
the LLM prompt also omits scenario IDs, stored labels, and mutation metadata.

## LLM intent verifier

The verifier prompt and output schema live in `src/baselines/llm-verifier.ts`. The experiment fixes
the model, prompt version, temperature, retry count, timeout, and malformed-output policy in
`experiments/configs/baselines/llm-verifier.json`.

The model is pinned to the `gpt-5.4-mini-2026-03-17` snapshot. The runner uses the Responses API,
`store: false`, and strict `text.format` JSON Schema. See the official
[model card](https://developers.openai.com/api/docs/models/gpt-5.4-mini) and
[Responses API reference](https://developers.openai.com/api/reference/cli/resources/responses/methods/create).

Only a strict JSON object with `decision`, `rationale`, and `violatedFields` is accepted. Markdown
fences, extra keys, invalid decisions, timeouts, and transport failures are retried once and then
become `ABSTAIN`. No failure path can become `ALLOW`.

This is a prompt-only baseline, not a reproduction of DRIFT, AgentSpec, or any other named system.
It has no trusted ledger and no deterministic enforcement authority.

## Per-call policy

The per-call policy checks the chain, target, selector, native-value ceiling, and decoded economic
effects for each top-level call. It intentionally evaluates every call with an empty accepted-effect
history. As a result, it can catch a locally excessive transfer but miss retry, concurrency, and
policy-laundering traces whose individual calls are within bounds while their cumulative total is
not. This weakness is part of the experimental comparison, not an implementation defect.

## Prompt blinding

`createLlmVerifierUserPrompt` redacts every scenario identifier before the prompt is built. The
intent's idempotency key becomes `redacted-intent` and action and effect ids become positional
tokens. Without this, the prompt states the answer: base cases carry ids such as `tr-01-effect-0-0`
while mutated cases carry `tr-01-recipient-substitution-2026-effect-0`, which names the operator the
verifier is supposed to infer.

`test/benchmark/review-packet-blinding.test.ts` fails if an identifier or operator name reappears in
a prompt or in a human review packet. Any prompt change of this kind bumps
`LLM_VERIFIER_PROMPT_VERSION` and voids earlier runs.

## Twenty-output validation gate

`reviewer-20.json` freezes a stratified set of ten base and ten mutated cases. Automated tests use a
fake client to validate the full twenty-output adapter and parser path without network credentials.
Those tests are not reported as real model performance.

Before reporting LLM metrics, run the configured model with a locally supplied credential, save the
raw immutable outputs outside the prompt-building path, and have the other team member fill the
review fields. The issue remains incomplete while the file status is
`PENDING_INDEPENDENT_REVIEW`.

Run `pnpm baseline:llm:run` after putting `OPENAI_API_KEY` in the ignored `.env.local`. The runner
never writes the key or API error bodies to its result artifact.
