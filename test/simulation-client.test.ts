import { describe, expect, it } from 'vitest';
import { mainnet } from 'viem/chains';

import { createSimulationClient } from '../src/evm/client.js';

describe('createSimulationClient', () => {
  it('binds the read-only client to an explicit chain', () => {
    const client = createSimulationClient({
      chain: mainnet,
      rpcUrl: 'http://127.0.0.1:8545',
    });

    expect(client.chain.id).toBe(mainnet.id);
    expect(client.type).toBe('publicClient');
  });
});
