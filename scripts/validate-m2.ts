import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { z } from 'zod';
import { BenchmarkScenarioSchema, type BenchmarkScenario } from '../src/benchmark/scenario.js';
import { scoreDecision } from '../src/benchmark/scoring.js';
import { redactScenarioIdentity } from '../src/baselines/llm-verifier.js';
import { evaluateGuardMode } from '../src/baselines/guard-mode-emulator.js';
import { evaluatePerCallPolicy } from '../src/baselines/per-call-policy.js';
import { evaluateIntent } from '../src/monitor/monitor.js';
import { evaluatePostState } from '../src/oracle/post-state-oracle.js';
import { executionCollectorSha256 } from './m2-execution/provenance.js';
import { classifyExecutionEvidence } from './m2-execution/evidence-validation.js';

const check = process.argv.includes('--check');
async function load(dir: string): Promise<BenchmarkScenario[]> {
  const files = (await readdir(dir))
    .filter((f) => f.endsWith('.json') && f !== 'coverage.json')
    .sort();
  return Promise.all(
    files.map(async (file) =>
      BenchmarkScenarioSchema.parse(JSON.parse(await readFile(`${dir}/${file}`, 'utf8'))),
    ),
  );
}
const base = (
  await Promise.all(
    ['transfer', 'swap', 'bridge', 'lending', 'batch'].map((dir) =>
      load(`benchmark/scenarios/base/${dir}`),
    ),
  )
).flat();
const mutations = await load('benchmark/scenarios/mutations');
const byId = new Map(base.map((s) => [s.id, s]));

const PublishedExecutionSchema = z.object({
  datasetVersion: z.string(),
  baseCount: z.number().int().nonnegative(),
  attemptedCount: z.number().int().nonnegative(),
  completedExecutionCount: z.number().int().nonnegative(),
  strictAuthoredFixtureExecutionCount: z.number().int().nonnegative(),
  finalGoalPassCount: z.number().int().nonnegative(),
  strictAuthoredFixtureFinalGoalPassCount: z.number().int().nonnegative(),
  humanReview: z.string(),
  m2Complete: z.boolean(),
  latest: z.array(
    z.object({
      scenarioId: z.string(),
      run: z.string(),
      rawFileSha256: z.string(),
      executionComplete: z.boolean(),
      fixtureCorrected: z.boolean(),
      oracleStatus: z.string(),
    }),
  ),
  attempts: z.array(
    z.object({
      scenarioId: z.string(),
      run: z.string(),
      rawFileSha256: z.string(),
      sourceCommit: z.string(),
      workingTreeDirty: z.boolean(),
      collectorSha256: z.string().nullable(),
      sourceScenarioSha256: z.string(),
      executionComplete: z.boolean(),
      fixtureCorrected: z.boolean(),
      oracle: z.object({ status: z.string() }),
    }),
  ),
});
const publishedExecution = PublishedExecutionSchema.parse(
  JSON.parse(await readFile('benchmark/evidence/m2-execution-diagnostic-20260904.json', 'utf8')),
);
if (publishedExecution.datasetVersion !== '0.2.0' || publishedExecution.baseCount !== base.length)
  throw new Error('published execution evidence does not match the current dataset version/count');
const latestExecution = new Map(publishedExecution.latest.map((row) => [row.scenarioId, row]));
const latestAttempt = new Map(publishedExecution.attempts.map((row) => [row.scenarioId, row]));
if (
  latestExecution.size !== publishedExecution.latest.length ||
  latestExecution.size !== publishedExecution.attemptedCount
)
  throw new Error('published execution evidence has duplicate or inconsistent latest rows');
const recomputedCompleted = publishedExecution.latest.filter((row) => row.executionComplete).length;
const recomputedPass = publishedExecution.latest.filter(
  (row) => row.executionComplete && row.oracleStatus === 'PASS',
).length;
const recomputedStrict = publishedExecution.latest.filter(
  (row) => row.executionComplete && !row.fixtureCorrected,
).length;
const recomputedStrictPass = publishedExecution.latest.filter(
  (row) => row.executionComplete && !row.fixtureCorrected && row.oracleStatus === 'PASS',
).length;
if (
  recomputedCompleted !== publishedExecution.completedExecutionCount ||
  recomputedPass !== publishedExecution.finalGoalPassCount ||
  recomputedStrict !== publishedExecution.strictAuthoredFixtureExecutionCount ||
  recomputedStrictPass !== publishedExecution.strictAuthoredFixtureFinalGoalPassCount
)
  throw new Error('published execution aggregate does not match its latest rows');
