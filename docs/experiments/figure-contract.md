# Static research figure contract

These existing SVG exports are paper figures, not an HTML dashboard or a new chart service.
Their public function names, 900 × 560 footprint, and analysis output filenames remain stable.
They visualize reviewed analysis values without changing metrics or observations.

| Figure           | Question and supported takeaway                                  | Form and data sufficiency                                                                                                                                                                     | Fields and denominator                                                                                                                                     |
| ---------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Security–utility | How do five fixed systems compare on two offline rates?          | Aligned dot-and-95%-interval panels. Five fixed aggregates do not support a fitted relationship; finer grain would change the comparison. Separate labeled rows preserve ties without jitter. | Unsafe authorization / all selected cases; benign completion / benign selected cases. Missing benign denominator is unavailable, not zero.                 |
| Latency          | What is each system's mean decision latency?                     | Zero-based bars with direct labels and visible open zero marks.                                                                                                                               | Mean milliseconds over all selected cases including failures and abstentions; row sample size.                                                             |
| Errors           | How many classified errors occur per system?                     | Zero-based bars with exact counts and leading categories.                                                                                                                                     | Existing errorsByMutation counts and selected-case denominator; no reclassification.                                                                       |
| Architecture     | Which components are measured, optional, or implementation-only? | Separate optional-compiler, measured-replay and adapter flows.                                                                                                                                | Source-grounded compiler, adapter and in-memory ledger behavior. No real-consent, semantic taint-proof, distributed-ledger or global signing-freeze claim. |

Palette: one blue root (#2878b5, dark #174f78, light #edf4fa) plus neutrals.
Non-color distinctions: direct system labels and separate rows; open utility marks and filled
unsafe-authorization marks. No jitter. Sans-serif type and monospace exact values. As third-party
IntentLock research, these figures omit another organization's branding or blossom.

QA: tests cover coincident/extreme rates, zero bars, unavailable denominators, XML escaping and
architecture wording. Render and inspect final generated SVGs at paper/laptop size after analysis;
code tests alone do not constitute visual approval.
