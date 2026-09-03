import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { BenchmarkScenarioSchema, type BenchmarkScenario } from '../src/benchmark/scenario.js';
import { scoreDecision } from '../src/benchmark/scoring.js';
import { redactScenarioIdentity } from '../src/baselines/llm-verifier.js';
import { evaluateGuardMode } from '../src/baselines/guard-mode-emulator.js';
import { evaluatePerCallPolicy } from '../src/baselines/per-call-policy.js';
import { evaluateIntent } from '../src/monitor/monitor.js';
import { evaluatePostState } from '../src/oracle/post-state-oracle.js';

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
    executionEvidence: 'NOT_COLLECTED_PER_SCENARIO',
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
  executedBaseCount: 0,
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
  `M2 diagnostics: ${String(base.length)} base, ${String(mutations.length)} mutation; reference PASS ${String(validation.baseReferencePass)}; executed base ${String(validation.executedBaseCount)}; human review PENDING.`,
);
