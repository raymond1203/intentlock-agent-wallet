import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeFunctionData,
  http,
  parseAbi,
  type Address,
  type Hex,
  type TransactionReceipt,
  type PublicClient,
  type TestClient,
  type WalletClient,
} from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import type { AnvilFork } from '../anvil-harness.js';
import { type Fingerprint } from '../anvil-harness.js';

// Public Anvil development mnemonic; never use these accounts on a public network.
export const TEST_MNEMONIC = 'test test test test test test test test test test test junk';
export const owner = mnemonicToAccount(TEST_MNEMONIC);
export const relayer = mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 1 });
export const ERC20_READ_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
]);
export interface ExecutedTransaction {
  sequence: number;
  role: 'SETUP' | 'USER' | 'RELAY';
  chainId: number;
  from: Address;
  to: Address;
  calldata: Hex;
  valueWei: string;
  transactionHash: Hex;
  status: 'success' | 'reverted';
  gasCostWei: string;
  receipt: TransactionReceipt;
}
let transactionSequence = 0;
// Complex lending calls can require many lazy archive reads before Anvil mines
// the local transaction. Keep the transport timeout short, but allow mining
// enough time to finish so an upstream latency spike is not misclassified as
// an incomplete execution.
const RECEIPT_TIMEOUT_MS = 120_000;

export function resetExecutionSequence(): void {
  transactionSequence = 0;
}

export class ForkRuntime {
  readonly client: PublicClient;
  readonly test: TestClient<'anvil'>;
  readonly wallet: WalletClient;
  readonly transactions: ExecutedTransaction[] = [];
  constructor(
    readonly fork: AnvilFork,
    readonly fingerprint: Fingerprint,
  ) {
    // Mutations and signatures are restricted to the local child started by AnvilFork.
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(fork.url)) throw new Error('local fork required');
    this.client = createPublicClient({
      transport: http(fork.url, { timeout: 15_000, retryCount: 1 }),
      pollingInterval: 50,
      cacheTime: 0,
    });
    this.test = createTestClient({
      mode: 'anvil',
      transport: http(fork.url, { timeout: 15_000, retryCount: 1 }),
    });
    this.wallet = createWalletClient({
      transport: http(fork.url, { timeout: 15_000, retryCount: 1 }),
    });
  }
  async send(
    to: Address,
    calldata: Hex,
    role: ExecutedTransaction['role'],
    from = owner.address,
    value = 0n,
  ): Promise<ExecutedTransaction> {
    const latest = await this.client.getBlock();
    await this.test.setNextBlockTimestamp({ timestamp: latest.timestamp + 1n });
    const hash = await this.wallet.sendTransaction({
      account: from,
      chain: null,
      to,
      data: calldata,
      value,
      gas: 8_000_000n,
    });
    const receipt = await this.client.waitForTransactionReceipt({
      hash,
      timeout: RECEIPT_TIMEOUT_MS,
    });
    const record: ExecutedTransaction = {
      sequence: transactionSequence++,
      role,
      chainId: this.fork.config.chainId,
      from,
      to,
      calldata,
      valueWei: value.toString(),
      transactionHash: hash,
      status: receipt.status,
      gasCostWei: (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
      receipt,
    };
    this.transactions.push(record);
    if (receipt.status !== 'success')
      throw new Error(
        `reverted ${String(record.chainId)}:${hash} selector=${calldata.slice(0, 10)}`,
      );
    return record;
  }
  async balance(token: Address, account: Address): Promise<bigint> {
    return this.client.readContract({
      address: token,
      abi: ERC20_READ_ABI,
      functionName: 'balanceOf',
      args: [account],
    });
  }
  async allowance(token: Address, account: Address, spender: Address): Promise<bigint> {
    return this.client.readContract({
      address: token,
      abi: ERC20_READ_ABI,
      functionName: 'allowance',
      args: [account, spender],
    });
  }
  async approve(
    token: Address,
    spender: Address,
    amount: bigint,
    from = owner.address,
  ): Promise<ExecutedTransaction> {
    return this.send(
      token,
      encodeFunctionData({ abi: ERC20_READ_ABI, functionName: 'approve', args: [spender, amount] }),
      'SETUP',
      from,
    );
  }
}

export function json(value: unknown): string {
  return (
    JSON.stringify(
      value,
      (_key, item: unknown) => (typeof item === 'bigint' ? item.toString() : item),
      2,
    ) + '\n'
  );
}
