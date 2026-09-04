import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BenchmarkScenarioSchema } from '../../src/benchmark/scenario.js';
import { scoreDecision } from '../../src/benchmark/scoring.js';
import {
  buildLlmBaselineInputBinding,
  LlmBaselineProtocolSchema,
  LLM_BASELINE_CONFIG_PATH,
  LLM_BASELINE_PROTOCOL_PATH,
  LLM_BASELINE_RESULT_PATH,
  LLM_BASELINE_REVIEW_PACKET_PATH,
  LLM_RATIONALE_REVIEW_PATH,
} from '../../src/baselines/llm-baseline-input.js';
import { LlmVerifierConfigSchema } from '../../src/baselines/llm-verifier.js';
import {
  FREEZE_REVIEW_CASE_IDS,
  FROZEN_ABLATION_CONFIG_PATH,
  FROZEN_EVALUATION_CONFIG_PATH,
  AnyFreezeReviewRecordSchema,
  deriveM2Completion,
  evaluateLlmBaselineGate,
  resolveRepoRelativeJson,
  sha256Source,
  validateApprovedFreezeReview,
  validateFreezeReviewForProtocol,
  validateFreezeReviewCaseManifest,
  validateFreezeTransition,
  validateM2ReadyForFreeze,
} from '../../src/experiments/freeze-gates.js';

const head = 'a'.repeat(40);
const tree = 'b'.repeat(40);
const sha = 'c'.repeat(64);
const completedLlmBaselineEvidence = {
  resultPath: LLM_BASELINE_RESULT_PATH,
  reviewPacketPath: LLM_BASELINE_REVIEW_PACKET_PATH,
  rationaleReviewPath: LLM_RATIONALE_REVIEW_PATH,
  expectedDatasetVersion: '0.4.0',
  runStatus: 'COMPLETE',
  codeCommit: head,
  workingTreeDirty: false,
  sampleSize: 20,
  inputSha256: sha,
  configSha256: sha,
  protocolSha256: sha,
  resultSha256: sha,
  reviewPacketSha256: sha,
  runBlockers: [],
  rationaleReview: {
    status: 'COMPLETE',
    reviewerPseudonym: 'reviewer-b',
    reviewerType: 'HUMAN',
    independenceAttestation: true,
    reviewedAt: '2026-09-05T00:00:00.000Z',
    reviewedCommit: head,
    caseCount: 20,
    submissionSha256: sha,
    blockers: [],
  },
};
const approvedReview = {
  schemaVersion: '0.2',
  status: 'APPROVED',
  reviewedCommit: head,
  reviewerPseudonym: 'reviewer-a',
  reviewerType: 'HUMAN',
  independenceAttestation: true,
  reviewedAt: '2026-09-04T00:00:00.000Z',
  dryRunEvidence: {
    outputDirectory: 'experiments/results/freeze-dry-runs/freeze-review-test',
    runId: 'freeze-review-test',
    candidateCommit: head,
    candidateTree: tree,
    manifestSha256: 'c'.repeat(64),
    casesJsonlSha256: 'd'.repeat(64),
    summarySha256: 'e'.repeat(64),
  },
  dryRunCases: 20,
  reviewedCaseIds: [...FREEZE_REVIEW_CASE_IDS],
  reproducedCases: FREEZE_REVIEW_CASE_IDS.map((caseId) => ({
    caseId,
    reproduced: true as const,
    result: 'MATCHED_EXPECTATION' as const,
    notes: 'Reproduced from the frozen case input.',
  })),
  checks: {
    protocolConfigReviewed: true,
    implementationScopeReviewed: true,
    caseManifestReviewed: true,
    m2CompletionReviewed: true,
    retryPolicyReviewed: true,
  },
  notes: 'Independent review completed against the recorded candidate commit.',
} as const;

const completedM2 = {
  datasetVersion: '0.4.0',
  baseCount: 80,
  executedBaseCount: 80,
  strictAuthoredFixtureExecutedBaseCount: 80,
  cleanCommittedExecutedBaseCount: 80,
  executionFinalGoalPassCount: 80,
  strictAuthoredFixtureFinalGoalPassCount: 80,
  baseReferencePass: 80,
  baseReferenceLabelDisagreements: [],
  syntheticReferenceCheckedCount: 80,
  syntheticReferenceDisagreementCount: 0,
  executionEvidenceStatus: 'COMPLETE',
  independentReviewEvidence: {
    recordStatus: 'RECORDS_COMPLETE',
    submissionCount: 2,
    blockers: [],
  },
  llmBaselineEvidence: completedLlmBaselineEvidence,
  completionCriteria: {
    executionComplete: true,
    referenceOracleComplete: true,
    llmBaselineComplete: true,
  },
  independentReviewStatus: 'COMPLETE',
  m2Complete: true,
};

