# M2 scenario-specific execution evidence

This collector is a diagnostic on the published v0.2.0 candidate. It does not turn an authored
`EXPECTED_FIXTURE` into an executed fact, silently change intent limits, or approve human review.
Normal-call success, final economic goals, and agreement with the synthetic reference are separate.

## Reproduction

Use the Node/pnpm/Foundry versions in the repository and set `FORK_RPC_URL_1` and
`FORK_RPC_URL_8453` to archive-capable endpoints. Do not commit their values. Then run:

```text
pnpm m2:execute --quotes --out=experiments/results/m2-execution-unique-run
pnpm m2:reviews
```

`--ids=TR-,AP-` selects prefixes for diagnosis. Omit it for all 80 bases. Use a new output
directory for each attempt so that failed runs remain available. Results are ignored locally;
public evidence summaries contain only test-account data, hashes, and receipt/state observations.
No production wallet, private funding account, OpenAI key, or signing service is needed.

The runner refuses to write into a non-empty output directory. `pnpm m2:execute` enables strict mode
and returns a non-zero status unless every selected scenario has the required successful receipts and
complete oracle evidence; a semantic `VIOLATION` can still be a complete execution. Use
`pnpm m2:execute:diagnostic` only when intentionally collecting incomplete failure evidence.

Each variable may contain a comma-separated Anvil upstream pool. Every listed endpoint must support
historical account and storage reads at the pinned block; a provider that can return the block header
but prunes historical state is not usable. The pool is not a guarantee that Anvil will recover from
an endpoint-specific archive error, so retain each failed attempt and retry in a new directory.

## Isolation and evidence boundaries

- Each case starts fresh Anvil processes at the frozen Ethereum/Base blocks. The harness verifies
  chain, block hash and listed contract code hashes before funding. A process is always stopped
  after the case, including on error; prior cases' state and transaction pool are not reused.
- Only loopback fork clients can mutate state. The public Anvil test account is funded through
  deterministic balance injection. Its original code hash is recorded before removing any
  existing EIP-7702 delegation in this **local copy**. No public-chain write is sent.
- Required account funding is calculated over every action prefix, including borrow credits and
  destination bridge credits. A supply followed by a withdrawal must be funded before the supply,
  even if the final net debit is smaller. Any increase over the authored synthetic pre-balance is
  explicitly recorded as a fixture correction, not silently equated to the old pre-state.
- Batches install `M2FixtureAccount` runtime at the test account. Its self-call restriction,
  supported mode, order and atomic rollback have Solidity tests. This is an execution fixture,
  **not** a full MetaMask wallet, authorization implementation, or deployed product-equivalent.
- Permit2 signatures are real EIP-712 signatures from the public test mnemonic. Required nonce
  invalidation and underlying-token approval are recorded as setup. SignatureTransfer's spender
  is the actual caller; the collector does not impersonate a router to hide the candidate's
  incorrect caller annotation.
- Single-swap prior approval is explicit setup, not a hidden user action. Actual token allowance
  is observed after execution, including the underlying Permit2 allowance for one-use signatures.
- Across fills use an independently funded local relayer and the **actual source deposit event**.
  CCTP receives the **actual source message**, signed by a local test attester enabled using
  manager impersonation on the destination fork. The old threshold and setup receipts are recorded.
  Neither path tests live relayer service, finality, production attestations, reimbursement, or
  end-to-end bridge security. Destination user balances are not injected to manufacture settlement.
- Receipt token mints/burns of pinned Aave reserve tokens are recorded separately from underlying
  payments to avoid double-counting debt repayment/position withdrawal. Ordinary collateral
  transfers and unknown assets remain in gross-outflow accounting. aToken and debt balances
  provide actual position/debt observations; nominal calldata amounts are not exact balances.
- Setup gas and relay gas are recorded separately from the test account's user-action receipts.
  The collector currently passes USER and RELAY receipts to the oracle, a conservative total
  workflow gas measure, not a claim that every relay fee is charged to the user.

## Recorded data

Each raw result includes the original scenario hash, source commit/dirty flag, verified fork
fingerprints, setup notes, resolved signatures, globally ordered setup/user/relay receipts, actual
pre/post observations, token-flow evidence, independent oracle decision, reference disagreements,
and any error. Partial/reverted/timed-out traces cannot be reported as successful normal runs.
Per-case failures are not silently replaced with a successful retry; each run retains its own files.
The receipt collector allows up to 120 seconds for complex Aave calls whose local mining can trigger
many lazy archive reads. Transport requests retain a short timeout so an unavailable upstream still
fails visibly.

With `--quotes`, the collector additionally calls QuoterV2 at the original pinned block and records
the quoter, every route pool and their code hashes, quote inputs/output, and authored slippage.
This does not modify the scenario's min-output. A tiny authored minimum can pass execution while
failing natural-language alignment; a human must approve the revised data contract before re-freeze.

## Primary references

- [Uniswap Ethereum deployments](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-ethereum-deployments)
  and [Base deployments](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments).
- [QuoterV2 interface](https://github.com/Uniswap/v3-periphery/blob/0682387198a24c7cd63566a2c58398533860a5d1/contracts/interfaces/IQuoterV2.sol).
- [Across relay interface, pinned commit](https://github.com/across-protocol/contracts/blob/19e346a5415e2ebb18fafe590f76dc90f413d1b5/contracts/interfaces/V3SpokePoolInterface.sol).
- [CCTP message receiver, pinned commit](https://github.com/circlefin/evm-cctp-contracts/blob/a92a2b4e7e6ef99bf0b05dca71780f5ec190e729/src/MessageTransmitter.sol).
- Other supported ABI subsets and assumptions: `docs/effects/protocol-decoders.md`.
- The first complete v0.2.0 diagnostic and proposed correction policy:
  `docs/experiments/m2-execution-findings-20260904.md`.
