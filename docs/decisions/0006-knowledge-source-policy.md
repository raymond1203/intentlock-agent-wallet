# 0006 — Knowledge source and version policy

- Status: Accepted
- Date: 2026-08-29
- Issues: #11, #12, #13, #14, #16, #17, #19

## Context

IntentLock sits immediately before a wallet signing boundary. A remembered or inferred API behavior is
not adequate evidence for calldata decoding, policy enforcement, or claims about MetaMask Agent Wallet.
The implementation therefore needs an explicit knowledge hierarchy as well as pinned runtime evidence.

## Decision

Use the following source order for implementation and research claims:

1. The official MetaMask documentation indexed by Context7 as `/metamask/metamask-docs`.
2. The official upstream library documentation indexed by Context7, including `/wevm/viem` and
   `/colinhacks/zod`, together with the exact versions pinned in `package.json`.
3. Official protocol repositories and ABIs pinned in `benchmark/fixtures/manifest.json`.
4. The fixed-fork codehash, simulation trace, receipt, and post-state. Runtime evidence wins when a
   documentation example and the pinned chain state disagree.

Search results, blogs, generated summaries, and model memory may locate evidence but cannot be the sole
basis for a decoder or security claim.

## MetaMask integration boundary

The official Agent Wallet documentation exposes:

- `mm decode --payload <0x-calldata>` for inspecting calldata;
- `mm wallet send-transaction --chain-id <CHAIN_ID> --payload '<JSON>' [--wait]` for submission;
- server-wallet polling for asynchronous signing requests;
- Guard Mode policy inspection and updates through `mm wallet policy get|set|template`;
- the `@metamask/agentic-sdk` and `mm` CLI as the Agent Wallet architecture surface.

IntentLock therefore evaluates the canonical transaction and cumulative ActionIR before invoking the
send/sign boundary. A `DENY` or unresolved `ESCALATE` must never reach that boundary. The M1 adapter is a
testable boundary adapter, not a claim that MetaMask currently exposes an undocumented internal hook.

## Fail-closed rules

- Unknown selector, unsupported typed data, depth overflow, ABI mismatch, codehash mismatch, simulator
  failure, or documentation/runtime disagreement cannot become `ALLOW`.
- Decoder support records the ABI source and the expected codehash.
- Context7 queries contain no RPC URL, key, mnemonic, private key, user identity, or unpublished data.
- A documentation retrieval date and upstream path are recorded for material claims.

## Material sources checked on 2026-08-29

- MetaMask Agent Wallet architecture:
  <https://github.com/metamask/metamask-docs/blob/main/agent-wallet/reference/architecture.md>
- MetaMask Agent Wallet commands:
  <https://github.com/metamask/metamask-docs/blob/main/agent-wallet/reference/commands.md>
- MetaMask signing and server-wallet polling:
  <https://github.com/metamask/metamask-docs/blob/main/agent-wallet/guides/sign-messages-and-transactions.md>
- MetaMask trading modes and wallet policy:
  <https://github.com/metamask/metamask-docs/blob/main/agent-wallet/reference/trading-modes.md>
- MetaMask machine-readable documentation index:
  <https://github.com/metamask/metamask-docs/blob/main/static/llms.txt>
- Viem calldata decoding and keccak utilities:
  <https://github.com/wevm/viem/blob/main/site/pages/docs/contract/decodeFunctionData.md>,
  <https://github.com/wevm/viem/blob/main/site/pages/docs/utilities/keccak256.md>
- Zod 4 JSON Schema generation:
  <https://github.com/colinhacks/zod/blob/v4.0.1/packages/docs/content/json-schema.mdx>
- Uniswap Permit2 typed-data structures:
  <https://github.com/Uniswap/permit2/blob/main/src/interfaces/IAllowanceTransfer.sol>,
  <https://github.com/Uniswap/permit2/blob/main/src/interfaces/ISignatureTransfer.sol>
- Uniswap SwapRouter02 and multicall interfaces:
  <https://github.com/Uniswap/swap-router-contracts/blob/main/contracts/interfaces/IV3SwapRouter.sol>,
  <https://github.com/Uniswap/swap-router-contracts/blob/main/contracts/base/MulticallExtended.sol>
- ERC-7821 minimal batch executor mode:
  <https://eips.ethereum.org/EIPS/eip-7821>
- MetaMask client E2E MCP and knowledge-store scope:
  <https://github.com/MetaMask/client-mcp-core>

## Consequences

- Each new protocol decoder must add its source and fixture identity before merge.
- Documentation grounding is reproducible, while actual acceptance remains based on deterministic tests
  and fixed-fork observations.
- A future official MetaMask MCP can replace the retrieval transport without changing this hierarchy.
