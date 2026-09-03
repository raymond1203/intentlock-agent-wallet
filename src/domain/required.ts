/** Reject absent evidence instead of asserting away its type. */
export function required<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error('Required fixture value is missing');
  return value;
}