for (const scenario of base) {
  const published = latestExecution.get(scenario.id);
  const attempt = latestAttempt.get(scenario.id);
  if (
    !published ||
    !attempt ||
    attempt.rawFileSha256 !== published.rawFileSha256 ||
    attempt.executionComplete !== published.executionComplete ||
    attempt.fixtureCorrected !== published.fixtureCorrected ||
    attempt.oracle.status !== published.oracleStatus
  )
    throw new Error(`missing latest published execution evidence: ${scenario.id}`);
  const scenarioSha256 = createHash('sha256').update(JSON.stringify(scenario)).digest('hex');
  if (attempt.sourceScenarioSha256 !== scenarioSha256)
    throw new Error(`stale published execution evidence: ${scenario.id}`);
}
const currentCollectorSha256 = await executionCollectorSha256();
const resolvableCommits = new Map<string, boolean>();
function sourceCommitResolves(commit: string): boolean {
  const cached = resolvableCommits.get(commit);
  if (cached !== undefined) return cached;
  try {
    execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`], { stdio: 'ignore' });
    resolvableCommits.set(commit, true);
    return true;
  } catch {
    resolvableCommits.set(commit, false);
    return false;
  }
}
const cleanCommittedExecutedBaseCount = base.filter((scenario) => {
  const latest = latestExecution.get(scenario.id);
  const attempt = latestAttempt.get(scenario.id);
  return (
    latest?.executionComplete === true &&
    attempt?.workingTreeDirty === false &&
    attempt.collectorSha256 === currentCollectorSha256 &&
    sourceCommitResolves(attempt.sourceCommit)
  );
}).length;
const executionEvidenceStatus = classifyExecutionEvidence({
  baseCount: base.length,
  completedExecutionCount: publishedExecution.completedExecutionCount,
  strictAuthoredFixtureExecutionCount: publishedExecution.strictAuthoredFixtureExecutionCount,
  cleanCommittedExecutedBaseCount,
});

const rows = [...base, ...mutations].map((s) => {
  const pre = evaluateIntent({
    contract: s.intent,
    acceptedEffects: [],
    candidateEffects: s.trace.expectedEffects,
    candidateDecodeStatus: s.trace.expectedEffects.some((e) => e.kind === 'UNKNOWN')
      ? 'UNKNOWN'
      : 'COMPLETE',
    simulationStatus: 'SUCCESS',
    evaluatedAt: '2026-08-30T00:00:00Z',
  });
  const perCall = evaluatePerCallPolicy(s);
  const guardStrict = evaluateGuardMode(s, undefined, 'STRICT');
  const guardLiteral = evaluateGuardMode(s, undefined, 'LITERAL');
  const reference = evaluatePostState({
    contract: s.intent,
    preState: s.oracle.preState,
    postState: s.oracle.postState,
    observedEffects: s.trace.expectedEffects,
    evidenceLevel: 'EXPECTED_FIXTURE',
    executionComplete: s.oracle.executionComplete,
  });
  return {
    scenarioId: s.id,
    workflow: s.workflow,
    class: s.class,
    observationStage: s.oracle.observationStage,
    authoredDecision: s.oracle.expectedDecision,
    preSign: {
      intentLock: pre.kind,
      perCall: perCall.decision,
      guardStrict: guardStrict.decision,
      guardLiteral: guardLiteral.decision,
    },
    preSignEligible: scoreDecision(s, pre.kind === 'ESCALATE' ? 'ABSTAIN' : pre.kind, 'PRE_SIGN')
      .eligible,
    referencePostState: {
      status: reference.status,
      decision: reference.decision,
      authoredLabelAgreement:
        s.oracle.observationStage === 'POST_STATE'
          ? reference.decision === s.oracle.expectedDecision
          : null,
      missing: reference.missing,
      violations: reference.violations,
    },
    executionEvidence:
      s.class === 'BASE'
        ? {
            status: latestExecution.get(s.id)?.executionComplete ? 'COMPLETE' : 'INCOMPLETE',
            oracleStatus: latestExecution.get(s.id)?.oracleStatus ?? null,
            run: latestExecution.get(s.id)?.run ?? null,
            sourceCommit: latestAttempt.get(s.id)?.sourceCommit ?? null,
            workingTreeDirty: latestAttempt.get(s.id)?.workingTreeDirty ?? null,
            collectorSha256: latestAttempt.get(s.id)?.collectorSha256 ?? null,
            collectorMatchesCurrent:
              latestAttempt.get(s.id)?.collectorSha256 === currentCollectorSha256,
            fixtureCorrected: latestExecution.get(s.id)?.fixtureCorrected ?? null,
          }
        : { status: 'NOT_COLLECTED' },
  };
});
const validation = {
  datasetVersion: '0.2.0',
  purpose: 'M2 integration diagnostics, not experimental performance',
  baseCount: base.length,
  mutationCount: mutations.length,
  preSignEligibleMutations: rows.filter((r) => r.class !== 'BASE' && r.preSignEligible).length,
  baseReferencePass: rows.filter(
    (r) => r.class === 'BASE' && r.referencePostState.status === 'PASS',
  ).length,
  baseMonitorAllow: rows.filter((r) => r.class === 'BASE' && r.preSign.intentLock === 'ALLOW')
    .length,
  executedBaseCount: publishedExecution.completedExecutionCount,
  strictAuthoredFixtureExecutedBaseCount: publishedExecution.strictAuthoredFixtureExecutionCount,
  cleanCommittedExecutedBaseCount,
  executionEvidenceStatus,
  executionFinalGoalPassCount: publishedExecution.finalGoalPassCount,
  strictAuthoredFixtureFinalGoalPassCount:
    publishedExecution.strictAuthoredFixtureFinalGoalPassCount,
  referenceLabelDisagreements: rows
    .filter((r) => r.referencePostState.authoredLabelAgreement === false)
    .map((r) => r.scenarioId),
  crossStageDifferencesNotScored: rows
    .filter(
      (r) =>
        r.observationStage === 'PRE_SIGN' && r.authoredDecision !== r.referencePostState.decision,
    )
    .map((r) => r.scenarioId),
  independentReviewStatus: 'PENDING',
  m2Complete: false,
  rows,
};
const first = [
  'TR-01',
  'TR-07',
  'AP-01',
  'AP-03',
  'AP-05',
  'SS-01',
  'SS-07',
  'BS-01',
  'BS-07',
  'BS-08',
];
const second = [
  'BR-01',
  'BR-02',
  'BR-05',
  'BR-07',
  'LE-01',
  'LE-03',
  'LE-05',
  'LE-08',
  'BA-01',
  'BA-06',
];
function blind(id: string) {
  const s = byId.get(id);
  if (!s || s.split === 'HIDDEN_TEST')
    throw new Error('Review selection must exist and be TRAIN/DEV');
  return {
    ...redactScenarioIdentity(s),
    observations: {
      evidenceLevel: 'EXPECTED_FIXTURE',
      before: s.oracle.preState,
      after: s.oracle.postState,
    },
  };
}
const packet = {
  protocolVersion: '0.2',
  datasetVersion: '0.2.0',
  status: 'PENDING_INDEPENDENT_REVIEW',
  instructions:
    'Each reviewer independently assesses natural-language alignment, intermediate safety, final-state goals and evidence limitations. Expected fixtures do not demonstrate execution. Do not open source labels or diagnostics before submitting.',
  cases: [...first, ...second].map((id, index) => ({
    reviewId: `D${String(index + 1).padStart(2, '0')}`,
    input: blind(id),
  })),
};
const packetHash = createHash('sha256').update(JSON.stringify(packet)).digest('hex');
const template = {
  protocolVersion: '0.2',
  datasetVersion: '0.2.0',
  packetSha256: packetHash,
  reviewer: null,
  reviewerType: 'HUMAN',
  submittedAt: null,
  status: 'PENDING',
  cases: packet.cases.map((c) => ({
    reviewId: c.reviewId,
    alignment: null,
    intermediateDecision: null,
    finalStateDecision: null,
    evidenceAdequate: null,
    notes: null,
  })),
};
const status = {
  datasetVersion: '0.2.0',
  baseCount: 80,
  requiredSampleSize: 20,
  sampleSize: packet.cases.length,
  fraction: 0.25,
  packetSha256: packetHash,
  requiredDistinctHumanReviewers: 2,
  submissionsDirectory: 'benchmark/labels/submissions',
  adjudicationRecord: 'benchmark/labels/adjudications.json',
  status: 'REQUIREMENTS_ONLY_NOT_REVIEW_COMPLETION',
};
async function output(path: string, value: unknown) {
  const contents = await format(JSON.stringify(value), {
    ...(await resolveConfig('package.json')),
    parser: 'json',
  });
  if (check) {
    if ((await readFile(path, 'utf8').catch(() => '')) !== contents)
      throw new Error(`stale generated M2 artifact: ${path}`);
  } else {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, 'utf8');
  }
}
await output('experiments/configs/m2-validation.json', validation);
await output('benchmark/reviews/double-review-20.json', packet);
await output('benchmark/reviews/submission.template.json', template);
await output('benchmark/labels/review-requirements.json', status);
console.log(
  `M2 diagnostics: ${String(base.length)} base, ${String(mutations.length)} mutation; reference PASS ${String(validation.baseReferencePass)}; executed base ${String(validation.executedBaseCount)} (${validation.executionEvidenceStatus}); human review PENDING.`,
);
