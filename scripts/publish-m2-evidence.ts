import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { BenchmarkScenarioSchema, type BenchmarkScenario } from '../src/benchmark/scenario.js';
import { BENCHMARK_DATASET_VERSION } from '../src/benchmark/version.js';
import {
  M2PublishedEvidenceSchema,
  M2RawExecutionEvidenceSchema,
  canonicalM2RawEvidencePath,
  executionProblems as validateExecution,
  publicM2Failure,
  validatePublishedM2Evidence,
  type M2RawExecutionEvidence,
} from './m2-execution/evidence-validation.js';
import {
  M2_ATTEMPT_SELECTION_POLICY,
  selectFirstCompleteOrLatest,
} from './m2-execution/attempt-selection.js';
import { executionCollectorSha256 } from './m2-execution/provenance.js';
import { persistM2RawEvidenceBundles } from './m2-execution/raw-bundle.js';

const dirs = process.argv
  .find((v) => v.startsWith('--runs='))
  ?.slice(7)
  .split(',');
if (!dirs?.length)
  throw new Error('--runs=path[,path] is required; list attempts in chronological order');
const out =
  process.argv.find((v) => v.startsWith('--out='))?.slice(6) ??
  `benchmark/evidence/m2-execution-v${BENCHMARK_DATASET_VERSION}.json`;
const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const current = new Map<string, string>();
const currentScenarios = new Map<string, BenchmarkScenario>();
for (const dir of ['transfer', 'swap', 'bridge', 'lending', 'batch'])
  for (const file of (await readdir(`benchmark/scenarios/base/${dir}`)).filter((f) =>
    f.endsWith('.json'),
  )) {
    const s = BenchmarkScenarioSchema.parse(
      JSON.parse(await readFile(`benchmark/scenarios/base/${dir}/${file}`, 'utf8')),
    );
    current.set(s.id, sha256(JSON.stringify(s)));
    currentScenarios.set(s.id, s);
  }
type Published = M2RawExecutionEvidence & {
  run: string;
  rawFilePath: string;
  rawFileSha256: string;
};

const attempts: Published[] = [];
const rawBytesByPath = new Map<string, Uint8Array>();
for (const dir of dirs) {
  for (const file of (await readdir(dir)).filter((f) => /^[a-z]{2}-\d\d\.json$/.test(f)).sort()) {
    const bytes = await readFile(`${dir}/${file}`);
    const raw = M2RawExecutionEvidenceSchema.parse(JSON.parse(bytes.toString('utf8')));
    if (raw.sourceScenarioSha256 !== current.get(raw.scenarioId))
      throw new Error(`stale scenario evidence: ${raw.scenarioId}`);
    const rawFileSha256 = sha256(bytes);
    const rawFilePath = canonicalM2RawEvidencePath(rawFileSha256);
    const existingBytes = rawBytesByPath.get(rawFilePath);
    if (existingBytes && !Buffer.from(existingBytes).equals(bytes)) {
      throw new Error(`content-addressed raw evidence collision: ${rawFilePath}`);
    }
    rawBytesByPath.set(rawFilePath, bytes);
    attempts.push({
      ...raw,
      run: dir.replaceAll('\\', '/').split('/').at(-1) ?? dir,
      rawFilePath,
      rawFileSha256,
    });
  }
}
type FixtureCorrection = Published['fixtureCorrections'][number];
function corrections(a: Published): FixtureCorrection[] {
  return a.fixtureCorrections;
}

function executionProblems(a: Published): string[] {
  const scenario = currentScenarios.get(a.scenarioId);
  return scenario ? validateExecution(a, scenario) : ['scenario:unknown'];
}

const selectionByScenario = selectFirstCompleteOrLatest(
  attempts,
  (attempt) => attempt.scenarioId,
  (attempt) => executionProblems(attempt).length === 0,
);
const selected = [...selectionByScenario.values()].sort((a, b) =>
  a.scenarioId.localeCompare(b.scenarioId),
);
const missing = [...current.keys()].filter((id) => !selectionByScenario.has(id));

