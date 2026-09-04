import {
  decodeAbiParameters,
  decodeFunctionData,
  parseAbiParameters,
  type Address,
  type Hex,
} from 'viem';
import type { BenchmarkScenario } from '../../src/benchmark/scenario.js';
import { ERC7821_ABI } from '../../src/effects/batch-decoder.js';
import { fixtureAddress } from '../extended-benchmark.js';

const CALLS = parseAbiParameters('(address to,uint256 value,bytes data)[]');

export function executionLeaves(
  account: string,
  chainId: number,
  target: Address,
  data: Hex,
): { chainId: number; target: Address; data: Hex }[] {
  if (target.toLowerCase() !== account.toLowerCase()) return [{ chainId, target, data }];
  const { args } = decodeFunctionData({ abi: ERC7821_ABI, data });
  const [calls] = decodeAbiParameters(CALLS, args[1]);
  return calls.flatMap((call) => executionLeaves(account, chainId, call.to, call.data));
}

export function requiredReceiptCount(scenario: BenchmarkScenario): number {
  const bridgeSources = scenario.trace.actions
    .flatMap((action) =>
      executionLeaves(
        scenario.intent.account,
        action.chainId,
        action.target as Address,
        action.calldata as Hex,
      ),
    )
    .filter(
      (leaf) =>
        leaf.chainId === 1 &&
        [fixtureAddress(1, 'acrossSpokePool'), fixtureAddress(1, 'cctpTokenMessenger')].some(
          (target) => target.toLowerCase() === leaf.target.toLowerCase(),
        ),
    ).length;
  return scenario.trace.actions.length + bridgeSources;
}
