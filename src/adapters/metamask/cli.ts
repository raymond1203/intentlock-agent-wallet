import type {
  MetaMaskExecutionReceipt,
  MetaMaskTransactionRequest,
  MetaMaskWalletExecutor,
} from './adapter.js';

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface MetaMaskCommandRunner {
  run(binary: 'mm', args: readonly string[]): Promise<CommandResult>;
}

export type MetaMaskReceiptParser = (
  result: CommandResult,
  request: MetaMaskTransactionRequest,
) => MetaMaskExecutionReceipt;

export function buildMetaMaskSendTransactionArgs(
  request: MetaMaskTransactionRequest,
): readonly string[] {
  const payload = JSON.stringify({
    to: request.to,
    data: request.data,
    value: request.valueWei,
  });
  return [
    'wallet',
    'send-transaction',
    '--chain-id',
    String(request.chainId),
    '--payload',
    payload,
    '--wait',
  ];
}

/**
 * Minimal Agent Wallet CLI boundary. The host owns stdout parsing because the
 * adapter must derive observed effects from a receipt/RPC source it trusts.
 * Arguments are passed as an array; no shell interpolation is used.
 */
export class MetaMaskCliExecutor implements MetaMaskWalletExecutor {
  public constructor(
    private readonly runner: MetaMaskCommandRunner,
    private readonly parseReceipt: MetaMaskReceiptParser,
  ) {}

  public async sendTransaction(
    request: MetaMaskTransactionRequest,
  ): Promise<MetaMaskExecutionReceipt> {
    const result = await this.runner.run('mm', buildMetaMaskSendTransactionArgs(request));
    return this.parseReceipt(result, request);
  }
}
