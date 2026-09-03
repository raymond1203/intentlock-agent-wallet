# Guard Mode public-docs emulator

Related: #25, Billy's #47, integrated in #46. Source rechecked 2026-09-03.

This is a research approximation, not the MetaMask service, an implementation-equivalence claim,
or evidence of a production vulnerability. Billy's implementation is retained with integration
regressions for nested targets, unavailable asset valuation and non-monotonic evaluation time.

## Source-to-rule mapping

The official [trading-modes reference](https://docs.metamask.io/agent-wallet/reference/trading-modes/)
describes network, address and token-recipient allowlists, a rolling 24-hour outflow limit and
approval outside policy. It also describes threat scanning in both trading modes. The emulator
does not reproduce the service's threat scanner, user authentication or approval workflow.

The official [outflow-policy reference](https://docs.metamask.io/agent-wallet/reference/outflow-policy/)
describes simulated USD outflow, confirmation-based accounting, and exclusion of signatures such
as Permit2 from that accounting. It advises reliance on allowlists when outflow cannot be tracked.
That advice does not establish the backend's exact decision procedure for simulation failures.

| Implemented check         | Research interpretation                                                     |
| ------------------------- | --------------------------------------------------------------------------- |
| Network allowlist         | Top-level and nested effect chains must be allowed                          |
| Address allowlist         | Top-level and nested effect targets must be allowed                         |
| Token-recipient allowlist | Economic output recipients must be allowed                                  |
| Rolling outflow ledger    | 86,400-second window, separated by chain and asset                          |
| Outside policy            | ABSTAIN, representing pending user approval rather than automatic execution |
| Unknown effect            | Allowlist-only fallback hypothesis; not verified service behavior           |

## Assumptions that affect results

- **Valuation:** per-asset integer limits approximate the documented USD limit. No price feed is
  modeled. Missing valuation limits now yield ABSTAIN, not zero outflow.
- **Policy selection:** allowlists and limits are derived from the same authored Intent Contract.
  This is a controlled comparison, not an observation of real user configuration.
- **Protocol transfers:** transfers to allowed protocol targets are treated as interactions, with
  final token recipients checked separately. This interpretation may differ from the service.
- **Confirmation:** the synchronous emulator commits ledger entries after ALLOW. This assumes
  successful confirmation; it is not a real receipt/confirmation adapter.
- **Approvals:** approval amounts add no immediate asset outflow. Direct ERC20 `approve` is a
  transaction, not an off-chain signature, so its behavior cannot be justified solely by the
  documented exclusion of signatures. Approval-cap and expiration checks are not modeled here.
- **Unknown simulation:** the allowlist-only interpretation is one explicit hypothesis. A missing
  threat-scanner implementation means its ALLOW cannot establish production fail-open behavior.

### Address-allowlist sensitivity

Public wording does not precisely settle whether approval spenders are included. Report both:

- `STRICT` (default): spender must also be address-allowlisted.
- `LITERAL`: checks call targets and economic recipients, not approval spender separately.

Neither branch is asserted to be the product's actual implementation.

## Validation and reporting

`experiments/configs/m2-validation.json` records per-case outcomes for all 80 bases and generated
mutations under both interpretations. These are authored-fixture integration diagnostics, not
measured product performance. Do not reuse the old 40-base/14-mutation aggregate as a final result.

All PRE_SIGN comparisons use the shared stage filter. The stale-quote fixture changes only future
post-state, leaving observable pre-sign input unchanged, so it is excluded for **every** pre-sign
method. It may test the terminal oracle, but cannot demonstrate a pre-sign detection gap.

ABSTAIN prevents automatic execution and incurs user-review burden. Report that separately from
DENY and ALLOW; exact label agreement is not an unsafe-execution rate. Findings about approval
exposure, execution quality or cumulative intent are scoped to this approximation and its stated
assumptions, not MetaMask's complete defenses.