const fixtureConfigSource = readFileSync(LLM_BASELINE_CONFIG_PATH, 'utf8');
const fixtureProtocolSource = readFileSync(LLM_BASELINE_PROTOCOL_PATH, 'utf8');
const fixtureConfig = LlmVerifierConfigSchema.parse(JSON.parse(fixtureConfigSource));
const fixtureProtocol = LlmBaselineProtocolSchema.parse(JSON.parse(fixtureProtocolSource));
const fixtureInputBinding = await buildLlmBaselineInputBinding(
  fixtureConfig,
  fixtureProtocol,
  (id) => {
    const directory =
      id.startsWith('TR-') || id.startsWith('AP-')
        ? 'transfer'
        : id.startsWith('BR-')
          ? 'bridge'
          : 'swap';
    return Promise.resolve(
      BenchmarkScenarioSchema.parse(
        JSON.parse(
          readFileSync(
            resolve('benchmark/scenarios/base', directory, `${id.toLowerCase()}.json`),
            'utf8',
          ),
        ),
      ),
    );
  },
);

function validLlmGateInput() {
  const config = structuredClone(fixtureConfig);
  const protocol = structuredClone(fixtureProtocol);
  const outputs = fixtureInputBinding.sample.map((scenario, index) => {
    const expectedCase = fixtureInputBinding.expectedCases[index];
    if (!expectedCase) throw new Error(`missing expected LLM case ${String(index)}`);
    const modelDecision =
      scenario.oracle.expectedDecision === 'ESCALATE'
        ? ('ABSTAIN' as const)
        : scenario.oracle.expectedDecision;
    const score = scoreDecision(scenario, modelDecision, 'PRE_SIGN');
    return {
      reviewId: expectedCase.reviewId,
      scenarioId: scenario.id,
      split: scenario.split,
      class: scenario.class,
      verdict: {
        decision: modelDecision,
        rationale: `Rationale ${String(index)}`,
        reasonCodes: [],
        attempts: 1,
        rawOutput: `raw-${String(index)}`,
      },
      ...score,
    };
  });
  const result = {
    schemaVersion: '0.1',
    datasetVersion: '0.4.0',
    codeCommit: head,
    workingTreeDirty: false,
    inputSha256: fixtureInputBinding.inputSha256,
    evaluationStage: 'PRE_SIGN',
    seed: 2026,
    config,
    sampleSize: 20,
    eligibleCount: outputs.filter((output) => output.eligible).length,
    exactMatches: outputs.filter((output) => output.exactMatch).length,
    outputs,
    reviewerStatus: 'PENDING_INDEPENDENT_REVIEW',
  };
  const reviewPacket = {
    protocolVersion: '0.1',
    status: 'PENDING_INDEPENDENT_REVIEW',
    datasetVersion: '0.4.0',
    codeCommit: head,
    workingTreeDirty: false,
    inputSha256: result.inputSha256,
    seed: 2026,
    config,
    instructions: 'Review every rationale.',
    cases: outputs.map((output, index) => {
      const expectedCase = fixtureInputBinding.expectedCases[index];
      if (!expectedCase) throw new Error(`missing expected LLM packet case ${String(index)}`);
      return {
        reviewId: output.reviewId,
        input: expectedCase.input,
        output: {
          decision: output.verdict.decision,
          rationale: output.verdict.rationale,
          violatedFields: output.verdict.reasonCodes,
          attempts: output.verdict.attempts,
          rawOutput: output.verdict.rawOutput,
        },
      };
    }),
  };
  const configSha256 = sha256Source(fixtureConfigSource);
  const protocolSha256 = sha256Source(fixtureProtocolSource);
  const resultSha256 = sha256Source(JSON.stringify(result));
  const reviewPacketSha256 = sha256Source(JSON.stringify(reviewPacket));
  const rationaleReview = {
    protocolVersion: '0.1',
    datasetVersion: '0.4.0',
    status: 'COMPLETE',
    reviewerPseudonym: 'reviewer-b',
    reviewerType: 'HUMAN',
    independenceAttestation: true,
    reviewedAt: '2026-09-05T00:00:00.000Z',
    reviewedCommit: head,
    inputSha256: result.inputSha256,
    configSha256,
    resultSha256,
    reviewPacketSha256,
    cases: outputs.map((output) => ({
      reviewId: output.reviewId,
      modelDecision: output.verdict.decision,
      rationaleSupported: true,
      oracleLeakage: false,
      correctedDecision: output.verdict.decision,
      notes: 'Independently checked against the redacted input.',
    })),
  };
  return {
    resultPath: LLM_BASELINE_RESULT_PATH,
    reviewPacketPath: LLM_BASELINE_REVIEW_PACKET_PATH,
    rationaleReviewPath: LLM_RATIONALE_REVIEW_PATH,
    config,
    configSha256,
    protocol,
    protocolSha256,
    result,
    resultSha256,
    reviewPacket,
    reviewPacketSha256,
    rationaleReview,
    rationaleReviewSha256: sha256Source(JSON.stringify(rationaleReview)),
    expectedInput: {
      inputSha256: fixtureInputBinding.inputSha256,
      cases: fixtureInputBinding.expectedCases,
    },
    executionSourceCommits: [head],
    sourceCommitResolves: () => true,
    sourceCommitIsAncestor: () => true,
  };
}

