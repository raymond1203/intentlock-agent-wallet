# M2 bridge and lending decoder boundary

Checked 2026-09-03. ABI decoding is not evidence that a transaction executes successfully.

| Decoder | Pinned official source                                                                                                                                                                                                    | Supported subset                                                                                                         |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Across  | [V3SpokePoolInterface, 19e346a](https://github.com/across-protocol/contracts/blob/19e346a5415e2ebb18fafe590f76dc90f413d1b5/contracts/interfaces/V3SpokePoolInterface.sol)                                                 | Legacy address-based depositV3; empty message, self depositor, zero native value, explicitly mapped same-unit USDC route |
| Circle  | [TokenMessenger V1, a92a2b4](https://github.com/circlefin/evm-cctp-contracts/blob/a92a2b4e7e6ef99bf0b05dca71780f5ec190e729/src/TokenMessenger.sol), [V1 domains](https://developers.circle.com/cctp/v1/supported-domains) | Four-argument depositForBurn, domain 6 maps to Base 8453; V2 and non-EVM recipients are unsupported                      |
| Aave    | [IPool, cff15de](https://github.com/aave-dao/aave-v3-origin/blob/cff15de6d1271b0c800fc001f4aea4c263e8a597/src/contracts/interfaces/IPool.sol)                                                                             | Self-account supply/borrow/repay/withdraw, variable rate; repay and withdraw require reserve state                       |

Unknown routes, callback messages, delegation, unsupported interest modes and missing state return
UNKNOWN. Codehash checks remain in the shared batch decoder. A proxy runtime hash alone does not
pin its implementation; protocol execution still requires the fixture/proxy identity audit.

BRIDGE preserves source asset, destination asset, amount, destination minimum and deadline. Its
departure must not be counted again as a duplicate ERC20 transfer. Destination settlement is NOT
proven by source calldata. CCTP attestation and Across relaying are not simulated as real delivery.

Aave produces underlying token movement plus POSITION or DEBT deltas. Supplied balances and debt
are inputs from the execution context; literal amounts do not prove liquidity, solvency, interest,
rounding, health factor or executable approval. The offline fixtures use explicit synthetic state.
Nested lending calls with interdependent state need a stateful execution adapter before broadcast.

Intermediate `safety.debtLimits` are distinct from final `MAX_DEBT`: borrowing 100 then repaying 50
may have an authorized peak of 100 and final cap of 50. The monitor checks the cumulative peak,
including the accepted prefix. The oracle checks observed final debt separately.
