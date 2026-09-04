export const M2_ATTEMPT_SELECTION_POLICY =
  'For each scenario, select the first complete listed attempt; if none completes, select the last listed failure. Retain all attempts in chronological order.';

/**
 * Attempts must be supplied oldest to newest. A first complete result is sticky; until then, each
 * newer failure replaces the prior failure so a never-complete scenario reports its latest state.
 */
export function selectFirstCompleteOrLatest<T>(
  attempts: readonly T[],
  scenarioId: (attempt: T) => string,
  isComplete: (attempt: T) => boolean,
): Map<string, T> {
  const selected = new Map<string, T>();
  const completed = new Set<string>();
  for (const attempt of attempts) {
    const id = scenarioId(attempt);
    if (completed.has(id)) continue;
    selected.set(id, attempt);
    if (isComplete(attempt)) completed.add(id);
  }
  return selected;
}
