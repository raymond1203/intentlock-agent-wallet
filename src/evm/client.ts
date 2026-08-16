import { createPublicClient, http, type Chain, type PublicClient, type Transport } from 'viem';

export interface SimulationClientConfig {
  chain: Chain;
  rpcUrl: string;
}

export type SimulationClient = PublicClient<Transport, Chain>;

export function createSimulationClient({
  chain,
  rpcUrl,
}: SimulationClientConfig): SimulationClient {
  return createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
}
