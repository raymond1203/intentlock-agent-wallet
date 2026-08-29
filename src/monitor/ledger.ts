import type { ReservationAmounts, ReservationLimits, ReservationRequest } from './reservation.js';

export type ReservationStatus = 'PENDING' | 'EXECUTED' | 'VIOLATED' | 'FAILED' | 'CANCELED';

export interface ReservationRecord extends ReservationRequest {
  reservationId: string;
  status: ReservationStatus;
  settledAt?: string;
}

export type ReserveResult =
  | { kind: 'RESERVED'; reservation: ReservationRecord; revision: number }
  | { kind: 'DUPLICATE'; reservation: ReservationRecord; revision: number }
  | {
      kind: 'REJECTED';
      code: 'IDEMPOTENCY_CONFLICT' | 'NONCE_CONFLICT' | 'BUDGET_EXCEEDED';
      reason: string;
      revision: number;
    };

export interface LedgerSnapshot {
  version: '0.1';
  revision: number;
  reservations: ReservationRecord[];
}

function cloneRecord(record: ReservationRecord): ReservationRecord {
  return structuredClone(record);
}

function addRecords(target: Map<string, bigint>, values: Record<string, string>): void {
  for (const [key, amount] of Object.entries(values)) {
    target.set(key, (target.get(key) ?? 0n) + BigInt(amount));
  }
}

function relevantAmounts(
  records: readonly ReservationRecord[],
  intentHash: string,
): ReservationAmounts {
  const grossOutflow = new Map<string, bigint>();
  const allowanceExposure = new Map<string, bigint>();
  let gasWei = 0n;
  for (const record of records) {
    if (record.intentHash !== intentHash) continue;
    if (
      record.status === 'PENDING' ||
      record.status === 'EXECUTED' ||
      record.status === 'VIOLATED'
    ) {
      addRecords(grossOutflow, record.amounts.grossOutflow);
      addRecords(allowanceExposure, record.amounts.allowanceExposure);
      gasWei += BigInt(record.amounts.gasWei);
    } else if (record.status === 'FAILED') {
      gasWei += BigInt(record.amounts.gasWei);
    }
  }
  return {
    grossOutflow: Object.fromEntries(
      [...grossOutflow].map(([key, amount]) => [key, amount.toString()]),
    ),
    allowanceExposure: Object.fromEntries(
      [...allowanceExposure].map(([key, amount]) => [key, amount.toString()]),
    ),
    gasWei: gasWei.toString(),
  };
}

function firstExceeded(
  used: ReservationAmounts,
  candidate: ReservationAmounts,
  limits: ReservationLimits,
): string | undefined {
  for (const [key, amount] of Object.entries(candidate.grossOutflow)) {
    const total = BigInt(used.grossOutflow[key] ?? '0') + BigInt(amount);
    if (total > BigInt(limits.grossOutflow[key] ?? '0')) return `grossOutflow:${key}`;
  }
  for (const [key, amount] of Object.entries(candidate.allowanceExposure)) {
    const total = BigInt(used.allowanceExposure[key] ?? '0') + BigInt(amount);
    if (total > BigInt(limits.allowanceExposure[key] ?? '0')) {
      return `allowanceExposure:${key}`;
    }
  }
  if (BigInt(used.gasWei) + BigInt(candidate.gasWei) > BigInt(limits.gasWei)) return 'gasWei';
  return undefined;
}

export class InMemoryIntentLedger {
  private readonly reservations = new Map<string, ReservationRecord>();
  private readonly idempotency = new Map<string, string>();
  private readonly nonces = new Map<string, string>();
  private revision = 0;
  private gate: Promise<void> = Promise.resolve();

  public constructor(snapshot?: LedgerSnapshot) {
    if (!snapshot) return;
    const snapshotVersion: unknown = snapshot.version;
    if (snapshotVersion !== '0.1' || !Number.isSafeInteger(snapshot.revision)) {
      throw new Error('invalid ledger snapshot');
    }
    this.revision = snapshot.revision;
    for (const record of snapshot.reservations) {
      const cloned = cloneRecord(record);
      this.reservations.set(cloned.reservationId, cloned);
      this.idempotency.set(cloned.idempotencyKey, cloned.reservationId);
      this.nonces.set(`${cloned.account.toLowerCase()}:${cloned.nonce}`, cloned.intentHash);
    }
  }

