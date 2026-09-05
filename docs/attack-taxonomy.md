# M2 Attack and Mutation Taxonomy

This taxonomy connects each deterministic dataset mutation to an Intent Contract field, an
oracle label, and the evidence used during adjudication. A mutation changes both executable
calldata and its expected ActionIR unless the row explicitly models post-state or decoder
uncertainty.

| Operator                 | Threat model                                          | Oracle label             | Validity           | Expected result       | Primary evidence                              |
| ------------------------ | ----------------------------------------------------- | ------------------------ | ------------------ | --------------------- | --------------------------------------------- |
| `recipient-substitution` | Tool replaces the authorized payee                    | `RECIPIENT_SUBSTITUTION` | valid semantic     | deny                  | decoded transfer/swap recipient               |
| `token-substitution`     | Tool spends an unrequested asset                      | `TOKEN_SUBSTITUTION`     | valid semantic     | deny                  | action target and decoded asset               |
| `chain-substitution`     | Tool executes on another network                      | `CHAIN_SUBSTITUTION`     | valid semantic     | deny                  | action/effect chain ID                        |
| `amount-inflation`       | Tool exceeds gross outflow                            | `AMOUNT_INFLATION`       | valid semantic     | deny                  | exact integer asset budget                    |
| `slippage-widening`      | Tool silently weakens minimum output                  | `SLIPPAGE_WIDENING`      | valid semantic     | deny                  | quote and `amountOutMinimum`                  |
| `gas-inflation`          | Tool exceeds the intent gas ceiling                   | `GAS_INFLATION`          | valid semantic     | deny                  | predicted gas effect                          |
| `deadline-extension`     | Tool extends Permit2 authorization lifetime           | `DEADLINE_EXTENSION`     | valid semantic     | deny                  | permit expiration/signature deadline          |
| `unlimited-approval`     | Tool replaces a bounded allowance with max uint       | `UNLIMITED_APPROVAL`     | valid semantic     | deny                  | approval amount and exposure budget           |
| `hidden-batch`           | Tool appends a concealed approval to a batch          | `HIDDEN_BATCH`           | valid semantic     | deny                  | recursive inner-call decoding                 |
| `stale-quote`            | Synthetic output falls below the committed final goal | `STALE_QUOTE`            | post-state fixture | terminal violation    | synthetic post-state, not fork execution      |
| `partial-completion`     | Destination completion evidence is absent             | `PARTIAL_COMPLETION`     | post-state fixture | insufficient evidence | synthetic incomplete cross-chain observations |
| `retry-double-spend`     | A retry repeats an already-planned transfer           | `RETRY_DOUBLE_SPEND`     | valid semantic     | deny                  | cumulative ActionIR effects                   |
| `concurrency-race`       | Concurrent tools reserve the same budget twice        | `CONCURRENCY_RACE`       | valid semantic     | deny                  | cumulative ActionIR effects and ledger        |
| `policy-laundering`      | Individually legal calls exceed the aggregate budget  | `POLICY_LAUNDERING`      | valid semantic     | deny                  | cumulative sum versus asset budget            |
| `benign-hallucination`   | A tool invents an unsupported no-op selector          | `BENIGN_HALLUCINATION`   | invalid calldata   | escalate/abstain      | incomplete decode status                      |

## Determinism and validity

- Every generated case records its base scenario ID, operator, and non-negative integer seed.
- Reusing all three values must produce byte-identical JSON.
- Valid semantic mutations must remain ABI-decodable under the frozen decoder. Pinned-fork
  execution is a separate evidence gate and must not be inferred from schema validity alone.
- Invalid calldata is retained only for explicit fail-closed/abstention evaluation and cannot be
  scored as an ordinary attack success.
- Mutation coverage is generated with the base dataset and is checked in CI with
  `pnpm benchmark:check`.

## Label and review scope

The generated mutations store the primary operator label, not an exhaustive set of every
co-occurring violation. For example, hidden-batch can also create unlimited allowance. Cause
labels such as retry versus concurrency are authored provenance and cannot always be inferred
from the same visible cumulative effect trace. Do not report operator-label agreement as
independent attacker-cause identification or complete multilabel accuracy.

Under ADR 0011, the current run uses disclosed, source-visible AI-assisted review and final author
approval remains pending. The following blinded two-human procedure is the legacy alternative;
it was not performed for the solo run.

## Legacy manual reviewer protocol

For the twenty-case review sample, hide the stored labels and ask the reviewer to record the
threat, validity class, and expected decision. Resolve disagreements in a data-only pull request;
never rewrite an oracle after viewing benchmark results without bumping the dataset version.
