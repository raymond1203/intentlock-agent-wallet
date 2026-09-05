# M2 scenario-specific execution evidence

The current collector targets the corrected v0.4.0 candidate. It does not turn an authored
`EXPECTED_FIXTURE` into an executed fact, silently change intent limits, or approve human review.
Normal-call success, final economic goals, and agreement with the synthetic reference are separate.
The published v0.2.0 run and the rejected clean v0.3.0 80/80 replay remain historical diagnostic
evidence and are not counted here. The v0.4.0 machine evidence is complete at 80/80 strict-authored
executions, 80/80 final-goal PASS, and zero synthetic reference disagreements. Human review remains
incomplete, so this does not make M2 complete.

## Reproduction

Use the Node/pnpm/Foundry versions in the repository and set `FORK_RPC_URL_1` and
`FORK_RPC_URL_8453` to archive-capable endpoints. Do not commit their values. Then run:

```text
pnpm m2:execute --out=experiments/results/m2-v0.4.0-attempt-01
pnpm m2:evidence --runs=experiments/results/m2-v0.4.0-attempt-01 --out=benchmark/evidence/m2-execution-v0.4.0.json --require-all-executed
pnpm m2:validate
pnpm m2:validate --check
pnpm m2:reviews
```

`--ids=TR-,AP-` selects prefixes for diagnosis. Omit it for all 80 bases. Use a new output
directory for each attempt so that failed runs remain available. Results are ignored locally;
public evidence summaries contain only test-account data, hashes, and receipt/state observations.
No production wallet, private funding account, OpenAI key, or signing service is needed.

The runner refuses to write into a non-empty output directory. `pnpm m2:execute` enables strict mode
and returns a non-zero status unless every selected scenario has the required successful receipts and
complete oracle evidence; a semantic `VIOLATION` can still be a complete execution. Use
`pnpm m2:execute:diagnostic` only when intentionally collecting incomplete failure evidence. The
strict command also fails before opening a fork when the source tree is dirty and rejects a source
commit or worktree change during execution. The diagnostic command deliberately retains dirty-run
support and records `workingTreeDirty: true`.

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
  even if the final net debit is smaller. If a v0.4.0 authored synthetic pre-balance is insufficient,
  any local increase is explicitly marked as a fixture correction and cannot satisfy the
  strict-authored evidence count.
- Batches install `M2FixtureAccount` runtime at the test account. Its self-call restriction,
  supported mode, order and atomic rollback have Solidity tests. This is an execution fixture,
  **not** a full MetaMask wallet, authorization implementation, or deployed product-equivalent.
- Permit2 signatures are real EIP-712 signatures from the public test mnemonic. Required nonce
  invalidation and underlying-token approval are recorded as setup. SignatureTransfer's spender
  is the actual caller; AP-04 and AP-08 encode that caller in the v0.4.0 authored effects.
- Single-swap prior approval is explicit setup, not a hidden user action. Actual token allowance
  is observed after execution, including the underlying Permit2 allowance for one-use signatures.
- For ordered ERC-20 approval plus `transferFrom` effects, the v0.4.0 synthetic terminal allowance
  is approval minus later matching consumption. ADR 0010 corrected seven `SWAP_BATCH` residuals to
  zero without changing calldata, decisions, labels, quote inputs or oracle operators.
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
When several run directories are published in chronological order, the first complete attempt for
each scenario is selected. Later failures or alternate successes cannot overwrite it; if no attempt
completes, the latest failure is selected. The full attempt history remains in the artifact.
Publishing copies every exact raw JSON file into the repository's content-addressed
`benchmark/evidence/raw/v0.4.0/sha256/` bundle and records its path and digest on the attempt. After
that bundle and summary are committed, `validate-m2` reloads the raw bytes from Git `HEAD`, verifies
the scenario/collector/source lineage, and recomputes receipt completeness and post-state oracle
results independently. The compact published fields and top-level counts are assertions rather than
trust roots.
The current acceptance and freeze gate requires 80 complete strict-authored v0.4.0 executions and
`syntheticReferenceDisagreementCount: 0`. A run that reports 80 normal execution PASS but any
synthetic disagreement is diagnostic only. It cannot satisfy M2, approve a baseline, or become a
freeze candidate.
The receipt collector allows up to 120 seconds for complex Aave calls whose local mining can trigger
many lazy archive reads. Transport requests retain a short timeout so an unavailable upstream still
fails visibly.

Before any user action can move a pool, the collector calls QuoterV2 for every swap and compares the
block/hash, quoter/codehash, route pools/codehashes, path, amount, quote and authored minimum with
the v0.4.0 scenario. The underlying `swap-quotes-v0.3.json` dependency is intentionally reused
byte-for-byte under ADR 0010. Any mismatch aborts the scenario. The observation is always recorded
and does not modify calldata or authorize a different minimum.

## Historical v0.3.0 rejection

A clean v0.3.0 replay completed all 80 normal executions with 80/80 final-goal PASS. Independent
synthetic-reference reconciliation then found seven terminal allowance disagreements in BS-01,
BS-02, BS-04, BS-05, BS-07, BS-08 and BS-10. The generator had retained the approval amount after a
matching `transferFrom` consumed it. ADR 0010 invalidates that run, its LLM baseline and every
derived freeze candidate. The local artifact is retained outside Git as rejected diagnostic
provenance; no row, review or aggregate may be reused for v0.4.0.

## Primary references

- [Uniswap Ethereum deployments](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-ethereum-deployments)
  and [Base deployments](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments).
- [QuoterV2 interface](https://github.com/Uniswap/v3-periphery/blob/0682387198a24c7cd63566a2c58398533860a5d1/contracts/interfaces/IQuoterV2.sol).
- [Across relay interface, pinned commit](https://github.com/across-protocol/contracts/blob/19e346a5415e2ebb18fafe590f76dc90f413d1b5/contracts/interfaces/V3SpokePoolInterface.sol).
- [CCTP message receiver, pinned commit](https://github.com/circlefin/evm-cctp-contracts/blob/a92a2b4e7e6ef99bf0b05dca71780f5ec190e729/src/MessageTransmitter.sol).
- Other supported ABI subsets and assumptions: `docs/effects/protocol-decoders.md`.
- The first complete v0.2.0 diagnostic and proposed correction policy:
  `docs/experiments/m2-execution-findings-20260904.md`.
