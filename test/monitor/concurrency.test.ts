import { describe, expect, it } from 'vitest';

import type { ReservationRequest } from '../../src/monitor/reservation.js';
import { InMemoryIntentLedger } from '../../src/monitor/ledger.js';

const HASH_A = `0x${'a'.repeat(64)}` as const;
const HASH_B = `0x${'b'.repeat(64)}` as const;
const ACCOUNT = '0x1111111111111111111111111111111111111111';
const ASSET_KEY = '1:0x4444444444444444444444444444444444444444';

function request(
  idempotencyKey: string,
  amount: string,
  options: {
    intentHash?: `0x${string}`;
    nonce?: string;
    gasWei?: string;
    allowance?: string;
  } = {},
): ReservationRequest {
  return {
    intentHash: options.intentHash ?? HASH_A,
    account: ACCOUNT,
    nonce: options.nonce ?? '1',
    idempotencyKey,
    decisionLogId: `decision-${idempotencyKey}`,
    amounts: {
      grossOutflow: { [ASSET_KEY]: amount },
      allowanceExposure: { [ASSET_KEY]: options.allowance ?? '0' },
      gasWei: options.gasWei ?? '0',
    },
    limits: {
      grossOutflow: { [ASSET_KEY]: '100' },
      allowanceExposure: { [ASSET_KEY]: '100' },
      gasWei: '100',
    },
    createdAt: '2026-08-29T00:00:00Z',
  };
}

async function reservationId(
  ledger: InMemoryIntentLedger,
  value: ReservationRequest,
): Promise<string> {
  const result = await ledger.reserve(value);
  expect(result.kind).toBe('RESERVED');
  if (result.kind !== 'RESERVED') throw new Error('expected reservation');
  return result.reservation.reservationId;
}

describe('atomic cumulative intent ledger', () => {
  it.each([
    ['a-first', request('a', '60'), request('b', '60')],
    ['b-first', request('b', '60'), request('a', '60')],
  ])('prevents double-spending the same remaining budget: %s', async (_name, first, second) => {
    const ledger = new InMemoryIntentLedger();
    const results = await Promise.all([ledger.reserve(first), ledger.reserve(second)]);
    expect(results.map((result) => result.kind).sort()).toEqual(['REJECTED', 'RESERVED']);
    expect(results.find((result) => result.kind === 'REJECTED')).toMatchObject({
      code: 'BUDGET_EXCEEDED',
    });
  });

  it('returns one reservation for concurrent retries of the same idempotency key', async () => {
    const ledger = new InMemoryIntentLedger();
    const retry = request('same-request', '10');
    const results = await Promise.all([ledger.reserve(retry), ledger.reserve(retry)]);
    expect(results.map((result) => result.kind).sort()).toEqual(['DUPLICATE', 'RESERVED']);
    const ids = results.flatMap((result) =>
      result.kind === 'REJECTED' ? [] : [result.reservation.reservationId],
    );
    expect(new Set(ids).size).toBe(1);
  });

  it('rejects idempotency key reuse by a different intent', async () => {
    const ledger = new InMemoryIntentLedger();
    await ledger.reserve(request('same', '10'));
    await expect(
      ledger.reserve(request('same', '10', { intentHash: HASH_B, nonce: '2' })),
    ).resolves.toMatchObject({ kind: 'REJECTED', code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('rejects account nonce reuse by a different intent', async () => {
    const ledger = new InMemoryIntentLedger();
    await ledger.reserve(request('first', '10'));
    await expect(
      ledger.reserve(request('second', '10', { intentHash: HASH_B })),
    ).resolves.toMatchObject({ kind: 'REJECTED', code: 'NONCE_CONFLICT' });
  });

  it('releases economic effects after a failed receipt but accounts for used gas', async () => {
    const ledger = new InMemoryIntentLedger();
    const id = await reservationId(ledger, request('failed', '90', { gasWei: '10' }));
    await ledger.settleFailed(id, '5', '2026-08-29T00:01:00Z');
    await expect(
      ledger.reserve(request('after-failure', '100', { gasWei: '95' })),
    ).resolves.toMatchObject({ kind: 'RESERVED' });
  });

  it('releases all amounts after cancellation', async () => {
    const ledger = new InMemoryIntentLedger();
    const id = await reservationId(ledger, request('cancel', '100'));
    await ledger.cancel(id, '2026-08-29T00:01:00Z');
    await expect(ledger.reserve(request('after-cancel', '100'))).resolves.toMatchObject({
      kind: 'RESERVED',
    });
  });

  it('rejects a receipt whose observed effect exceeds the reservation', async () => {
    const ledger = new InMemoryIntentLedger();
    const id = await reservationId(ledger, request('execute', '10', { gasWei: '10' }));
    await expect(
      ledger.settleExecuted(
        id,
        {
          grossOutflow: { [ASSET_KEY]: '11' },
          allowanceExposure: {},
          gasWei: '10',
        },
        '2026-08-29T00:01:00Z',
      ),
    ).rejects.toThrow('observed effect exceeds reservation');
  });

  it('persists decision-log links and restores an identical snapshot', async () => {
    const ledger = new InMemoryIntentLedger();
    const id = await reservationId(ledger, request('persisted', '10'));
    await ledger.settleExecuted(
      id,
      { grossOutflow: { [ASSET_KEY]: '9' }, allowanceExposure: {}, gasWei: '0' },
      '2026-08-29T00:01:00Z',
    );
    const snapshot = ledger.snapshot();
    expect(snapshot.reservations[0]).toMatchObject({
      decisionLogId: 'decision-persisted',
      status: 'EXECUTED',
    });
    expect(new InMemoryIntentLedger(snapshot).snapshot()).toEqual(snapshot);
  });

  it('rejects settlement of an already terminal reservation', async () => {
    const ledger = new InMemoryIntentLedger();
    const id = await reservationId(ledger, request('terminal', '10'));
    await ledger.cancel(id, '2026-08-29T00:01:00Z');
    await expect(ledger.cancel(id, '2026-08-29T00:02:00Z')).rejects.toThrow(
      'reservation is already CANCELED',
    );
  });
});
