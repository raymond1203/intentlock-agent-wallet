import { encodeFunctionData, type Address, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  AAVE_V3_ABI,
  ACROSS_V3_ABI,
  CCTP_V1_ABI,
  decodeAaveV3,
  decodeAcrossV3,
  decodeCctpV1,
  type ProtocolDecoderOptions,
} from '../../src/effects/protocol-decoders.js';
import { decodeBatchCalldata } from '../../src/effects/batch-decoder.js';
import type { DecodeContext } from '../../src/effects/types.js';
const A: Address = `0x${'11'.repeat(20)}`;
const B: Address = `0x${'22'.repeat(20)}`;
const T: Address = `0x${'33'.repeat(20)}`;
const U: Address = `0x${'44'.repeat(20)}`;
const P: Address = `0x${'55'.repeat(20)}`;
const options: ProtocolDecoderOptions = {
  bridgeRoutes: [
    {
      sourceChainId: 1,
      destinationChainId: 8453,
      inputToken: T,
      outputToken: U,
      sameUnits: true,
      cctpDomain: 6,
    },
  ],
  lendingReserves: [
    { chainId: 1, pool: P, asset: T, aToken: U, suppliedBalance: '100', debtBalance: '50' },
  ],
};
const context = (data: Hex): DecodeContext => ({ chainId: 1, caller: A, target: P, data });
const across = (
  changes: { message?: Hex; depositor?: Address; output?: bigint; destination?: bigint } = {},
): Hex =>
  encodeFunctionData({
    abi: ACROSS_V3_ABI,
    functionName: 'depositV3',
    args: [
      changes.depositor ?? A,
      B,
      T,
      U,
      100n,
      changes.output ?? 99n,
      changes.destination ?? 8453n,
      A,
      1,
      100,
      0,
      changes.message ?? '0x',
    ],
  });
const cctp = (
  domain = 6,
  recipient: Hex = `0x${B.slice(2).padStart(64, '0')}`,
  amount = 100n,
): Hex =>
  encodeFunctionData({
    abi: CCTP_V1_ABI,
    functionName: 'depositForBurn',
    args: [amount, domain, recipient, T],
  });
const aave = (
  op: 'supply' | 'borrow' | 'repay' | 'withdraw',
  amount = 10n,
  beneficiary = A,
  mode = 2n,
): Hex =>
  op === 'supply'
    ? encodeFunctionData({ abi: AAVE_V3_ABI, functionName: op, args: [T, amount, beneficiary, 0] })
    : op === 'borrow'
      ? encodeFunctionData({
          abi: AAVE_V3_ABI,
          functionName: op,
          args: [T, amount, mode, 0, beneficiary],
        })
      : op === 'repay'
        ? encodeFunctionData({
            abi: AAVE_V3_ABI,
            functionName: op,
            args: [T, amount, mode, beneficiary],
          })
        : encodeFunctionData({
            abi: AAVE_V3_ABI,
            functionName: op,
            args: [T, amount, beneficiary],
          });
