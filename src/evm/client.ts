import { createPublicClient, http, type PublicClient } from 'viem';

export function createSimulationClient(rpcUrl: string): PublicClient {
  return createPublicClient({
    transport: http(rpcUrl),
  });
}
