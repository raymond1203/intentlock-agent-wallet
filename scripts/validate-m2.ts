import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { format, resolveConfig } from 'prettier';
import {
  AI_BENCHMARK_REVIEW_PATH,
  evaluateAiAssistedReviewGate,
  evaluateReviewGate,
  REVIEW_PROTOCOL_PATH,
  ReviewProtocolSchema,
  reviewDigest,
} from '../src/benchmark/review-gate.js';
import { BenchmarkScenarioSchema, type BenchmarkScenario } from '../src/benchmark/scenario.js';
import { BENCHMARK_DATASET_VERSION } from '../src/benchmark/version.js';
import { scoreDecision } from '../src/benchmark/scoring.js';
import { buildLlmBaselineInputBinding } from '../src/baselines/llm-baseline-input.js';
import { redactScenarioIdentity } from '../src/baselines/llm-verifier.js';
import { evaluateGuardMode } from '../src/baselines/guard-mode-emulator.js';
import { evaluatePerCallPolicy } from '../src/baselines/per-call-policy.js';
import { evaluateIntent } from '../src/monitor/monitor.js';
import { evaluatePostState } from '../src/oracle/post-state-oracle.js';
import {
  deriveM2Completion,
  evaluateLlmBaselineGate,
  LLM_BASELINE_CONFIG_PATH,
  LLM_BASELINE_PROTOCOL_PATH,
  LLM_BASELINE_RESULT_PATH,
  LLM_BASELINE_REVIEW_PACKET_PATH,
  LLM_RATIONALE_REVIEW_PATH,
  sha256Source,
} from '../src/experiments/freeze-gates.js';
import { executionCollectorSha256 } from './m2-execution/provenance.js';
import {
  M2PublishedEvidenceSchema,
  validatePublishedM2Evidence,
} from './m2-execution/evidence-validation.js';
import { boundCollectorSha256 } from './m2-execution/historical-collector.js';
import { M2_ATTEMPT_SELECTION_POLICY } from './m2-execution/attempt-selection.js';

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

function readOptionalTrackedJsonArtifact(path: string): {
  value?: unknown;
  sha256?: string;
} {
  let source: string;
  try {
    source = execFileSync('git', ['show', `HEAD:${path}`], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return {};
  }
  try {
    return { value: JSON.parse(source) as unknown, sha256: sha256Source(source) };
  } catch {
    return { value: null, sha256: sha256Source(source) };
  }
}

const currentEvidencePath = `benchmark/evidence/m2-execution-v${BENCHMARK_DATASET_VERSION}.json`;
const rawPublishedExecution = await readFile(currentEvidencePath, 'utf8').catch(() => null);
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
const ancestorCommits = new Map<string, boolean>();
function sourceCommitIsAncestor(commit: string): boolean {
  const cached = ancestorCommits.get(commit);
  if (cached !== undefined) return cached;
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { stdio: 'ignore' });
    ancestorCommits.set(commit, true);
    return true;
  } catch {
    ancestorCommits.set(commit, false);
    return false;
  }
}
function readTrackedRawEvidenceBytes(path: string): Uint8Array {
  try {
    return execFileSync('git', ['show', `HEAD:${path}`], { maxBuffer: 64 * 1024 * 1024 });
  } catch (cause) {
    throw new Error(`raw evidence is not tracked at Git HEAD: ${path}`, { cause });
  }
}
const llmConfigSource = await readFile(LLM_BASELINE_CONFIG_PATH, 'utf8');
const llmProtocolSource = await readFile(LLM_BASELINE_PROTOCOL_PATH, 'utf8');
const llmConfig = JSON.parse(llmConfigSource) as unknown;
const llmProtocol = JSON.parse(llmProtocolSource) as unknown;
const reviewProtocol = ReviewProtocolSchema.parse(
  JSON.parse(await readFile(REVIEW_PROTOCOL_PATH, 'utf8')) as unknown,
);
const rationaleReviewPath =
  reviewProtocol.mode === 'SOLO_AI_ASSISTED'
    ? reviewProtocol.llmAiReviewPath
    : LLM_RATIONALE_REVIEW_PATH;
