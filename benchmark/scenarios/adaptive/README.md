# Adaptive signer-boundary scenarios

This directory intentionally contains no duplicated scenario JSON files. The 40 adaptive episodes
are deterministically selected from the canonical authored base scenarios by
`experiments/configs/adaptive-selection-v0.1.json`. Each selection records a base scenario ID,
attack family, attack type, seed, and whether it belongs to the fixed ten-case human review packet.

The canonical generation path is:

1. Load and schema-validate all 80 files below `benchmark/scenarios/base`.
2. Load the committed adaptive selection config and resolve every `baseScenarioId` to exactly one
   authored base file.
3. Verify the declared workflow family and the preregistered chain-balance constraints.
4. Derive the scripted proposals only from the selected scenario, recorded seed, and public guard
   observations. No copied or hand-edited adaptive scenario file is an input.
5. Record the source path and SHA-256 digest of every selected base file in the immutable adaptive
   run manifest.

An adaptive run additionally requires the canonical evaluation and ablation manifests to be jointly
`FROZEN`, a validated primary 2,000-row run, the reviewed candidate A to freeze commit B transition,
and a clean execution commit descended from B. The generated `comparison.json` selects the primary
attempt-one `INTENTLOCK`/`BENIGN_ORIGINAL` row with the same base-scenario ID. That artifact is a
descriptive `NON_PAIRED_NON_CAUSAL` contrast only: the static and adaptive cases are not equivalent,
and it provides no model-adaptive, fork-execution, production MetaMask, or causal evidence.
