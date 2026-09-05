import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { parse } from 'yaml';

import { BenchmarkScenarioSchema, type BenchmarkScenario } from '../src/benchmark/scenario.js';
import { verifyCaseManifest } from '../src/experiments/case-manifest.js';
import { createEvaluationCaseMatrix } from '../src/experiments/case-matrix.js';
import { validateFreezeDryRunReviewEvidence } from '../src/experiments/freeze-dry-run.js';
import {
  AcceptedFreezeReviewRecordSchema,
  FREEZE_REVIEW_CASE_IDS,
  validateFreezeReviewForProtocol,
  type AcceptedFreezeReviewRecord,
} from '../src/experiments/freeze-gates.js';
import { FrozenEvalConfigSchema } from '../src/experiments/protocol.js';

const EVALUATION_CONFIG_PATH = 'experiments/configs/frozen-eval.yaml';
const CASE_MANIFEST_PATH = 'experiments/configs/case-manifest.json';
const REVIEW_TEMPLATE_PATH = 'experiments/configs/freeze-review.template.json';

function git(repositoryRoot: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repositoryRoot, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function committedSource(repositoryRoot: string, commit: string, path: string): string {
  return git(repositoryRoot, 'show', `${commit}:${path}`);
}

function dryRunArtifactPaths(review: AcceptedFreezeReviewRecord): [string, string, string] {
  const root = review.dryRunEvidence.outputDirectory;
  return [`${root}/manifest.json`, `${root}/cases.jsonl`, `${root}/summary.json`];
}

export function candidateBaseScenarios(
  repositoryRoot: string,
  commit: string,
): BenchmarkScenario[] {
  const paths = git(
    repositoryRoot,
    'ls-tree',
    '-r',
    '--name-only',
    commit,
    '--',
    'benchmark/scenarios/base',
  )
    .split(/\r?\n/u)
    // Match the runner's one-workflow-directory layout; root coverage.json is metadata.
    .filter((path) => /^benchmark\/scenarios\/base\/[^/]+\/[^/]+\.json$/u.test(path))
    .sort();
  if (paths.length !== 80) {
    throw new Error(
      `freeze review requires 80 candidate base scenarios, found ${String(paths.length)}`,
    );
  }
  return paths.map((path) =>
    BenchmarkScenarioSchema.parse(JSON.parse(committedSource(repositoryRoot, commit, path))),
  );
}

export function freezeReviewDryRunArtifactPaths(reviewInput: unknown): [string, string, string] {
  return dryRunArtifactPaths(AcceptedFreezeReviewRecordSchema.parse(reviewInput));
}

export async function validateFreezeReviewEvidenceFromRepository(options: {
  repositoryRoot: string;
  reviewInput: unknown;
  reviewedCommit: string;
  requireTrackedArtifacts: boolean;
}): Promise<{
  review: AcceptedFreezeReviewRecord;
  artifactPaths: [string, string, string];
}> {
  const candidateTree = git(
    options.repositoryRoot,
    'rev-parse',
    `${options.reviewedCommit}^{tree}`,
  ).trim();
  const evaluationConfigSource = committedSource(
    options.repositoryRoot,
    options.reviewedCommit,
    EVALUATION_CONFIG_PATH,
  );
  const candidateConfig = FrozenEvalConfigSchema.parse(parse(evaluationConfigSource));
  const review = validateFreezeReviewForProtocol(
    options.reviewInput,
    options.reviewedCommit,
    candidateTree,
    candidateConfig.reviewProtocol?.mode ?? 'INDEPENDENT_HUMAN',
  );
  const artifactPaths = dryRunArtifactPaths(review);
  const artifactSources = await Promise.all(
    artifactPaths.map(async (path) => {
      if (options.requireTrackedArtifacts) {
        try {
          git(options.repositoryRoot, 'ls-files', '--error-unmatch', '--', path);
        } catch {
          throw new Error(`frozen dry-run artifact is not tracked: ${path}`);
        }
        return committedSource(options.repositoryRoot, 'HEAD', path);
      }
      return readFile(resolve(options.repositoryRoot, path), 'utf8');
    }),
  );
  const caseManifestSource = committedSource(
    options.repositoryRoot,
    options.reviewedCommit,
    CASE_MANIFEST_PATH,
  );
  const reviewTemplateSource = committedSource(
    options.repositoryRoot,
    options.reviewedCommit,
    REVIEW_TEMPLATE_PATH,
  );
  const matrix = createEvaluationCaseMatrix(
    candidateBaseScenarios(options.repositoryRoot, options.reviewedCommit),
  );
  const manifest = verifyCaseManifest(JSON.parse(caseManifestSource), matrix);
  const byId = new Map(
    manifest.entries.map((entry, index) => [
      entry.caseId,
      { entry, scenario: matrix.scenarios[index] },
    ]),
  );
  const expectedCases = FREEZE_REVIEW_CASE_IDS.map((caseId) => {
    const expected = byId.get(caseId);
    if (!expected?.scenario) throw new Error(`candidate freeze case is absent: ${caseId}`);
    return { entry: expected.entry, scenario: expected.scenario };
  });
  const [manifestSource, casesSource, summarySource] = artifactSources;
  if (manifestSource === undefined || casesSource === undefined || summarySource === undefined) {
    throw new Error('freeze dry-run artifact set is incomplete');
  }
  validateFreezeDryRunReviewEvidence(review, {
    manifestSource,
    casesSource,
    summarySource,
    evaluationConfigSource,
    caseManifestSource,
    reviewTemplateSource,
    expectedCandidateCommit: options.reviewedCommit,
    expectedCandidateTree: candidateTree,
    expectedCases,
  });
  return { review, artifactPaths };
}
