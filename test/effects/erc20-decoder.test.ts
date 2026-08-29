import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  parseAbiParameters,
} from 'viem';
import { describe, expect, it } from 'vitest';

import { decodeErc20Calldata, decodeErc20Log, ERC20_ABI } from '../../src/effects/erc20-decoder.js';
import {
  decodePermit2Calldata,
  decodePermit2TypedData,
  PERMIT2_ABI,
} from '../../src/effects/permit2-decoder.js';
import { comparePredictedAndObserved } from '../../src/effects/types.js';

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const SPENDER = '0x3333333333333333333333333333333333333333';
const TOKEN = '0x4444444444444444444444444444444444444444';
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const MAX_UINT256 = (1n << 256n) - 1n;

function context(data: `0x${string}`) {
  return { chainId: 1, target: TOKEN, caller: ACCOUNT, data } as const;
}

describe('ERC-20 effect decoder', () => {
  it('decodes transfer as immediate gross outflow', () => {
    const result = decodeErc20Calldata(
      context(
        encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'transfer',
          args: [RECIPIENT, 10n],
        }),
      ),
    );
    expect(result).toMatchObject({
      status: 'COMPLETE',
      effects: [{ kind: 'TRANSFER', from: ACCOUNT, to: RECIPIENT, amount: '10' }],
    });
  });

  it('decodes transferFrom with the calldata owner and recipient', () => {
    const result = decodeErc20Calldata(
      context(
        encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'transferFrom',
          args: [ACCOUNT, RECIPIENT, 11n],
        }),
      ),
    );
    expect(result.effects[0]).toMatchObject({
      kind: 'TRANSFER',
      from: ACCOUNT,
      to: RECIPIENT,
      amount: '11',
    });
  });

  it('records unlimited approval as exposure rather than outflow', () => {
    const result = decodeErc20Calldata(
      context(
        encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [SPENDER, MAX_UINT256],
        }),
      ),
    );
    expect(result.effects[0]).toMatchObject({
      kind: 'APPROVAL',
      spender: SPENDER,
      amount: MAX_UINT256.toString(),
    });
  });

  it('records zero approval as a revoke', () => {
    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [SPENDER, 0n],
    });
    expect(decodeErc20Calldata(context(data)).effects[0]).toMatchObject({
      kind: 'APPROVAL',
      amount: '0',
    });
  });

  it.each(['0xdeadbeef', '0xa9059cbb00'] as const)(
    'fails closed for unknown or malformed calldata %s',
    (data) => {
      expect(decodeErc20Calldata(context(data))).toMatchObject({
        status: 'UNKNOWN',
        effects: [{ kind: 'UNKNOWN' }],
      });
    },
  );

  it('decodes Transfer receipt logs as observed effects', () => {
    const topics = encodeEventTopics({
      abi: ERC20_ABI,
      eventName: 'Transfer',
      args: { from: ACCOUNT, to: RECIPIENT },
    });
    const result = decodeErc20Log({
      chainId: 1,
      token: TOKEN,
      topics: topics as `0x${string}`[],
      data: encodeAbiParameters(parseAbiParameters('uint256'), [10n]),
      logIndex: 0,
    });
    expect(result.effects[0]).toMatchObject({
      phase: 'OBSERVED',
      kind: 'TRANSFER',
      from: ACCOUNT,
      to: RECIPIENT,
      amount: '10',
    });
  });

  it('decodes Approval receipt logs as observed exposure', () => {
    const topics = encodeEventTopics({
      abi: ERC20_ABI,
      eventName: 'Approval',
      args: { owner: ACCOUNT, spender: SPENDER },
    });
    const result = decodeErc20Log({
      chainId: 1,
      token: TOKEN,
      topics: topics as `0x${string}`[],
      data: encodeAbiParameters(parseAbiParameters('uint256'), [7n]),
      logIndex: 1,
    });
    expect(result.effects[0]).toMatchObject({
      phase: 'OBSERVED',
      kind: 'APPROVAL',
      owner: ACCOUNT,
      spender: SPENDER,
      amount: '7',
    });
  });
});

describe('Permit2 effect decoder', () => {
  const typedData = {
    chainId: 1,
    verifyingContract: PERMIT2,
    owner: ACCOUNT,
    details: { token: TOKEN, amount: '100', expiration: '1788562800', nonce: '3' },
    spender: SPENDER,
    sigDeadline: '1788562800',
  } as const;

  it('decodes PermitSingle typed data with amount, expiration, nonce and spender', () => {
    expect(decodePermit2TypedData(typedData)).toMatchObject({
      status: 'COMPLETE',
      effects: [
        {
          kind: 'APPROVAL',
          asset: TOKEN,
          owner: ACCOUNT,
          spender: SPENDER,
          amount: '100',
          expiration: '1788562800',
          nonce: '3',
          signatureDeadline: '1788562800',
        },
      ],
    });
  });

  it('fails closed when PermitSingle exceeds uint160', () => {
    expect(
      decodePermit2TypedData({
        ...typedData,
        details: { ...typedData.details, amount: (1n << 160n).toString() },
      }),
    ).toMatchObject({ status: 'UNKNOWN', effects: [{ kind: 'UNKNOWN' }] });
  });

  it('decodes Permit2 permit calldata', () => {
    const data = encodeFunctionData({
      abi: PERMIT2_ABI,
      functionName: 'permit',
      args: [
        ACCOUNT,
        {
          details: { token: TOKEN, amount: 100n, expiration: 99, nonce: 3 },
          spender: SPENDER,
          sigDeadline: 100n,
        },
        '0x1234',
      ],
    });
    expect(
      decodePermit2Calldata({ chainId: 1, target: PERMIT2, caller: ACCOUNT, data }),
    ).toMatchObject({
      status: 'COMPLETE',
      effects: [{ kind: 'APPROVAL', amount: '100', expiration: '99', nonce: '3' }],
    });
  });

  it('decodes one-shot SignatureTransfer as exposure plus transfer', () => {
    const data = encodeFunctionData({
      abi: PERMIT2_ABI,
      functionName: 'permitTransferFrom',
      args: [
        { permitted: { token: TOKEN, amount: 100n }, nonce: 4n, deadline: 200n },
        { to: RECIPIENT, requestedAmount: 90n },
        ACCOUNT,
        '0x1234',
      ],
    });
    const result = decodePermit2Calldata({
      chainId: 1,
      target: PERMIT2,
      caller: SPENDER,
      data,
    });
    expect(result.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'APPROVAL', amount: '100', nonce: '4' }),
        expect.objectContaining({ kind: 'TRANSFER', amount: '90', to: RECIPIENT }),
      ]),
    );
  });
});

describe('predicted versus observed reconciliation', () => {
  it('ignores provenance and phase when economic effects agree', () => {
    const predicted = decodeErc20Calldata(
      context(
        encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'transfer',
          args: [RECIPIENT, 10n],
        }),
      ),
    ).effects;
    const observed = predicted.map((effect) => ({
      ...effect,
      id: 'receipt',
      phase: 'OBSERVED' as const,
      provenance: { ...effect.provenance, source: 'RECEIPT' as const },
    }));
    expect(comparePredictedAndObserved(predicted, observed)).toEqual([]);
  });

  it('reports recipient or amount drift', () => {
    const predicted = decodeErc20Calldata(
      context(
        encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'transfer',
          args: [RECIPIENT, 10n],
        }),
      ),
    ).effects;
    const observed = predicted.map((effect) =>
      effect.kind === 'TRANSFER' ? { ...effect, amount: '11' } : effect,
    );
    expect(comparePredictedAndObserved(predicted, observed)).toHaveLength(2);
  });
});
