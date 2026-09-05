// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {M2FixtureAccount} from "../src/M2FixtureAccount.sol";

interface Vm {
  function prank(address) external;
  function expectRevert(bytes4) external;
}

contract CounterFixture {
  uint256 public value;
  error DeliberateFailure();

  function increment() external {
    value++;
  }

  function fail() external pure {
    revert DeliberateFailure();
  }
}

contract M2FixtureAccountTest {
  Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

  function testRejectsExternalCaller() public {
    M2FixtureAccount wallet = new M2FixtureAccount();
    vm.expectRevert(M2FixtureAccount.Unauthorized.selector);
    wallet.execute(bytes32(uint256(1) << 248), "");
  }

  function testRejectsUnsupportedMode() public {
    M2FixtureAccount wallet = new M2FixtureAccount();
    vm.prank(address(wallet));
    vm.expectRevert(M2FixtureAccount.UnsupportedMode.selector);
    wallet.execute(bytes32(0), "");
  }

  function testSelfCallExecutesAllChildren() public {
    M2FixtureAccount wallet = new M2FixtureAccount();
    CounterFixture counter = new CounterFixture();
    M2FixtureAccount.Call[] memory calls = new M2FixtureAccount.Call[](2);
    calls[0] = M2FixtureAccount.Call(address(counter), 0, abi.encodeCall(counter.increment, ()));
    calls[1] = calls[0];
    vm.prank(address(wallet));
    wallet.execute(bytes32(uint256(1) << 248), abi.encode(calls));
    require(counter.value() == 2);
  }

  function testChildFailureRollsBackPrefix() public {
    M2FixtureAccount wallet = new M2FixtureAccount();
    CounterFixture counter = new CounterFixture();
    M2FixtureAccount.Call[] memory calls = new M2FixtureAccount.Call[](2);
    calls[0] = M2FixtureAccount.Call(address(counter), 0, abi.encodeCall(counter.increment, ()));
    calls[1] = M2FixtureAccount.Call(address(counter), 0, abi.encodeCall(counter.fail, ()));
    vm.prank(address(wallet));
    vm.expectRevert(CounterFixture.DeliberateFailure.selector);
    wallet.execute(bytes32(uint256(1) << 248), abi.encode(calls));
    require(counter.value() == 0);
  }
}
