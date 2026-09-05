| System | Offline counterfactual unsafe authorization rate | 95% CI | Offline counterfactual benign completion | 95% CI | False deny | Escalation | Confirmation requests (rate) | Detection ordinals 0 / 1..N / N+1 / none | Mean latency | Token cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| GUARD_MODE | 23.25% | 22.00%–24.50% | 50.00% | 50.00%–50.00% | 0.00% | 36.75% | 147 (36.75%) | 147/0/0/253 | 0.054 ms | $0.000000 |
| INTENTLOCK | 2.50% | 2.50%–2.50% | 50.00% | 50.00%–50.00% | 0.00% | 16.25% | 80 (20.00%) | 0/295/25/80 | 0.424 ms | $0.000000 |
| LLM_VERIFIER | 13.50% | 11.50%–15.50% | 33.13% | 29.38%–36.88% | 36.25% | 25.25% | 101 (25.25%) | 190/0/0/210 | 1406.374 ms | $0.524432 |
| NONE | 60.00% | 60.00%–60.00% | 50.00% | 50.00%–50.00% | 0.00% | 0.00% | 0 (0.00%) | 0/0/0/400 | 0.006 ms | $0.000000 |
| PER_CALL_POLICY | 16.50% | 15.75%–17.25% | 50.00% | 50.00%–50.00% | 0.00% | 16.25% | 65 (16.25%) | 0/239/0/161 | 0.398 ms | $0.000000 |

Run: `primary-solo-v0.4.0-01`; frozen source A: `89c742e953c8251ba4de78939648b5c7d566b9f3`; freeze commit B: `58b36e2cbd490813b4ffc848f3ea126c94c7e4b3`; primary intention-to-treat records: 2000; raw attempts: 2092.

Evidence mode: offline counterfactual replay. This table is not a fixed-fork transaction UER measurement.
