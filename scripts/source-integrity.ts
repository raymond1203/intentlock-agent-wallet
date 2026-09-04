import { execFileSync } from 'node:child_process';

export interface GitSourceState {
  commitSha: string;
  workingTreeDirty: boolean;
}

export function readGitSourceState(cwd = process.cwd()): GitSourceState {
  const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd,
    encoding: 'utf8',
  }).trim();
  if (!/^[a-f0-9]{40}$/.test(commitSha)) {
    throw new Error('Git HEAD did not resolve to a full commit SHA');
  }
  return {
    commitSha,
    workingTreeDirty:
      execFileSync('git', ['status', '--porcelain'], {
        cwd,
        encoding: 'utf8',
      }).trim().length > 0,
  };
}

export function assertCleanSourceAtStart(state: GitSourceState, label: string): void {
  if (state.workingTreeDirty) {
    throw new Error(`${label} requires a clean committed source tree`);
  }
}

export function assertCleanSourceUnchanged(
  started: GitSourceState,
  completed: GitSourceState,
  label: string,
): void {
  if (completed.workingTreeDirty) {
    throw new Error(`${label} source tree became dirty during execution`);
  }
  if (completed.commitSha !== started.commitSha) {
    throw new Error(`${label} source commit changed during execution`);
  }
}
