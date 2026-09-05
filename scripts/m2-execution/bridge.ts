import { encodeFunctionData, keccak256, pad, parseAbi, parseEventLogs, type Address } from 'viem';
import { fixtureAddress } from '../extended-benchmark.js';
import type { ForkRuntime } from './runtime.js';
import { relayer, type ExecutedTransaction } from './runtime.js';

// Source versions: docs/effects/protocol-decoders.md. These are LOCAL test relays,
// not evidence of production attestation, finality, or relayer reimbursement.
const ACROSS_RELAY = parseAbi([
  'event FundsDeposited(bytes32 inputToken,bytes32 outputToken,uint256 inputAmount,uint256 outputAmount,uint256 indexed destinationChainId,uint256 indexed depositId,uint32 quoteTimestamp,uint32 fillDeadline,uint32 exclusivityDeadline,bytes32 indexed depositor,bytes32 recipient,bytes32 exclusiveRelayer,bytes message)',
  'struct RelayData { bytes32 depositor; bytes32 recipient; bytes32 exclusiveRelayer; bytes32 inputToken; bytes32 outputToken; uint256 inputAmount; uint256 outputAmount; uint256 originChainId; uint256 depositId; uint32 fillDeadline; uint32 exclusivityDeadline; bytes message; }',
  'function fillRelay(RelayData relayData,uint256 repaymentChainId,bytes32 repaymentAddress)',
]);
const CIRCLE = parseAbi([
  'event MessageSent(bytes message)',
  'function localMessageTransmitter() view returns (address)',
  'function attesterManager() view returns (address)',
  'function isEnabledAttester(address) view returns (bool)',
  'function signatureThreshold() view returns (uint256)',
  'function enableAttester(address)',
  'function setSignatureThreshold(uint256)',
  'function receiveMessage(bytes message,bytes attestation) returns (bool)',
]);
export async function prepareRelay(destination: ForkRuntime, notes: string[]): Promise<void> {
  const original = await destination.client.getCode({ address: relayer.address });
  await destination.test.setCode({ address: relayer.address, bytecode: '0x' });
  await destination.fork.setBalance(relayer.address, 100n * 10n ** 18n);
  notes.push(
    `local test relayer ${relayer.address}; original-codehash=${keccak256(original ?? '0x')}`,
  );
}

/** Relay only events emitted by the pinned source protocol in a successful user receipt. */
export async function relaySourceReceipt(
  source: ForkRuntime,
  destination: ForkRuntime,
  transaction: ExecutedTransaction,
  notes: string[],
): Promise<void> {
  const deposits = parseEventLogs({
    abi: ACROSS_RELAY,
    eventName: 'FundsDeposited',
    logs: transaction.receipt.logs.filter(
      (l) => l.address.toLowerCase() === fixtureAddress(1, 'acrossSpokePool').toLowerCase(),
    ),
  });
  for (const { args } of deposits) {
    if (args.destinationChainId !== BigInt(destination.fork.config.chainId))
      throw new Error('relay destination mismatch');
    const token: Address = `0x${args.outputToken.slice(-40)}`;
    const spoke = fixtureAddress(destination.fork.config.chainId, 'acrossSpokePool');
    const before = await destination.balance(token, relayer.address);
    await destination.fork.dealErc20(token, relayer.address, before + args.outputAmount);
    await destination.approve(token, spoke, args.outputAmount, relayer.address);
    notes.push(
      `Across test-relayer funding ${token}:${args.outputAmount.toString()}; source=${transaction.transactionHash}; deposit=${args.depositId.toString()}`,
    );
    await destination.send(
      spoke,
      encodeFunctionData({
        abi: ACROSS_RELAY,
        functionName: 'fillRelay',
        args: [
          { ...args, originChainId: BigInt(source.fork.config.chainId) },
          BigInt(source.fork.config.chainId),
          pad(relayer.address),
        ],
      }),
      'RELAY',
      relayer.address,
    );
  }
  const messages = parseEventLogs({
    abi: CIRCLE,
    eventName: 'MessageSent',
    logs: transaction.receipt.logs.filter(
      (l) => l.address.toLowerCase() === fixtureAddress(1, 'cctpMessageTransmitter').toLowerCase(),
    ),
  });
  if (!messages.length) return;
  const transmitter = await destination.client.readContract({
    address: fixtureAddress(8453, 'cctpTokenMessenger'),
    abi: CIRCLE,
    functionName: 'localMessageTransmitter',
  });
  const manager = await destination.client.readContract({
    address: transmitter,
    abi: CIRCLE,
    functionName: 'attesterManager',
  });
  const threshold = await destination.client.readContract({
    address: transmitter,
    abi: CIRCLE,
    functionName: 'signatureThreshold',
  });
  const enabled = await destination.client.readContract({
    address: transmitter,
    abi: CIRCLE,
    functionName: 'isEnabledAttester',
    args: [relayer.address],
  });
  await destination.test.impersonateAccount({ address: manager });
  try {
    await destination.fork.setBalance(manager, 10n ** 18n);
    if (!enabled)
      await destination.send(
        transmitter,
        encodeFunctionData({
          abi: CIRCLE,
          functionName: 'enableAttester',
          args: [relayer.address],
        }),
        'SETUP',
        manager,
      );
    if (threshold !== 1n)
      await destination.send(
        transmitter,
        encodeFunctionData({ abi: CIRCLE, functionName: 'setSignatureThreshold', args: [1n] }),
        'SETUP',
        manager,
      );
  } finally {
    await destination.test.stopImpersonatingAccount({ address: manager });
  }
  notes.push(
    `CCTP LOCAL ONLY attester-manager impersonation ${manager}; original threshold=${threshold.toString()}; test threshold=1; transmitter=${transmitter}`,
  );
  for (const { args } of messages) {
    const digest = keccak256(args.message);
    const attestation = await relayer.sign({ hash: digest });
    notes.push(
      `CCTP test attestation for actual MessageSent ${digest}; source=${transaction.transactionHash}`,
    );
    await destination.send(
      transmitter,
      encodeFunctionData({
        abi: CIRCLE,
        functionName: 'receiveMessage',
        args: [args.message, attestation],
      }),
      'RELAY',
      relayer.address,
    );
  }
}
