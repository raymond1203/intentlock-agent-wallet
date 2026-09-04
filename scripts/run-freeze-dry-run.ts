import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import { parse } from 'yaml';

import { BenchmarkScenarioSchema, type BenchmarkScenario } from '../src/benchmark/scenario.js';
import { verifyCaseManifest } from '../src/experiments/case-manifest.js';
import { createEvaluationCaseMatrix } from '../src/experiments/case-matrix.js';
import {
  assertFreezeDryRunMachineGate,
  createFreezeDryRunArtifacts,
  freezeDryRunArtifactSources,
  writeFreezeDryRunArtifacts,
} from '../src/experiments/freeze-dry-run.js';
import {
  FROZEN_EVALUATION_CONFIG_PATH,
  FREEZE_REVIEW_CASE_IDS,
} from '../src/experiments/freeze-gates.js';
import { FrozenEvalConfigSchema, sha256Text } from '../src/experiments/protocol.js';

const REVIEW_TEMPLATE_PATH = 'experiments/configs/freeze-review.template.json';
const RESULTS_ROOT = 'experiments/results/freeze-dry-runs';

function argument(name: string): string | undefined {
  return process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
}

function git(repositoryRoot: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repositoryRoot, ...args], { encoding: 'utf8' }).trim();
}

function requireCleanCommittedCandidate(repositoryRoot: string): {
  commit: string;
  tree: string;
} {
  const dirty = git(repositoryRoot, 'status', '--porcelain', '--untracked-files=all');
  if (dirty) {
    throw new Error('freeze dry-run requires a clean committed candidate before any output');
  }
  const commit = git(repositoryRoot, 'rev-parse', '--verify', 'HEAD');
  const tree = git(repositoryRoot, 'rev-parse', 'HEAD^{tree}');
  return { commit, tree };
}

function resolveOutputDirectory(
  repositoryRoot: string,
  candidate: string,
): {
  relativePath: string;
  absolutePath: string;
} {
  if (isAbsolute(candidate)) throw new Error('--out must be a repository-relative directory');
  const slashPath = candidate.replaceAll('\\', '/').replace(/\/$/u, '');
  if (!slashPath || slashPath.split('/').includes('..')) {
    throw new Error('--out must not contain traversal or resolve to an empty path');
  }
  const absolutePath = resolve(repositoryRoot, slashPath);
  const relativePath = relative(repositoryRoot, absolutePath).replaceAll('\\', '/');
  if (
    relativePath === RESULTS_ROOT ||
    !relativePath.startsWith(`${RESULTS_ROOT}/`) ||
    relativePath.split('/').length !== RESULTS_ROOT.split('/').length + 1
  ) {
    throw new Error(`--out must be one new direct child directory under ${RESULTS_ROOT}`);
  }
  return { relativePath, absolutePath };
}

function requireTracked(repositoryRoot: string, paths: readonly string[]): void {
  for (const path of paths) {
    try {
      git(repositoryRoot, 'ls-files', '--error-unmatch', path);
    } catch {
      throw new Error(`freeze dry-run input must be tracked in the candidate commit: ${path}`);
    }
  }
}