  private async atomic<T>(operation: () => T): Promise<T> {
    const previous = this.gate;
    let release = (): void => undefined;
    this.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return operation();
    } finally {
      release();
    }
  }

  public async reserve(request: ReservationRequest): Promise<ReserveResult> {
    return this.atomic(() => {
      const existingId = this.idempotency.get(request.idempotencyKey);
      if (existingId) {
        const existing = this.reservations.get(existingId);
        if (!existing) throw new Error('idempotency index references a missing reservation');
        if (existing.intentHash === request.intentHash) {
          return { kind: 'DUPLICATE', reservation: cloneRecord(existing), revision: this.revision };
        }
        return {
          kind: 'REJECTED',
          code: 'IDEMPOTENCY_CONFLICT',
          reason: 'idempotency key already belongs to a different intent',
          revision: this.revision,
        };
      }

      const nonceKey = `${request.account.toLowerCase()}:${request.nonce}`;
      const nonceIntent = this.nonces.get(nonceKey);
      if (nonceIntent && nonceIntent !== request.intentHash) {
        return {
          kind: 'REJECTED',
          code: 'NONCE_CONFLICT',
          reason: 'account nonce already belongs to a different intent',
          revision: this.revision,
        };
      }

      const exceeded = firstExceeded(
        relevantAmounts([...this.reservations.values()], request.intentHash),
        request.amounts,
        request.limits,
      );
      if (exceeded) {
        return {
          kind: 'REJECTED',
          code: 'BUDGET_EXCEEDED',
          reason: `${exceeded} exceeds the intent limit`,
          revision: this.revision,
        };
      }

      this.revision += 1;
      const reservation: ReservationRecord = {
        ...structuredClone(request),
        reservationId: `r-${this.revision.toString().padStart(6, '0')}`,
        status: 'PENDING',
      };
      this.reservations.set(reservation.reservationId, reservation);
      this.idempotency.set(reservation.idempotencyKey, reservation.reservationId);
      this.nonces.set(nonceKey, reservation.intentHash);
      return { kind: 'RESERVED', reservation: cloneRecord(reservation), revision: this.revision };
    });
  }

  public async settleExecuted(
    reservationId: string,
    observedAmounts: ReservationAmounts,
    settledAt: string,
  ): Promise<ReservationRecord> {
    return this.atomic(() => {
      const record = this.pending(reservationId);
      const exceeded = firstExceeded(
        { grossOutflow: {}, allowanceExposure: {}, gasWei: '0' },
        observedAmounts,
        record.amounts,
      );
      if (exceeded) throw new Error(`observed effect exceeds reservation: ${exceeded}`);
      record.amounts = structuredClone(observedAmounts);
      record.status = 'EXECUTED';
      record.settledAt = settledAt;
      this.revision += 1;
      return cloneRecord(record);
    });
  }

  public async settleFailed(
    reservationId: string,
    gasUsedWei: string,
    settledAt: string,
  ): Promise<ReservationRecord> {
    return this.atomic(() => {
      const record = this.pending(reservationId);
      if (BigInt(gasUsedWei) > BigInt(record.amounts.gasWei)) {
        throw new Error('observed gas exceeds reservation');
      }
      record.amounts = { grossOutflow: {}, allowanceExposure: {}, gasWei: gasUsedWei };
      record.status = 'FAILED';
      record.settledAt = settledAt;
      this.revision += 1;
      return cloneRecord(record);
    });
  }

  /** Records effects that occurred but exceeded or differed from the reservation. */
  public async settleViolated(
    reservationId: string,
    observedAmounts: ReservationAmounts,
    settledAt: string,
  ): Promise<ReservationRecord> {
    return this.atomic(() => {
      const record = this.pending(reservationId);
      record.amounts = structuredClone(observedAmounts);
      record.status = 'VIOLATED';
      record.settledAt = settledAt;
      this.revision += 1;
      return cloneRecord(record);
    });
  }

  public async cancel(reservationId: string, settledAt: string): Promise<ReservationRecord> {
    return this.atomic(() => {
      const record = this.pending(reservationId);
      record.amounts = { grossOutflow: {}, allowanceExposure: {}, gasWei: '0' };
      record.status = 'CANCELED';
      record.settledAt = settledAt;
      this.revision += 1;
      return cloneRecord(record);
    });
  }

  private pending(reservationId: string): ReservationRecord {
    const record = this.reservations.get(reservationId);
    if (!record) throw new Error(`unknown reservation: ${reservationId}`);
    if (record.status !== 'PENDING') throw new Error(`reservation is already ${record.status}`);
    return record;
  }

  public snapshot(): LedgerSnapshot {
    return {
      version: '0.1',
      revision: this.revision,
      reservations: [...this.reservations.values()]
        .sort((left, right) => left.reservationId.localeCompare(right.reservationId))
        .map(cloneRecord),
    };
  }
}