describe('source-grounded protocol decoders', () => {
  it('decodes Across with explicit destination token and comparable fee', () => {
    expect(decodeAcrossV3(context(across()), options).effects[0]).toMatchObject({
      kind: 'BRIDGE',
      destinationChainId: 8453,
      destinationAsset: U,
      minAmountOut: '99',
      maxFee: '1',
    });
  });
  it.each([
    { message: '0x1234' as const },
    { depositor: B },
    { output: 101n },
    { output: 0n },
    { destination: 10n },
  ])('rejects unsupported Across context', (change) => {
    expect(decodeAcrossV3(context(across(change)), options).status).toBe('UNKNOWN');
  });
  it('does not decode unknown routes or native deposits as safe token routes', () => {
    expect(decodeAcrossV3(context(across()), {}).status).toBe('UNKNOWN');
    expect(decodeAcrossV3({ ...context(across()), valueWei: '1' }, options).status).toBe('UNKNOWN');
  });
  it('maps CCTP domain 6 to Base rather than treating it as a chain id', () => {
    expect(decodeCctpV1(context(cctp()), options).effects[0]).toMatchObject({
      destinationChainId: 8453,
      recipient: B,
      maxFee: '0',
    });
  });
  it.each([
    cctp(8453),
    cctp(6, `0x${'ab'.repeat(32)}`),
    cctp(6, `0x${'00'.repeat(32)}`),
    cctp(6, undefined, 0n),
  ])('rejects invalid CCTP route/recipient/amount', (data) => {
    expect(decodeCctpV1(context(data), options).status).toBe('UNKNOWN');
  });
  it('requires a mapped CCTP route and zero msg.value', () => {
    expect(decodeCctpV1(context(cctp()), {}).status).toBe('UNKNOWN');
    expect(decodeCctpV1({ ...context(cctp()), valueWei: '1' }, options).status).toBe('UNKNOWN');
  });
  it.each(['supply', 'borrow', 'repay', 'withdraw'] as const)(
    'decodes Aave %s into asset and position/debt effects',
    (op) => {
      const result = decodeAaveV3(context(aave(op)), options);
      expect(result.status).toBe('COMPLETE');
      expect(result.effects).toHaveLength(2);
      expect(result.effects[1]).toMatchObject({
        kind: op === 'borrow' || op === 'repay' ? 'DEBT' : 'POSITION',
        delta: op === 'repay' || op === 'withdraw' ? '-10' : '10',
      });
    },
  );
  it('caps repayments to observed debt and resolves max withdrawal from state', () => {
    expect(decodeAaveV3(context(aave('repay', 100n)), options).effects[1]).toMatchObject({
      delta: '-50',
    });
    expect(
      decodeAaveV3(context(aave('withdraw', (1n << 256n) - 1n)), options).effects[1],
    ).toMatchObject({ delta: '-100' });
  });
  it.each(['borrow', 'repay'] as const)('rejects unsupported interest mode for %s', (op) => {
    expect(decodeAaveV3(context(aave(op, 10n, A, 1n)), options).status).toBe('UNKNOWN');
  });
  it.each(['supply', 'borrow', 'repay'] as const)(
    'fails closed on unmodeled delegation for %s',
    (op) => {
      expect(decodeAaveV3(context(aave(op, 10n, B)), options).status).toBe('UNKNOWN');
    },
  );
  it.each(['repay', 'withdraw'] as const)('requires reserve state for %s', (op) => {
    expect(
      decodeAaveV3(context(aave(op)), {
        lendingReserves: [{ chainId: 1, pool: P, asset: T, aToken: U }],
      }).status,
    ).toBe('UNKNOWN');
  });
  it('rejects unknown reserve, zero amounts, invalid native value and insufficient supply', () => {
    expect(decodeAaveV3(context(aave('supply')), {}).status).toBe('UNKNOWN');
    expect(decodeAaveV3(context(aave('supply', 0n)), options).status).toBe('UNKNOWN');
    expect(decodeAaveV3({ ...context(aave('supply')), valueWei: '1' }, options).status).toBe(
      'UNKNOWN',
    );
    expect(decodeAaveV3(context(aave('withdraw', 101n)), options).status).toBe('UNKNOWN');
  });
  it.each([decodeAaveV3, decodeAcrossV3, decodeCctpV1])(
    'fails closed on malformed calldata',
    (decode) => {
      expect(decode(context('0xdeadbeef'), options).status).toBe('UNKNOWN');
    },
  );
  it.each([
    ['ACROSS_V3', across()],
    ['CCTP_V1', cctp()],
    ['AAVE_V3', aave('supply')],
  ] as const)('routes %s through the shared batch decoder', (kind, data) => {
    expect(
      decodeBatchCalldata(context(data), { ...options, contracts: { [P]: { kind } } }).status,
    ).toBe('COMPLETE');
    expect(
      decodeBatchCalldata(context('0xdeadbeef'), { ...options, contracts: { [P]: { kind } } })
        .status,
    ).toBe('UNKNOWN');
  });
});
