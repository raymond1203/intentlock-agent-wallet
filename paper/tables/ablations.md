# Ablation and stage-comparison results

All rows are offline counterfactual replay. Only the three rows under “one-factor causal ablations” receive paired causal-ablation estimates against `INTENTLOCK_FULL`.

## One-factor causal ablations

| Arm | Changed factor | Unsafe authorization | Paired difference vs full (95% CI) | Benign completion | Paired difference vs full (95% CI) |
| --- | --- | ---: | ---: | ---: | ---: |
| STATELESS_LEDGER | acceptedEffectHistory | 16.50% | +14.00 pp (+13.25 pp–+14.75 pp) | 50.00% | +0.00 pp (+0.00 pp–+0.00 pp) |
| SHALLOW_DECODER | recursiveDecoder | 2.50% | +0.00 pp (+0.00 pp–+0.00 pp) | 37.50% | -12.50 pp (-15.63 pp–-10.00 pp) |
| NO_POST_STATE_VERIFIER | postStateReconciliation | 2.50% | +0.00 pp (+0.00 pp–+0.00 pp) | 50.00% | +0.00 pp (+0.00 pp–+0.00 pp) |

## Non-causal stage comparisons

| Arm | Unsafe authorization | Benign completion | Interpretation |
| --- | ---: | ---: | --- |
| SEMANTIC_ONLY | 13.50% | 33.13% | This row references the frozen primary LLM result and changes multiple stages; it is not a causal component ablation. |
| SYMBOLIC_ONLY | 2.50% | 50.00% | The corpus already starts from a confirmed contract, so this is a stage score rather than a semantic-stage ablation. |
| HYBRID_CONJUNCTION | 2.25% | 33.13% | The hybrid combines a fresh symbolic replay with a frozen primary LLM result and is reported only as a non-causal stage comparison. |

## Reference and non-causal policy variant

| Arm | Class | Unsafe authorization | Benign completion |
| --- | --- | ---: | ---: |
| INTENTLOCK_FULL | REFERENCE | 2.50% | 50.00% |
| CONFIRMATION_ALWAYS | NON_CAUSAL_POLICY_VARIANT | 0.00% | 0.00% |

Run: `primary-solo-v0.4.0-01-ablations`; records: 3,200; primary reference parity: verified case by case.
