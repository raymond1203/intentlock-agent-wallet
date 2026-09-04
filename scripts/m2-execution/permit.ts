import { decodeFunctionData, encodeFunctionData, parseAbi, type Hex } from 'viem';
import { PERMIT2_ABI } from '../../src/effects/permit2-decoder.js';
import { fixtureAddress } from '../extended-benchmark.js';
import type { ForkRuntime } from './runtime.js';
import { owner } from './runtime.js';

const PERMIT_READ = parseAbi([
  'function allowance(address,address,address) view returns (uint160 amount,uint48 expiration,uint48 nonce)',
  'function invalidateNonces(address token,address spender,uint48 newNonce)',
]);
const DETAILS = [
  { name: 'token', type: 'address' },
  { name: 'amount', type: 'uint160' },
  { name: 'expiration', type: 'uint48' },
  { name: 'nonce', type: 'uint48' },
] as const;

export async function resolvePermit(runtime: ForkRuntime, calldata: Hex): Promise<Hex> {
  const address = fixtureAddress(runtime.fork.config.chainId, 'permit2');
  const decoded = decodeFunctionData({ abi: PERMIT2_ABI, data: calldata });
  const domain = {
    name: 'Permit2',
    chainId: runtime.fork.config.chainId,
    verifyingContract: address,
  };
  if (decoded.functionName === 'permit') {
    const [account, permit] = decoded.args;
    if (account.toLowerCase() !== owner.address.toLowerCase())
      throw new Error('only test owner can sign');
    const [, , current] = await runtime.client.readContract({
      address,
      abi: PERMIT_READ,
      functionName: 'allowance',
      args: [account, permit.details.token, permit.spender],
    });
    if (current < permit.details.nonce) {
      await runtime.send(
        address,
        encodeFunctionData({
          abi: PERMIT_READ,
          functionName: 'invalidateNonces',
          args: [permit.details.token, permit.spender, permit.details.nonce],
        }),
        'SETUP',
      );
    } else if (current !== permit.details.nonce) throw new Error('fixture nonce already consumed');
    const signature = await owner.signTypedData({
      domain,
      primaryType: 'PermitSingle',
      types: {
        PermitDetails: DETAILS,
        PermitSingle: [
          { name: 'details', type: 'PermitDetails' },
          { name: 'spender', type: 'address' },
          { name: 'sigDeadline', type: 'uint256' },
        ],
      },
      message: permit,
    });
    return encodeFunctionData({
      abi: PERMIT2_ABI,
      functionName: 'permit',
      args: [account, permit, signature],
    });
  }
  const [permit, transfer, account] = decoded.args;
  if (account.toLowerCase() !== owner.address.toLowerCase())
    throw new Error('only test owner can sign');
  await runtime.approve(permit.permitted.token, address, permit.permitted.amount);
  const signature = await owner.signTypedData({
    domain,
    primaryType: 'PermitTransferFrom',
    types: {
      TokenPermissions: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
      PermitTransferFrom: [
        { name: 'permitted', type: 'TokenPermissions' },
        { name: 'spender', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    message: { ...permit, spender: owner.address },
  });
  return encodeFunctionData({
    abi: PERMIT2_ABI,
    functionName: 'permitTransferFrom',
    args: [permit, transfer, account, signature],
  });
}

export { PERMIT_READ };
