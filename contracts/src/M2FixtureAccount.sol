// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Local-fork ERC-7821 execution fixture, not a deployed production wallet.
/// Its runtime is installed only at the deterministic Anvil test account.
contract M2FixtureAccount {
  struct Call {
    address to;
    uint256 value;
    bytes data;
  }

  error Unauthorized();
  error UnsupportedMode();

  function execute(bytes32 mode, bytes calldata executionData) external payable {
    if (msg.sender != address(this)) revert Unauthorized();
    if (mode != bytes32(uint256(1) << 248)) revert UnsupportedMode();
    Call[] memory calls = abi.decode(executionData, (Call[]));
    for (uint256 i; i < calls.length; ++i) {
      (bool ok, bytes memory result) = calls[i].to.call{value: calls[i].value}(calls[i].data);
      if (!ok) {
        assembly ("memory-safe") {
          revert(add(result, 32), mload(result))
        }
      }
    }
  }

  receive() external payable {}
}