const [llmResultArtifact, llmReviewPacketArtifact, llmRationaleReviewArtifact] = [
  readOptionalTrackedJsonArtifact(LLM_BASELINE_RESULT_PATH),
  readOptionalTrackedJsonArtifact(LLM_BASELINE_REVIEW_PACKET_PATH),
  readOptionalTrackedJsonArtifact(rationaleReviewPath),
];
const llmInputBinding = await buildLlmBaselineInputBinding(llmConfig, llmProtocol, (id) => {
  const scenario = byId.get(id);
  if (!scenario) throw new Error(`unknown LLM baseline source scenario: ${id}`);
  return Promise.resolve(scenario);
}).catch(() => undefined);
const emptyPublishedExecution = {
  datasetVersion: BENCHMARK_DATASET_VERSION,
  purpose: 'Diagnostic evidence, not a frozen performance result',
  selection: M2_ATTEMPT_SELECTION_POLICY,
  baseCount: base.length,
  attemptedCount: 0,
  missing: base.map((scenario) => scenario.id),
  completedExecutionCount: 0,
  strictAuthoredFixtureExecutionCount: 0,
  finalGoalPassCount: 0,
  strictAuthoredFixtureFinalGoalPassCount: 0,
  syntheticReferenceCheckedCount: 0,
  syntheticReferenceDisagreementCount: 0,
  humanReview: 'PENDING',
  m2Complete: false,
  latest: [],
  attempts: [],
};
const publishedInput = M2PublishedEvidenceSchema.parse(
  rawPublishedExecution ? JSON.parse(rawPublishedExecution) : emptyPublishedExecution,
);
const sourceCollectorSha256 = new Map<string, string>();
for (const commit of new Set(publishedInput.attempts.map((attempt) => attempt.sourceCommit))) {
  if (!sourceCommitResolves(commit) || !sourceCommitIsAncestor(commit)) {
    throw new Error(`published source commit is not in the current HEAD lineage: ${commit}`);
  }
  sourceCollectorSha256.set(commit, await boundCollectorSha256(commit));
}
const verifiedPublishedExecution = validatePublishedM2Evidence(publishedInput, {
  scenarios: base,
  currentCollectorSha256,
  sourceCollectorSha256,
  sourceCommitResolves,
  sourceCommitIsAncestor,
  readRawEvidenceBytes: readTrackedRawEvidenceBytes,
  rawEvidenceSource: 'GIT_HEAD_TRACKED',
});
const {
  evidence: publishedExecution,
  latestExecution,
  selectedAttempt,
  cleanCommittedExecutedBaseCount,
  executionEvidenceStatus,
} = verifiedPublishedExecution;
const executionSourceCommits = [
  ...new Set([...selectedAttempt.values()].map((attempt) => attempt.sourceCommit)),
];
const llmBaselineEvidence = evaluateLlmBaselineGate({
  resultPath: LLM_BASELINE_RESULT_PATH,
  reviewPacketPath: LLM_BASELINE_REVIEW_PACKET_PATH,
  rationaleReviewPath,
  reviewMode: reviewProtocol.mode === 'SOLO_AI_ASSISTED' ? 'SOLO_AI_ASSISTED' : 'INDEPENDENT_HUMAN',
  config: llmConfig,
  configSha256: sha256Source(llmConfigSource),
  protocol: llmProtocol,
  protocolSha256: sha256Source(llmProtocolSource),
  result: llmResultArtifact.value,
  resultSha256: llmResultArtifact.sha256,
  reviewPacket: llmReviewPacketArtifact.value,
  reviewPacketSha256: llmReviewPacketArtifact.sha256,
  rationaleReview: llmRationaleReviewArtifact.value,
  rationaleReviewSha256: llmRationaleReviewArtifact.sha256,
  expectedInput: llmInputBinding
    ? { inputSha256: llmInputBinding.inputSha256, cases: llmInputBinding.expectedCases }
    : undefined,
  executionSourceCommits,
  sourceCommitResolves,
  sourceCommitIsAncestor,
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
    expectedDeltas: s.oracle.expectedDeltas,
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
            sourceCommit: selectedAttempt.get(s.id)?.sourceCommit ?? null,
            workingTreeDirty: selectedAttempt.get(s.id)?.workingTreeDirty ?? null,
            collectorSha256: selectedAttempt.get(s.id)?.collectorSha256 ?? null,
            collectorMatchesCurrent:
              selectedAttempt.get(s.id)?.collectorSha256 === currentCollectorSha256,
            collectorMatchesBoundSource:
              selectedAttempt.get(s.id)?.collectorSha256 ===
              sourceCollectorSha256.get(selectedAttempt.get(s.id)?.sourceCommit ?? ''),
            fixtureCorrected: latestExecution.get(s.id)?.fixtureCorrected ?? null,
          }
        : { status: 'NOT_COLLECTED' },
  };
});
const baseReferencePass = rows.filter(
  (row) => row.class === 'BASE' && row.referencePostState.status === 'PASS',
).length;
const baseReferenceLabelDisagreements = rows
  .filter((row) => row.class === 'BASE' && row.referencePostState.authoredLabelAgreement === false)
  .map((row) => row.scenarioId);
