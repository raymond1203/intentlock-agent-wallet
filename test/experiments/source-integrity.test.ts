import { describe, expect, it } from 'vitest';

import {
  assertCleanSourceAtStart,
  assertCleanSourceUnchanged,
  type GitSourceState,
} from '../../scripts/source-integrity.js';

const clean: GitSourceState = {
  commitSha: 'a'.repeat(40),
  workingTreeDirty: false,
};

describe('final evidence source integrity', () => {
  it('accepts a clean source that stays on the same commit', () => {
    expect(() => {
      assertCleanSourceAtStart(clean, 'test evidence');
    }).not.toThrow();
    expect(() => {
      assertCleanSourceUnchanged(clean, clean, 'test evidence');
    }).not.toThrow();
  });

  it('rejects a dirty source before an external evidence run starts', () => {
    expect(() => {
      assertCleanSourceAtStart({ ...clean, workingTreeDirty: true }, 'test evidence');
    }).toThrow('requires a clean committed source tree');
  });

  it('rejects source mutations and commit changes during a run', () => {
    expect(() => {
      assertCleanSourceUnchanged(clean, { ...clean, workingTreeDirty: true }, 'test evidence');
    }).toThrow('became dirty during execution');
    expect(() => {
      assertCleanSourceUnchanged(
        clean,
        { commitSha: 'b'.repeat(40), workingTreeDirty: false },
        'test evidence',
      );
    }).toThrow('source commit changed during execution');
  });
});