async function requireOutputAbsent(path: string): Promise<void> {
  try {
    await access(path, constants.F_OK);
    throw new Error(
      'freeze dry-run output already exists; choose a new append-only --out directory',
    );
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
}

async function baseScenarios(repositoryRoot: string): Promise<BenchmarkScenario[]> {
  const root = resolve(repositoryRoot, 'benchmark/scenarios/base');
  const directories = (await readdir(root)).sort();
  const scenarios: BenchmarkScenario[] = [];
  for (const directory of directories) {
    const directoryPath = resolve(root, directory);
    if (!(await stat(directoryPath)).isDirectory()) continue;
    const files = (await readdir(directoryPath)).filter((file) => file.endsWith('.json')).sort();
    for (const file of files) {
      scenarios.push(
        BenchmarkScenarioSchema.parse(
          JSON.parse(await readFile(resolve(directoryPath, file), 'utf8')),
        ),
      );
    }
  }
  return scenarios;
}

const repositoryRoot = git(resolve('.'), 'rev-parse', '--show-toplevel');
const runId = argument('--run-id');
const outputArgument = argument('--out');
if (!runId || !outputArgument) {
  throw new Error(`usage: --run-id=<unique-id> --out=${RESULTS_ROOT}/<same-unique-id>`);
}
const output = resolveOutputDirectory(repositoryRoot, outputArgument);
if (output.relativePath.split('/').at(-1) !== runId) {
  throw new Error('freeze dry-run --out direct child name must equal --run-id');
}
await requireOutputAbsent(output.absolutePath);
const provenance = requireCleanCommittedCandidate(repositoryRoot);

const configPath = resolve(repositoryRoot, FROZEN_EVALUATION_CONFIG_PATH);
const configSource = await readFile(configPath, 'utf8');
const config = FrozenEvalConfigSchema.parse(parse(configSource));
if (config.status !== 'CANDIDATE_UNFROZEN') {
  throw new Error('freeze dry-run runs only against the pre-freeze CANDIDATE_UNFROZEN commit A');
}
if (
  config.dataset.caseManifest.replaceAll('\\', '/') !== 'experiments/configs/case-manifest.json'
) {
  throw new Error('freeze dry-run requires the canonical case manifest');
}
const caseManifestPath = resolve(repositoryRoot, config.dataset.caseManifest);
const caseManifestSource = await readFile(caseManifestPath, 'utf8');
const reviewTemplatePath = resolve(repositoryRoot, REVIEW_TEMPLATE_PATH);
const reviewTemplateSource = await readFile(reviewTemplatePath, 'utf8');
requireTracked(repositoryRoot, [
  FROZEN_EVALUATION_CONFIG_PATH,
  config.dataset.caseManifest,
  REVIEW_TEMPLATE_PATH,
]);

const matrix = createEvaluationCaseMatrix(await baseScenarios(repositoryRoot));
const caseManifest = verifyCaseManifest(JSON.parse(caseManifestSource), matrix);
const allCases = matrix.entries.map((entry, index) => {
  const scenario = matrix.scenarios[index];
  if (!scenario) throw new Error(`regenerated scenario is absent at index ${String(index)}`);
  return { entry, scenario };
});
const artifacts = await createFreezeDryRunArtifacts({
  runId,
  createdAt: new Date().toISOString(),
  evaluatedAt: config.caseMatrix.evaluatedAt,
  candidateCommit: provenance.commit,
  candidateTree: provenance.tree,
  outputDirectory: output.relativePath,
  configSource,
  caseManifestSource,
  reviewTemplateSource,
  reviewTemplate: JSON.parse(reviewTemplateSource),
  manifestEntries: caseManifest.entries,
  cases: allCases,
});

const beforeWrite = requireCleanCommittedCandidate(repositoryRoot);
if (beforeWrite.commit !== provenance.commit || beforeWrite.tree !== provenance.tree) {
  throw new Error('candidate commit changed while the freeze dry-run was evaluating');
}
await requireOutputAbsent(output.absolutePath);
await writeFreezeDryRunArtifacts(output.absolutePath, artifacts);
const artifactSources = freezeDryRunArtifactSources(artifacts);

let machineGateStatus: 'PASS' | 'BLOCKED' = 'PASS';
let machineGateBlocker: string | undefined;
try {
  assertFreezeDryRunMachineGate(artifacts.summary);
} catch (error) {
  machineGateStatus = 'BLOCKED';
  machineGateBlocker = error instanceof Error ? error.message : 'unknown machine-gate failure';
  process.exitCode = 1;
}

console.log(
  JSON.stringify({
    status:
      machineGateStatus === 'PASS'
        ? 'MACHINE_DRY_RUN_COMPLETE_HUMAN_REVIEW_NOT_PERFORMED'
        : 'MACHINE_DRY_RUN_BLOCKED_HUMAN_REVIEW_MUST_NOT_APPROVE',
    machineGateStatus,
    runId,
    candidateCommit: provenance.commit,
    candidateTree: provenance.tree,
    caseCount: FREEZE_REVIEW_CASE_IDS.length,
    machineMatchCount: artifacts.summary.machineMatchCount,
    machineMismatchCaseIds: artifacts.summary.machineMismatchCaseIds,
    machineFailureCaseIds: artifacts.summary.machineFailureCaseIds,
    outputDirectory: output.relativePath,
    reviewBindingToCopyWithoutChangingHumanFields: {
      outputDirectory: output.relativePath,
      runId,
      candidateCommit: provenance.commit,
      candidateTree: provenance.tree,
      manifestSha256: sha256Text(artifactSources.manifestSource),
      casesJsonlSha256: sha256Text(artifactSources.casesSource),
      summarySha256: sha256Text(artifactSources.summarySource),
    },
    humanApprovalProvided: false,
    ...(machineGateBlocker === undefined ? {} : { machineGateBlocker }),
    next:
      machineGateStatus === 'PASS'
        ? 'A human reviewer must separately copy and complete experiments/configs/freeze-review.template.json; this machine artifact is not approval.'
        : 'Do not approve or freeze. Investigate the immutable evidence, commit a corrected candidate A, and use a new append-only output directory.',
  }),
);
