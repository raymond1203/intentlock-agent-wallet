import { describe, expect, it } from 'vitest';

import {
  M2_ATTEMPT_SELECTION_POLICY,
  selectFirstCompleteOrLatest,
} from '../../scripts/m2-execution/attempt-selection.js';

interface Attempt {
  scenarioId: string;
  run: string;
  complete: boolean;
}

describe('M2 chronological attempt selection', () => {
  it('keeps the first complete attempt and otherwise selects the latest failure', () => {
    const attempts: Attempt[] = [
      { scenarioId: 'A', run: 'a-failure-1', complete: false },
      { scenarioId: 'B', run: 'b-failure-1', complete: false },
      { scenarioId: 'A', run: 'a-success-1', complete: true },
      { scenarioId: 'A', run: 'a-failure-after-success', complete: false },
      { scenarioId: 'B', run: 'b-failure-2', complete: false },
      { scenarioId: 'A', run: 'a-success-2', complete: true },
      { scenarioId: 'C', run: 'c-success-1', complete: true },
    ];
    const selected = selectFirstCompleteOrLatest(
      attempts,
      (attempt) => attempt.scenarioId,
      (attempt) => attempt.complete,
    );
    expect(selected.get('A')?.run).toBe('a-success-1');
    expect(selected.get('B')?.run).toBe('b-failure-2');
    expect(selected.get('C')?.run).toBe('c-success-1');
    expect(attempts).toHaveLength(7);
  });

  it('publishes the exact chronological failure policy', () => {
    expect(M2_ATTEMPT_SELECTION_POLICY).toContain('first complete listed attempt');
    expect(M2_ATTEMPT_SELECTION_POLICY).toContain('last listed failure');
    expect(M2_ATTEMPT_SELECTION_POLICY).toContain('chronological order');
  });
});