describe('evaluation freeze gates', () => {
  it('derives M2 completion only from all execution, oracle, and review evidence', () => {
    const evidence = {
      baseCount: 80,
      executedBaseCount: 80,
      strictAuthoredFixtureExecutedBaseCount: 80,
      cleanCommittedExecutedBaseCount: 80,
      executionEvidenceStatus: 'CLEAN_COMMITTED_CANDIDATE',
      executionFinalGoalPassCount: 80,
      strictAuthoredFixtureFinalGoalPassCount: 80,
      baseReferencePass: 80,
      baseReferenceLabelDisagreementCount: 0,
      syntheticReferenceCheckedCount: 80,
      syntheticReferenceDisagreementCount: 0,
      reviewGateStatus: 'RECORDS_COMPLETE',
      llmBaselineRunStatus: 'COMPLETE',
      llmRationaleReviewStatus: 'COMPLETE',
    } as const;
    expect(deriveM2Completion(evidence)).toEqual({
      executionComplete: true,
      referenceOracleComplete: true,
      llmBaselineComplete: true,
      independentReviewStatus: 'COMPLETE',
      experimentReady: true,
      m2Complete: true,
    });
    expect(deriveM2Completion({ ...evidence, reviewGateStatus: 'PENDING' }).m2Complete).toBe(false);
    expect(
      deriveM2Completion({ ...evidence, strictAuthoredFixtureFinalGoalPassCount: 79 }).m2Complete,
    ).toBe(false);
    expect(
      deriveM2Completion({ ...evidence, baseReferenceLabelDisagreementCount: 1 }).m2Complete,
    ).toBe(false);
    expect(
      deriveM2Completion({ ...evidence, syntheticReferenceDisagreementCount: 1 }),
    ).toMatchObject({ referenceOracleComplete: false, m2Complete: false });
    expect(deriveM2Completion({ ...evidence, syntheticReferenceCheckedCount: 79 })).toMatchObject({
      referenceOracleComplete: false,
      m2Complete: false,
    });
    expect(deriveM2Completion({ ...evidence, syntheticReferenceCheckedCount: 0 })).toMatchObject({
      referenceOracleComplete: false,
      m2Complete: false,
    });
    expect(deriveM2Completion({ ...evidence, llmBaselineRunStatus: 'PENDING' })).toMatchObject({
      llmBaselineComplete: false,
      m2Complete: false,
    });
    expect(deriveM2Completion({ ...evidence, llmRationaleReviewStatus: 'PENDING' })).toMatchObject({
      llmBaselineComplete: false,
      m2Complete: false,
    });
  });

  it('binds a complete LLM run and rationale review to exact v0.4 artifacts', () => {
    expect(evaluateLlmBaselineGate(validLlmGateInput())).toMatchObject({
      runStatus: 'COMPLETE',
      codeCommit: head,
      sampleSize: 20,
      runBlockers: [],
      rationaleReview: {
        status: 'COMPLETE',
        reviewerPseudonym: 'reviewer-b',
        reviewerType: 'HUMAN',
        independenceAttestation: true,
        reviewedAt: '2026-09-05T00:00:00.000Z',
        caseCount: 20,
        blockers: [],
      },
    });
  });

  it('keeps missing or partial LLM evidence parseable and pending', () => {
    const valid = validLlmGateInput();
    const missing = evaluateLlmBaselineGate({
      ...valid,
      result: undefined,
      resultSha256: undefined,
      reviewPacket: undefined,
      reviewPacketSha256: undefined,
      rationaleReview: undefined,
      rationaleReviewSha256: undefined,
    });
    expect(missing).toMatchObject({
      runStatus: 'PENDING',
      rationaleReview: { status: 'PENDING' },
    });
    expect(missing.runBlockers).toEqual(
      expect.arrayContaining(['result:missing', 'review-packet:missing']),
    );
    expect(missing.rationaleReview.blockers).toEqual(
      expect.arrayContaining(['rationale-review:missing', 'baseline-run:not-complete']),
    );
    const partialReview = structuredClone(valid.rationaleReview);
    partialReview.cases.pop();
    const partial = evaluateLlmBaselineGate({ ...valid, rationaleReview: partialReview });
    expect(partial.rationaleReview.status).toBe('PENDING');
    expect(partial.rationaleReview.blockers).toContain('rationale-review:invalid');
  });

  it('rejects stale config, unrelated samples, changed inputs, hashes, and source commits', () => {
    const valid = validLlmGateInput();
    expect(
      evaluateLlmBaselineGate({ ...valid, sourceCommitIsAncestor: () => false }).runBlockers,
    ).toContain('result:commit-not-head-ancestor');
    expect(
      evaluateLlmBaselineGate({ ...valid, executionSourceCommits: ['f'.repeat(40)] }).runBlockers,
    ).toContain('result:execution-source-commit-mismatch');
    expect(evaluateLlmBaselineGate({ ...valid, executionSourceCommits: [] }).runBlockers).toContain(
      'execution-source-commit:missing',
    );
    expect(
      evaluateLlmBaselineGate({
        ...valid,
        executionSourceCommits: [head, 'f'.repeat(40)],
      }).runBlockers,
    ).toContain('execution-source-commit:multiple');
    expect(
      evaluateLlmBaselineGate({
        ...valid,
        config: { ...valid.config, timeoutMs: 31_000 },
      }).runBlockers,
    ).toContain('result:config-mismatch');
    const unrelatedResult = structuredClone(valid.result);
    const unrelatedOutput = unrelatedResult.outputs[0];
    if (!unrelatedOutput) throw new Error('missing LLM result row');
    unrelatedOutput.scenarioId = 'UNRELATED-SELECTION';
    expect(evaluateLlmBaselineGate({ ...valid, result: unrelatedResult }).runBlockers).toContain(
      'result:sample-mismatch:R01',
    );
    const staleHashResult = { ...valid.result, inputSha256: 'e'.repeat(64) };
    expect(evaluateLlmBaselineGate({ ...valid, result: staleHashResult }).runBlockers).toContain(
      'result:input-digest-mismatch',
    );
    const changedInputPacket = structuredClone(valid.reviewPacket);
    const changedInputCase = changedInputPacket.cases[0];
    if (!changedInputCase) throw new Error('missing LLM packet case');
    changedInputCase.input = { replaced: true };
    expect(
      evaluateLlmBaselineGate({ ...valid, reviewPacket: changedInputPacket }).runBlockers,
    ).toContain('review-packet:input-mismatch:R01');
    const mismatchedPacket = structuredClone(valid.reviewPacket);
    const firstCase = mismatchedPacket.cases[0];
    if (!firstCase) throw new Error('missing LLM packet case');
    firstCase.output.rationale = 'Changed after the run.';
    expect(
      evaluateLlmBaselineGate({ ...valid, reviewPacket: mismatchedPacket }).runBlockers,
    ).toContain('review-packet:output-mismatch:R01');
    expect(
      evaluateLlmBaselineGate({
        ...valid,
        rationaleReview: { ...valid.rationaleReview, reviewedCommit: 'f'.repeat(40) },
      }).rationaleReview.blockers,
    ).toContain('rationale-review:artifact-binding-mismatch');
    const changedDecisionReview = structuredClone(valid.rationaleReview);
    const firstReview = changedDecisionReview.cases[0];
    if (!firstReview) throw new Error('missing rationale review case');
    firstReview.modelDecision =
      firstReview.modelDecision === 'DENY' ? ('ALLOW' as const) : ('DENY' as const);
    expect(
      evaluateLlmBaselineGate({ ...valid, rationaleReview: changedDecisionReview }).rationaleReview
        .blockers,
    ).toContain('rationale-review:model-decision-mismatch:R01');
    const inconsistentResult = structuredClone(valid.result);
    const firstOutput = inconsistentResult.outputs[0];
    if (!firstOutput) throw new Error('missing LLM result row');
    firstOutput.exactMatch = false;
    inconsistentResult.exactMatches = 19;
    expect(evaluateLlmBaselineGate({ ...valid, result: inconsistentResult }).runBlockers).toContain(
      'result:invalid',
    );
    const changedMetadataResult = structuredClone(valid.result);
    const changedMetadataOutput = changedMetadataResult.outputs[0];
    if (!changedMetadataOutput) throw new Error('missing LLM result row');
    changedMetadataOutput.split = 'HIDDEN_TEST';
    changedMetadataOutput.class = changedMetadataOutput.class === 'BASE' ? 'ADVERSARIAL' : 'BASE';
    expect(
      evaluateLlmBaselineGate({ ...valid, result: changedMetadataResult }).runBlockers,
    ).toContain('result:sample-mismatch:R01');
    const changedScoreResult = structuredClone(valid.result);
    const changedScoreOutput = changedScoreResult.outputs[0];
    if (!changedScoreOutput) throw new Error('missing LLM result row');
    changedScoreOutput.expectedDecision =
      changedScoreOutput.expectedDecision === 'DENY' ? 'ALLOW' : 'DENY';
    changedScoreOutput.exactMatch =
      changedScoreOutput.verdict.decision === changedScoreOutput.expectedDecision;
    changedScoreResult.exactMatches = changedScoreResult.outputs.filter(
      (output) => output.exactMatch,
    ).length;
    expect(evaluateLlmBaselineGate({ ...valid, result: changedScoreResult }).runBlockers).toContain(
      'result:score-mismatch:R01',
    );
  });

  it('allows an independent corrected decision to differ from the model decision', () => {
    const valid = validLlmGateInput();
    const corrected = structuredClone(valid.rationaleReview);
    const firstReview = corrected.cases[0];
    if (!firstReview) throw new Error('missing rationale review case');
    firstReview.correctedDecision =
      firstReview.modelDecision === 'DENY' ? ('ALLOW' as const) : ('DENY' as const);
    expect(evaluateLlmBaselineGate({ ...valid, rationaleReview: corrected })).toMatchObject({
      runStatus: 'COMPLETE',
      rationaleReview: { status: 'COMPLETE', blockers: [] },
    });
  });

  it('accepts disclosed AI rationale only under explicit solo mode and keeps artifact bindings', () => {
    const valid = validLlmGateInput();
    const ai = {
      ...valid.rationaleReview,
      protocolVersion: '0.2',
      reviewMode: 'SOLO_AI_ASSISTED',
      status: 'COMPLETE_AI_ASSISTED',
      reviewerType: 'AI',
      independenceAttestation: false,
      finalAuthorApproval: 'PENDING',
    };
    expect(evaluateLlmBaselineGate({ ...valid, rationaleReview: ai }).rationaleReview.status).toBe(
      'PENDING',
    );
    const soloInput = { ...valid, reviewMode: 'SOLO_AI_ASSISTED' as const, rationaleReview: ai };
    expect(evaluateLlmBaselineGate(soloInput).rationaleReview).toMatchObject({
      status: 'COMPLETE_AI_ASSISTED',
      reviewerType: 'AI',
      independenceAttestation: false,
      blockers: [],
    });
    for (const change of [
      { independenceAttestation: true },
      { reviewerType: 'HUMAN' },
      { finalAuthorApproval: 'APPROVED' },
      { resultSha256: 'f'.repeat(64) },
      { cases: ai.cases.slice(1) },
    ]) {
      expect(
        evaluateLlmBaselineGate({ ...soloInput, rationaleReview: { ...ai, ...change } })
          .rationaleReview.status,
      ).toBe('PENDING');
    }
  });

  it('requires explicit solo mode for AI freeze review without claiming human approval', () => {
    const review = {
      ...approvedReview,
      schemaVersion: '0.3',
      reviewMode: 'SOLO_AI_ASSISTED',
      status: 'COMPLETE_AI_ASSISTED',
      reviewerType: 'AI',
      independenceAttestation: false,
      finalAuthorApproval: 'PENDING',
      independentHumanReviewClaim: false,
    };
    expect(() => validateApprovedFreezeReview(review, head, tree)).toThrow();
    expect(() => validateFreezeReviewForProtocol(review, head, tree)).toThrow();
    expect(validateFreezeReviewForProtocol(review, head, tree, 'SOLO_AI_ASSISTED')).toMatchObject({
      reviewerType: 'AI',
      finalAuthorApproval: 'PENDING',
      independenceAttestation: false,
    });
    for (const change of [
      { reviewedCommit: 'd'.repeat(40) },
      { independenceAttestation: true },
      { finalAuthorApproval: 'APPROVED' },
      { dryRunCases: 19 },
    ]) {
      expect(() =>
        validateFreezeReviewForProtocol({ ...review, ...change }, head, tree, 'SOLO_AI_ASSISTED'),
      ).toThrow();
    }
    expect(() =>
      validateFreezeReviewForProtocol(approvedReview, head, tree, 'SOLO_AI_ASSISTED'),
    ).toThrow();
  });

  it('permits solo reproducibility experiments while keeping M2 and human approval pending', () => {
    const validation = {
      ...completedM2,
      m2Complete: false,
      experimentReady: true,
      independentReviewStatus: 'PENDING',
      reviewProtocol: {
        schemaVersion: '0.1',
        mode: 'SOLO_AI_ASSISTED',
        finalAuthorApproval: 'PENDING',
        independentHumanReviewClaim: false,
      },
      independentReviewEvidence: {
        recordStatus: 'PENDING',
        submissionCount: 0,
        blockers: ['missing'],
      },
      aiAssistedReviewEvidence: {
        recordStatus: 'COMPLETE_AI_ASSISTED',
        reviewerType: 'AI',
        independenceAttestation: false,
        independentHumanReviewClaim: false,
        finalAuthorApproval: 'PENDING',
        scope: 'CONTRACT_CONDITIONED_REPRODUCIBILITY',
        submissionCount: 1,
        submissionSha256: sha,
        caseCount: 20,
        blockers: [],
      },
      llmBaselineEvidence: {
        ...completedLlmBaselineEvidence,
        rationaleReviewPath: 'experiments/configs/baselines/llm-verifier-20-ai-review-v0.4.0.json',
        rationaleReview: {
          ...completedLlmBaselineEvidence.rationaleReview,
          status: 'COMPLETE_AI_ASSISTED',
          reviewerType: 'AI',
          independenceAttestation: false,
        },
      },
    };
    expect(() => validateM2ReadyForFreeze(validation)).toThrow();
    expect(validateM2ReadyForFreeze(validation, 'SOLO_AI_ASSISTED')).toMatchObject({
      experimentReady: true,
      m2Complete: false,
      independentReviewStatus: 'PENDING',
    });
    for (const change of [
      { reviewProtocol: undefined },
      { experimentReady: false },
      { m2Complete: true },
      { syntheticReferenceDisagreementCount: 1 },
      { executedBaseCount: 79 },
      {
        aiAssistedReviewEvidence: {
          ...validation.aiAssistedReviewEvidence,
          submissionSha256: null,
        },
      },
      { aiAssistedReviewEvidence: { ...validation.aiAssistedReviewEvidence, caseCount: 19 } },
    ]) {
      expect(() =>
        validateM2ReadyForFreeze({ ...validation, ...change }, 'SOLO_AI_ASSISTED'),
      ).toThrow();
    }
    expect(() => validateM2ReadyForFreeze(completedM2, 'SOLO_AI_ASSISTED')).toThrow();
    const derived = deriveM2Completion({
      ...completedM2,
      reviewMode: 'SOLO_AI_ASSISTED',
      aiBenchmarkReviewStatus: 'COMPLETE_AI_ASSISTED',
      finalAuthorApproval: 'PENDING',
      executionEvidenceStatus: 'CLEAN_COMMITTED_CANDIDATE',
      baseReferenceLabelDisagreementCount: 0,
      reviewGateStatus: 'PENDING',
      llmBaselineRunStatus: 'COMPLETE',
      llmRationaleReviewStatus: 'COMPLETE_AI_ASSISTED',
    });
    expect(derived).toMatchObject({
      experimentReady: true,
      m2Complete: false,
      independentReviewStatus: 'PENDING',
    });
  });

  it('requires real human approval for the exact candidate and at least twenty dry runs', () => {
    expect(validateApprovedFreezeReview(approvedReview, head, tree)).toMatchObject({
      status: 'APPROVED',
      reviewedCommit: head,
      dryRunCases: 20,
    });
    expect(() =>
      validateApprovedFreezeReview(
        {
          ...approvedReview,
          reviewedCommit: 'b'.repeat(40),
          dryRunEvidence: { ...approvedReview.dryRunEvidence, candidateCommit: 'b'.repeat(40) },
        },
        head,
      ),
    ).toThrow('candidate HEAD');
    expect(() => validateApprovedFreezeReview(approvedReview, head, 'f'.repeat(40))).toThrow(
      'candidate tree',
    );
    expect(() =>
      validateApprovedFreezeReview(
        {
          ...approvedReview,
          dryRunEvidence: { ...approvedReview.dryRunEvidence, candidateCommit: 'f'.repeat(40) },
        },
        head,
      ),
    ).toThrow('reviewed commit');
    expect(() =>
      validateApprovedFreezeReview({ ...approvedReview, dryRunCases: 19 }, head),
    ).toThrow();
    const withoutDryRunEvidence: Record<string, unknown> = { ...approvedReview };
    delete withoutDryRunEvidence.dryRunEvidence;
    expect(() => validateApprovedFreezeReview(withoutDryRunEvidence, head)).toThrow();
    expect(() =>
      validateApprovedFreezeReview({ ...approvedReview, schemaVersion: '0.1' }, head),
    ).toThrow();
    expect(() =>
      validateApprovedFreezeReview(
        {
          ...approvedReview,
          dryRunEvidence: {
            ...approvedReview.dryRunEvidence,
            outputDirectory: 'experiments/results/freeze-dry-runs/nested/freeze-review-test',
          },
        },
        head,
      ),
    ).toThrow('direct child');
    expect(() =>
      validateApprovedFreezeReview(
        {
          ...approvedReview,
          reproducedCases: approvedReview.reproducedCases.map((reviewCase, index) =>
            index === 0 ? { ...reviewCase, reproduced: false } : reviewCase,
          ),
        },
        head,
      ),
    ).toThrow();
  });

  it('binds the reviewed IDs to the preregistered workflow/variant-stratified manifest cases', () => {
    const manifest = JSON.parse(readFileSync('experiments/configs/case-manifest.json', 'utf8')) as {
      entries: unknown[];
    };
    expect(() => {
      validateFreezeReviewCaseManifest(FREEZE_REVIEW_CASE_IDS, manifest.entries);
    }).not.toThrow();
    expect(() => {
      validateFreezeReviewCaseManifest(
        [...FREEZE_REVIEW_CASE_IDS.slice(0, -1), 'MISSING--BENIGN_DRIFT'],
        manifest.entries,
      );
    }).toThrow('absent from the case manifest');
  });

  it('permits only the direct A-to-B six-file freeze transition', () => {
    const executionCommit = 'b'.repeat(40);
    const dryRunEvidenceDirectory = approvedReview.dryRunEvidence.outputDirectory;
    const changedPaths = [
      FROZEN_EVALUATION_CONFIG_PATH,
      FROZEN_ABLATION_CONFIG_PATH,
      'experiments/reviews/reviewer-a.json',
      `${dryRunEvidenceDirectory}/manifest.json`,
      `${dryRunEvidenceDirectory}/cases.jsonl`,
      `${dryRunEvidenceDirectory}/summary.json`,
    ];
    expect(
      validateFreezeTransition({
        reviewedCommit: head,
        executionCommit,
        parentCommits: [head],
        changedPaths,
        humanReviewPath: 'experiments/reviews/reviewer-a.json',
        dryRunEvidenceDirectory,
      }),
    ).toMatchObject({ reviewedCommit: head, executionCommit });
    expect(() =>
      validateFreezeTransition({
        reviewedCommit: head,
        executionCommit,
        parentCommits: [head],
        changedPaths: [...changedPaths, 'src/experiments/metrics.ts'],
        humanReviewPath: 'experiments/reviews/reviewer-a.json',
        dryRunEvidenceDirectory,
      }),
    ).toThrow('may change only');
    expect(() =>
      validateFreezeTransition({
        reviewedCommit: head,
        executionCommit,
        parentCommits: [head],
        changedPaths: changedPaths.filter(
          (path) => !path.startsWith(`${dryRunEvidenceDirectory}/`),
        ),
        humanReviewPath: 'experiments/reviews/reviewer-a.json',
        dryRunEvidenceDirectory,
      }),
    ).toThrow('three dry-run artifacts');
    expect(() =>
      validateFreezeTransition({
        reviewedCommit: head,
        executionCommit,
        parentCommits: ['c'.repeat(40)],
        changedPaths,
        humanReviewPath: 'experiments/reviews/reviewer-a.json',
        dryRunEvidenceDirectory,
      }),
    ).toThrow('only direct parent');
  });

  it('requires complete clean M2 execution and complete independent review', () => {
    expect(validateM2ReadyForFreeze(completedM2)).toMatchObject({ m2Complete: true });
    expect(
      validateM2ReadyForFreeze({
        ...completedM2,
        reviewProtocol: { schemaVersion: '0.1', mode: 'DUAL_HUMAN' },
      }),
    ).toMatchObject({ m2Complete: true });
    expect(() =>
      validateM2ReadyForFreeze({ ...completedM2, independentReviewStatus: 'PENDING' }),
    ).toThrow('M2 is not freeze-ready');
    expect(() =>
      validateM2ReadyForFreeze({ ...completedM2, cleanCommittedExecutedBaseCount: 79 }),
    ).toThrow('M2 is not freeze-ready');
    expect(() =>
      validateM2ReadyForFreeze({ ...completedM2, syntheticReferenceDisagreementCount: 1 }),
    ).toThrow('M2 is not freeze-ready');
    expect(() =>
      validateM2ReadyForFreeze({ ...completedM2, syntheticReferenceCheckedCount: 79 }),
    ).toThrow('M2 is not freeze-ready');
    expect(() =>
      validateM2ReadyForFreeze({
        ...completedM2,
        llmBaselineEvidence: {
          ...completedLlmBaselineEvidence,
          resultPath: 'experiments/results/baselines/stale.json',
        },
      }),
    ).toThrow();
    expect(() =>
      validateM2ReadyForFreeze({
        ...completedM2,
        llmBaselineEvidence: {
          ...completedLlmBaselineEvidence,
          rationaleReview: {
            ...completedLlmBaselineEvidence.rationaleReview,
            status: 'PENDING',
          },
        },
      }),
    ).toThrow('M2 is not freeze-ready');
    for (const rationaleReview of [
      { ...completedLlmBaselineEvidence.rationaleReview, reviewerPseudonym: null },
      { ...completedLlmBaselineEvidence.rationaleReview, reviewerType: null },
      { ...completedLlmBaselineEvidence.rationaleReview, independenceAttestation: null },
      { ...completedLlmBaselineEvidence.rationaleReview, reviewedAt: null },
    ]) {
      expect(() =>
        validateM2ReadyForFreeze({
          ...completedM2,
          llmBaselineEvidence: { ...completedLlmBaselineEvidence, rationaleReview },
        }),
      ).toThrow('M2 is not freeze-ready');
    }
    const withoutSyntheticCount: Partial<typeof completedM2> = { ...completedM2 };
    delete withoutSyntheticCount.syntheticReferenceDisagreementCount;
    expect(() => validateM2ReadyForFreeze(withoutSyntheticCount)).toThrow();
    const withoutSyntheticChecked: Partial<typeof completedM2> = { ...completedM2 };
    delete withoutSyntheticChecked.syntheticReferenceCheckedCount;
    expect(() => validateM2ReadyForFreeze(withoutSyntheticChecked)).toThrow();
  });

  it('rejects the repository current pending M2 state and pending review template', () => {
    const currentM2: unknown = JSON.parse(
      readFileSync('experiments/configs/m2-validation.json', 'utf8'),
    );
    const reviewTemplate: unknown = JSON.parse(
      readFileSync('experiments/configs/freeze-review.template.json', 'utf8'),
    );
    expect(() => validateM2ReadyForFreeze(currentM2)).toThrow();
    expect(AnyFreezeReviewRecordSchema.parse(reviewTemplate)).toMatchObject({
      status: 'PENDING',
      dryRunCases: 0,
    });
    expect(() => validateApprovedFreezeReview(reviewTemplate, head)).toThrow();
  });

  it('refuses absolute and traversal paths', () => {
    expect(() => resolveRepoRelativeJson(process.cwd(), '../review.json')).toThrow();
    expect(() => resolveRepoRelativeJson(process.cwd(), 'C:/review.json')).toThrow();
    expect(resolveRepoRelativeJson(process.cwd(), 'experiments/reviews/review.json').path).toBe(
      'experiments/reviews/review.json',
    );
  });
});