const referenceLabelDisagreements = rows
  .filter((row) => row.referencePostState.authoredLabelAgreement === false)
  .map((row) => row.scenarioId);
const crossStageDifferencesNotScored = rows
  .filter(
    (row) =>
      row.observationStage === 'PRE_SIGN' &&
      row.authoredDecision !== row.referencePostState.decision,
  )
  .map((row) => row.scenarioId);
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
      expectedDeltas: s.oracle.expectedDeltas,
    },
  };
}
const packet = {
  protocolVersion: '0.2',
  datasetVersion: BENCHMARK_DATASET_VERSION,
  status: 'PENDING_INDEPENDENT_REVIEW',
  instructions:
    'Each reviewer independently assesses natural-language alignment, intermediate safety, final-state goals and evidence limitations. Expected fixtures do not demonstrate execution. Do not open source labels or diagnostics before submitting.',
  cases: [...first, ...second].map((id, index) => ({
    reviewId: `D${String(index + 1).padStart(2, '0')}`,
    input: blind(id),
  })),
};
const packetHash = reviewDigest(packet);
const submissionsDirectory = 'benchmark/labels/submissions';
const submissionFiles = (
  await readdir(submissionsDirectory).catch((cause: unknown) => {
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return [];
    throw cause;
  })
)
  .filter((file) => file.endsWith('.json'))
  .sort();
