# Adaptive signer-boundary descriptive results

**Design:** `NON_PAIRED_NON_CAUSAL`. These are deterministic scripted, offline signer-boundary episodes with a fake executor and no post-state observation. They are not model-adaptive, fork-execution, production MetaMask, paired-case, equivalent-case, or causal evidence.

| Evidence source | Scope | Rows | Descriptive counts |
| --- | --- | ---: | --- |
| Frozen static primary | OFFLINE_COUNTERFACTUAL_REPLAY | 40 | ALLOW 40; DENY 0; ABSTAIN 0 |
| Adaptive signer boundary | OFFLINE_SCRIPTED_SIGNER_BOUNDARY_ONLY | 40 | ATTACK_SUCCESS 0; SAFE_BLOCK 40; NORMAL_FAILURE 0; INCONCLUSIVE 0 |

No cross-row rate difference is computed because the two evidence sources are neither paired nor equivalent experimental cases.

Run: `adaptive-solo-v0.4.0-01`; attempted plans: 160; signer invocations: 0.