function compactAttempt(a: Published) {
  const fixtureCorrections = corrections(a);
  const compactOracle = (oracle: Published['oracle']) => ({
    status: oracle.status,
    violations: oracle.violations,
    missing: oracle.missing,
    disagreements: oracle.disagreements,
  });
  return {
    datasetVersion: a.datasetVersion,
    scenarioId: a.scenarioId,
    run: a.run,
    rawFilePath: a.rawFilePath,
    rawFileSha256: a.rawFileSha256,
    sourceCommit: a.sourceCommit,
    workingTreeDirty: a.workingTreeDirty,
    collectorSha256: a.collectorSha256,
    sourceScenarioSha256: a.sourceScenarioSha256,
    verifiedForks: a.verifiedForks,
    setupNotes: a.setupNotes,
    fixtureCorrections,
    fixtureCorrected: fixtureCorrections.length > 0,
    requiredReceiptCount: a.requiredReceiptCount,
    receipts: a.transactions.map((tx) => ({
      sequence: tx.sequence,
      role: tx.role,
      chainId: tx.chainId,
      from: tx.from,
      to: tx.to,
      transactionHash: tx.transactionHash,
      status: tx.status,
      gasCostWei: tx.gasCostWei,
      blockNumber: tx.receipt.blockNumber,
      blockHash: tx.receipt.blockHash,
      gasUsed: tx.receipt.gasUsed,
    })),
    pre: a.pre,
    post: a.post,
    quotes: a.quotes.map(({ path, ...quote }) => {
      void path;
      return quote;
    }),
    oracle: compactOracle(a.oracle),
    referenceReconciliation: a.referenceReconciliation
      ? compactOracle(a.referenceReconciliation)
      : null,
    executionComplete: executionProblems(a).length === 0,
    incompletenessReasons: executionProblems(a),
    failure: publicM2Failure(a.error),
  };
}
const completed = selected.filter((attempt) => executionProblems(attempt).length === 0);
const strictAuthoredFixture = completed.filter((attempt) => corrections(attempt).length === 0);
const evidence = M2PublishedEvidenceSchema.parse({
  datasetVersion: BENCHMARK_DATASET_VERSION,
  purpose: 'Diagnostic evidence, not a frozen performance result',
  selection: M2_ATTEMPT_SELECTION_POLICY,
  baseCount: current.size,
  attemptedCount: selectionByScenario.size,
  missing,
  completedExecutionCount: completed.length,
  strictAuthoredFixtureExecutionCount: strictAuthoredFixture.length,
  finalGoalPassCount: completed.filter((a) => a.oracle.status === 'PASS').length,
  strictAuthoredFixtureFinalGoalPassCount: strictAuthoredFixture.filter(
    (a) => a.oracle.status === 'PASS',
  ).length,
  syntheticReferenceCheckedCount: selected.filter((a) => a.referenceReconciliation !== null).length,
  syntheticReferenceDisagreementCount: selected.filter(
    (a) => a.referenceReconciliation?.status === 'DISAGREEMENT',
  ).length,
  humanReview: 'PENDING',
  m2Complete: false,
  latest: selected.map((a) => ({
    datasetVersion: a.datasetVersion,
    scenarioId: a.scenarioId,
    run: a.run,
    rawFilePath: a.rawFilePath,
    rawFileSha256: a.rawFileSha256,
    executionComplete: executionProblems(a).length === 0,
    fixtureCorrected: corrections(a).length > 0,
    oracleStatus: a.oracle.status,
  })),
  attempts: attempts.map(compactAttempt),
});
const currentCollectorSha256 = await executionCollectorSha256();
function sourceCommitResolves(commit: string): boolean {
  try {
    execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
function sourceCommitIsAncestor(commit: string): boolean {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
validatePublishedM2Evidence(evidence, {
  scenarios: [...currentScenarios.values()],
  currentCollectorSha256,
  sourceCommitResolves,
  sourceCommitIsAncestor,
  readRawEvidenceBytes: (path) => {
    const bytes = rawBytesByPath.get(path);
    if (!bytes) throw new Error(`publisher did not retain raw bytes: ${path}`);
    return bytes;
  },
  rawEvidenceSource: 'WORKTREE_PUBLISH',
});
await persistM2RawEvidenceBundles(rawBytesByPath);
await mkdir(dirname(out), { recursive: true });
await writeFile(
  out,
  await format(JSON.stringify(evidence), {
    ...(await resolveConfig('package.json')),
    parser: 'json',
  }),
);
console.log(
  JSON.stringify(
    {
      attempted: evidence.attemptedCount,
      executed: evidence.completedExecutionCount,
      finalGoalPass: evidence.finalGoalPassCount,
      referenceChecked: evidence.syntheticReferenceCheckedCount,
      referenceDisagreements: evidence.syntheticReferenceDisagreementCount,
      missing,
    },
    null,
    2,
  ),
);
if (
  process.argv.includes('--require-all-executed') &&
  (missing.length || evidence.completedExecutionCount !== current.size)
)
  process.exitCode = 1;