const reviewSubmissions: unknown[] = await Promise.all(
  submissionFiles.map(
    async (file) =>
      JSON.parse(await readFile(`${submissionsDirectory}/${file}`, 'utf8')) as unknown,
  ),
);
let reviewAdjudications: unknown;
try {
  reviewAdjudications = JSON.parse(
    await readFile('benchmark/labels/adjudications.json', 'utf8'),
  ) as unknown;
} catch (cause) {
  if (!(cause instanceof Error && 'code' in cause && cause.code === 'ENOENT')) throw cause;
}
const reviewGate = evaluateReviewGate(
  {
    datasetVersion: BENCHMARK_DATASET_VERSION,
    packetSha256: packetHash,
    reviewIds: packet.cases.map((reviewCase) => reviewCase.reviewId),
  },
  reviewSubmissions,
  reviewAdjudications,
);
const aiReviewArtifact = readOptionalTrackedJsonArtifact(AI_BENCHMARK_REVIEW_PATH);
const aiAssistedReviewEvidence = {
  ...evaluateAiAssistedReviewGate(
    {
      datasetVersion: BENCHMARK_DATASET_VERSION,
      packetSha256: packetHash,
      reviewIds: packet.cases.map((reviewCase) => reviewCase.reviewId),
    },
    reviewProtocol,
    aiReviewArtifact.value,
  ),
  artifactPath: AI_BENCHMARK_REVIEW_PATH,
  artifactSha256: aiReviewArtifact.sha256 ?? null,
};
const completion = deriveM2Completion({
  baseCount: base.length,
  executedBaseCount: publishedExecution.completedExecutionCount,
  strictAuthoredFixtureExecutedBaseCount: publishedExecution.strictAuthoredFixtureExecutionCount,
  cleanCommittedExecutedBaseCount,
  executionEvidenceStatus,
  executionFinalGoalPassCount: publishedExecution.finalGoalPassCount,
  strictAuthoredFixtureFinalGoalPassCount:
    publishedExecution.strictAuthoredFixtureFinalGoalPassCount,
  baseReferencePass,
  baseReferenceLabelDisagreementCount: baseReferenceLabelDisagreements.length,
  syntheticReferenceCheckedCount: publishedExecution.syntheticReferenceCheckedCount,
  syntheticReferenceDisagreementCount: publishedExecution.syntheticReferenceDisagreementCount,
  reviewGateStatus: reviewGate.status,
  reviewMode: reviewProtocol.mode === 'SOLO_AI_ASSISTED' ? 'SOLO_AI_ASSISTED' : 'INDEPENDENT_HUMAN',
  aiBenchmarkReviewStatus: aiAssistedReviewEvidence.recordStatus,
  finalAuthorApproval: 'PENDING',
  llmBaselineRunStatus: llmBaselineEvidence.runStatus,
  llmRationaleReviewStatus: llmBaselineEvidence.rationaleReview.status,
});
const validation = {
  datasetVersion: BENCHMARK_DATASET_VERSION,
  purpose: 'M2 integration diagnostics, not experimental performance',
  baseCount: base.length,
  mutationCount: mutations.length,
  preSignEligibleMutations: rows.filter((row) => row.class !== 'BASE' && row.preSignEligible)
    .length,
  baseReferencePass,
  baseReferenceLabelDisagreements,
  syntheticReferenceCheckedCount: publishedExecution.syntheticReferenceCheckedCount,
  syntheticReferenceDisagreementCount: publishedExecution.syntheticReferenceDisagreementCount,
  baseMonitorAllow: rows.filter((row) => row.class === 'BASE' && row.preSign.intentLock === 'ALLOW')
    .length,
  executedBaseCount: publishedExecution.completedExecutionCount,
  strictAuthoredFixtureExecutedBaseCount: publishedExecution.strictAuthoredFixtureExecutionCount,
  cleanCommittedExecutedBaseCount,
  executionEvidenceStatus,
  executionFinalGoalPassCount: publishedExecution.finalGoalPassCount,
  strictAuthoredFixtureFinalGoalPassCount:
    publishedExecution.strictAuthoredFixtureFinalGoalPassCount,
  referenceLabelDisagreements,
  crossStageDifferencesNotScored,
  ...(reviewProtocol.mode === 'SOLO_AI_ASSISTED' ? { reviewProtocol } : {}),
  aiAssistedReviewEvidence,
  independentReviewEvidence: {
    recordStatus: reviewGate.status,
    identityAndIndependence: reviewGate.identityAndIndependence,
    submissionCount: reviewSubmissions.length,
    submissionSha256s: reviewGate.submissionSha256s,
    disagreementCount: reviewGate.disagreements.length,
    blockers: reviewGate.blockers,
  },
  llmBaselineEvidence,
  completionCriteria: {
    executionComplete: completion.executionComplete,
    referenceOracleComplete: completion.referenceOracleComplete,
    llmBaselineComplete: completion.llmBaselineComplete,
  },
  independentReviewStatus: completion.independentReviewStatus,
  experimentReady: completion.experimentReady,
  m2Complete: completion.m2Complete,
  rows,
};
const template = {
  protocolVersion: '0.2',
  datasetVersion: BENCHMARK_DATASET_VERSION,
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
  datasetVersion: BENCHMARK_DATASET_VERSION,
  baseCount: 80,
  requiredSampleSize: 20,
  sampleSize: packet.cases.length,
  fraction: 0.25,
  packetSha256: packetHash,
  reviewMode: reviewProtocol.mode,
  requiredDistinctHumanReviewers: reviewProtocol.mode === 'DUAL_HUMAN' ? 2 : 0,
  requiredFinalAuthorApprovals: reviewProtocol.mode === 'SOLO_AI_ASSISTED' ? 1 : 0,
  finalAuthorApproval: 'PENDING',
  independentHumanReviewClaim: false,
  submissionsDirectory,
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
  `M2 diagnostics: ${String(base.length)} base, ${String(mutations.length)} mutation; reference PASS ${String(validation.baseReferencePass)}; synthetic reference checked ${String(validation.syntheticReferenceCheckedCount)}, disagreements ${String(validation.syntheticReferenceDisagreementCount)}; executed base ${String(validation.executedBaseCount)} (${validation.executionEvidenceStatus}); LLM run ${validation.llmBaselineEvidence.runStatus}, rationale review ${validation.llmBaselineEvidence.rationaleReview.status}; mode ${reviewProtocol.mode}; human review ${validation.independentReviewStatus}; experiment ready ${String(validation.experimentReady)}; M2 complete ${String(validation.m2Complete)}.`,
);
