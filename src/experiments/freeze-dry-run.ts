import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { z } from 'zod';

import type { BenchmarkScenario } from '../benchmark/scenario.js';
import type { EvaluationCaseManifestEntry } from './case-matrix.js';
import { evaluateCase, RawEvaluationResultSchema } from './evaluate-case.js';
import {
  AcceptedFreezeReviewRecordSchema,
  FREEZE_REVIEW_CASE_IDS,
  AnyFreezeReviewRecordSchema,
  validateFreezeReviewCaseManifest,
} from './freeze-gates.js';
import { sha256Text } from './protocol.js';

const GitCommitSchema = z.string().regex(/^[a-f0-9]{40}$/);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const RunIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,99}$/);

export const FREEZE_DRY_RUN_SYSTEMS = [
  'NONE',
  'GUARD_MODE',
  'PER_CALL_POLICY',
  'INTENTLOCK',
] as const;

const FreezeDryRunSystemSchema = z.enum(FREEZE_DRY_RUN_SYSTEMS);
const EffectiveDecisionSchema = z.enum(['ALLOW', 'DENY', 'ESCALATE']);
const FreezeDryRunCaseIdSchema = z.enum(FREEZE_REVIEW_CASE_IDS);

const ExactFreezeDryRunIdsSchema = z
  .array(FreezeDryRunCaseIdSchema)
  .length(FREEZE_REVIEW_CASE_IDS.length)
  .superRefine((ids, context) => {
    if (new Set(ids).size !== FREEZE_REVIEW_CASE_IDS.length) {
      context.addIssue({ code: 'custom', message: 'freeze dry-run case IDs must be unique' });
    }
    if (ids.some((id, index) => id !== FREEZE_REVIEW_CASE_IDS[index])) {
      context.addIssue({
        code: 'custom',
        message: 'freeze dry-run case IDs must preserve the preregistered template order',
      });
    }
  });

const SystemResultSchema = z
  .object({
    system: FreezeDryRunSystemSchema,
    result: RawEvaluationResultSchema,
  })
  .strict();

export const FreezeDryRunCaseEvidenceSchema = z
  .object({
    schemaVersion: z.literal('0.1'),
    evidenceType: z.literal('PRE_FREEZE_DETERMINISTIC_CASE'),
    claimScope: z.literal('OFFLINE_DETERMINISTIC_COUNTERFACTUAL_REPLAY_ONLY'),
    runId: RunIdSchema,
    candidateCommit: GitCommitSchema,
    caseId: FreezeDryRunCaseIdSchema,
    baseScenarioId: z.string().min(1),
    variant: z.string().min(1),
    workflow: z.string().min(1),
    class: z.string().min(1),
    split: z.string().min(1),
    scenarioSha256: Sha256Schema,
    oracleExpectedDecision: EffectiveDecisionSchema,
    subjectSystem: z.literal('INTENTLOCK'),
    subjectObservedDecision: EffectiveDecisionSchema.nullable(),
    machineExpectationStatus: z.enum(['MATCH', 'MISMATCH', 'EVALUATION_FAILURE']),
    expectedMatch: z.boolean(),
    deterministicResults: z.array(SystemResultSchema).length(FREEZE_DRY_RUN_SYSTEMS.length),
    humanReviewPerformed: z.literal(false),
    humanApprovalProvided: z.literal(false),
    reviewerFieldsPopulated: z.literal(false),
  })
  .strict()
  .superRefine((evidence, context) => {
    const systems = evidence.deterministicResults.map((entry) => entry.system);
    if (
      systems.some((system, index) => system !== FREEZE_DRY_RUN_SYSTEMS[index]) ||
      new Set(systems).size !== FREEZE_DRY_RUN_SYSTEMS.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['deterministicResults'],
        message: 'deterministic systems must appear exactly once in preregistered order',
      });
    }
    for (const systemResult of evidence.deterministicResults) {
      if (
        systemResult.result.record.system !== systemResult.system ||
        systemResult.result.record.runId !== evidence.runId ||
        systemResult.result.record.caseId !== evidence.caseId ||
        systemResult.result.record.baseScenarioId !== evidence.baseScenarioId ||
        systemResult.result.record.workflow !== evidence.workflow ||
        systemResult.result.record.class !== evidence.class ||
        systemResult.result.record.split !== evidence.split ||
        systemResult.result.variant !== evidence.variant ||
        systemResult.result.scenarioSha256 !== evidence.scenarioSha256 ||
        systemResult.result.oracleExpectedDecision !== evidence.oracleExpectedDecision
      ) {
        context.addIssue({
          code: 'custom',
          path: ['deterministicResults'],
          message:
            'nested deterministic result provenance/oracle does not match its case and system',
        });
      }
    }
    const subject = evidence.deterministicResults.find((entry) => entry.system === 'INTENTLOCK');
    if (!subject) return;
    const failed = isEvaluationFailure(subject.result);
    const observed = failed ? null : effectiveDecision(subject.result);
    const expectedMatch = observed === evidence.oracleExpectedDecision;
    if (
      evidence.subjectObservedDecision !== observed ||
      evidence.expectedMatch !== expectedMatch ||
      evidence.machineExpectationStatus !==
        (failed ? 'EVALUATION_FAILURE' : expectedMatch ? 'MATCH' : 'MISMATCH')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['machineExpectationStatus'],
        message: 'machine expectation fields must be derived from the IntentLock result',
      });
    }
  });

export const FreezeDryRunManifestSchema = z
  .object({
    schemaVersion: z.literal('0.1'),
    artifactKind: z.literal('PRE_FREEZE_DETERMINISTIC_DRY_RUN'),
    claimScope: z.literal('OFFLINE_DETERMINISTIC_COUNTERFACTUAL_REPLAY_ONLY'),
    runId: RunIdSchema,
    createdAt: z.iso.datetime(),
    evaluatedAt: z.iso.datetime(),
    candidateStatus: z.literal('CANDIDATE_UNFROZEN'),
    candidateCommit: GitCommitSchema,
    candidateTree: GitCommitSchema,
    repositoryCleanAtStart: z.literal(true),
    repositoryCleanBeforeWrite: z.literal(true),
    sourcePaths: z
      .object({
        evaluationConfig: z.literal('experiments/configs/frozen-eval.yaml'),
        caseManifest: z.literal('experiments/configs/case-manifest.json'),
        reviewTemplate: z.literal('experiments/configs/freeze-review.template.json'),
      })
      .strict(),
    sourceDigestsSha256: z
      .object({
        evaluationConfig: Sha256Schema,
        caseManifest: Sha256Schema,
        reviewTemplate: Sha256Schema,
        exactCaseSet: Sha256Schema,
      })
      .strict(),
    caseCount: z.literal(FREEZE_REVIEW_CASE_IDS.length),
    caseIds: ExactFreezeDryRunIdsSchema,
    deterministicSystems: z.tuple([
      z.literal(FREEZE_DRY_RUN_SYSTEMS[0]),
      z.literal(FREEZE_DRY_RUN_SYSTEMS[1]),
      z.literal(FREEZE_DRY_RUN_SYSTEMS[2]),
      z.literal(FREEZE_DRY_RUN_SYSTEMS[3]),
    ]),
    excludedSystems: z.tuple([
      z
        .object({
          system: z.literal('LLM_VERIFIER'),
          reason: z.literal('SECRET_OR_NETWORK_DEPENDENT_NOT_PART_OF_DETERMINISTIC_DRY_RUN'),
        })
        .strict(),
    ]),
    networkAccessRequired: z.literal(false),
    secretAccessRequired: z.literal(false),
    subjectSystem: z.literal('INTENTLOCK'),
    machineMatchCount: z.number().int().min(0).max(FREEZE_REVIEW_CASE_IDS.length),
    machineMismatchCaseIds: z.array(FreezeDryRunCaseIdSchema),
    machineFailureCaseIds: z.array(FreezeDryRunCaseIdSchema),
    casesJsonlSha256: Sha256Schema,
    humanReviewStatus: z.literal('NOT_PERFORMED'),
    humanReviewRecordProduced: z.literal(false),
    humanApprovalProvided: z.literal(false),
    outputDirectory: z.string().min(1),
    outputFiles: z
      .object({
        manifest: z.literal('manifest.json'),
        cases: z.literal('cases.jsonl'),
        summary: z.literal('summary.json'),
      })
      .strict(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const blockerIds = [...manifest.machineMismatchCaseIds, ...manifest.machineFailureCaseIds];
    if (
      new Set(blockerIds).size !== blockerIds.length ||
      manifest.machineMatchCount + blockerIds.length !== FREEZE_REVIEW_CASE_IDS.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['machineMatchCount'],
        message:
          'machine match, mismatch, and failure aggregates must partition the exact 20 cases',
      });
    }
  });

export const FreezeDryRunSummarySchema = z
  .object({
    schemaVersion: z.literal('0.1'),
    runId: RunIdSchema,
    candidateCommit: GitCommitSchema,
    caseCount: z.literal(FREEZE_REVIEW_CASE_IDS.length),
    machineMatchCount: z.number().int().min(0).max(FREEZE_REVIEW_CASE_IDS.length),
    machineMismatchCaseIds: z.array(FreezeDryRunCaseIdSchema),
    machineFailureCaseIds: z.array(FreezeDryRunCaseIdSchema),
    allMachineExpectationsMatched: z.boolean(),
    humanReviewStatus: z.literal('NOT_PERFORMED'),
    humanApprovalProvided: z.literal(false),
    reviewerAction: z.literal(
      'COPY_AND_COMPLETE_FREEZE_REVIEW_TEMPLATE_SEPARATELY_AFTER_CASE_BY_CASE_HUMAN_REVIEW',
    ),
    freezeReadinessClaim: z.literal(false),
  })
  .strict()
  .superRefine((summary, context) => {
    const blockerIds = [...summary.machineMismatchCaseIds, ...summary.machineFailureCaseIds];
    if (
      new Set(blockerIds).size !== blockerIds.length ||
      summary.machineMatchCount + blockerIds.length !== FREEZE_REVIEW_CASE_IDS.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['machineMatchCount'],
        message:
          'machine match, mismatch, and failure aggregates must partition the exact 20 cases',
      });
    }
    const expectedAllMatched =
      summary.machineMatchCount === FREEZE_REVIEW_CASE_IDS.length && blockerIds.length === 0;
    if (summary.allMachineExpectationsMatched !== expectedAllMatched) {
      context.addIssue({
        code: 'custom',
        path: ['allMachineExpectationsMatched'],
        message: 'all-machine-match status must be derived from the exact-20 aggregates',
      });
    }
  });

export type FreezeDryRunCaseEvidence = z.infer<typeof FreezeDryRunCaseEvidenceSchema>;
export type FreezeDryRunManifest = z.infer<typeof FreezeDryRunManifestSchema>;
export type FreezeDryRunSummary = z.infer<typeof FreezeDryRunSummarySchema>;

export interface FreezeDryRunCaseInput {
  entry: EvaluationCaseManifestEntry;
  scenario: BenchmarkScenario;
}

export interface CreateFreezeDryRunOptions {
  runId: string;
  createdAt: string;
  evaluatedAt: string;
  candidateCommit: string;
  candidateTree: string;
  outputDirectory: string;
  configSource: string;
  caseManifestSource: string;
  reviewTemplateSource: string;
  reviewTemplate: unknown;
  manifestEntries: unknown;
  cases: readonly FreezeDryRunCaseInput[];
}

export interface FreezeDryRunArtifacts {
  manifest: FreezeDryRunManifest;
  cases: FreezeDryRunCaseEvidence[];
  casesJsonl: string;
  summary: FreezeDryRunSummary;
}

export interface FreezeDryRunArtifactSources {
  manifestSource: string;
  casesSource: string;
  summarySource: string;
}

export interface FreezeDryRunReviewValidationInput extends FreezeDryRunArtifactSources {
  evaluationConfigSource: string;
  caseManifestSource: string;
  reviewTemplateSource: string;
  expectedCandidateCommit: string;
  expectedCandidateTree: string;
  expectedCases: readonly FreezeDryRunCaseInput[];
}

export function freezeDryRunArtifactSources(
  artifacts: FreezeDryRunArtifacts,
): FreezeDryRunArtifactSources {
  return {
    manifestSource: `${JSON.stringify(artifacts.manifest, null, 2)}\n`,
    casesSource: artifacts.casesJsonl,
    summarySource: `${JSON.stringify(artifacts.summary, null, 2)}\n`,
  };
}

/**
 * Machine agreement is only the prerequisite for human review, never human approval. A mismatch
 * or evaluation failure makes the command fail after its immutable diagnostic evidence is written.
 */
export function assertFreezeDryRunMachineGate(summaryInput: unknown): void {
  const summary = FreezeDryRunSummarySchema.parse(summaryInput);
  if (!summary.allMachineExpectationsMatched) {
    const blockers = [
      ...summary.machineMismatchCaseIds.map((caseId) => `${caseId}:MISMATCH`),
      ...summary.machineFailureCaseIds.map((caseId) => `${caseId}:EVALUATION_FAILURE`),
    ];
    throw new Error(
      `pre-freeze machine gate is blocked; investigate and commit a new candidate before human approval (${blockers.join(', ')})`,
    );
  }
}

/** Writes a new evidence directory without ever replacing an earlier dry-run artifact. */
export async function writeFreezeDryRunArtifacts(
  outputPath: string,
  artifacts: FreezeDryRunArtifacts,
): Promise<void> {
  const sources = freezeDryRunArtifactSources(artifacts);
  await mkdir(dirname(outputPath), { recursive: true });
  try {
    await mkdir(outputPath);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      throw new Error(
        'freeze dry-run output already exists; choose a new append-only --out directory',
        { cause: error },
      );
    }
    throw error;
  }
  await writeFile(resolve(outputPath, 'cases.jsonl'), sources.casesSource, {
    encoding: 'utf8',
    flag: 'wx',
  });
  await writeFile(resolve(outputPath, 'manifest.json'), sources.manifestSource, {
    encoding: 'utf8',
    flag: 'wx',
  });
  await writeFile(resolve(outputPath, 'summary.json'), sources.summarySource, {
    encoding: 'utf8',
    flag: 'wx',
  });
}

/**
 * Revalidates the immutable machine evidence that an approved human record names. The record binds
 * exact bytes; this function then checks that those bytes describe the same candidate and exact 20
 * cases. Human fields remain inputs and are never derived from machine output.
 */
export function validateFreezeDryRunReviewEvidence(
  reviewInput: unknown,
  input: FreezeDryRunReviewValidationInput,
): {
  manifest: FreezeDryRunManifest;
  cases: FreezeDryRunCaseEvidence[];
  summary: FreezeDryRunSummary;
} {
  const review = AcceptedFreezeReviewRecordSchema.parse(reviewInput);
  const expectedCommit = GitCommitSchema.parse(input.expectedCandidateCommit);
  const expectedTree = GitCommitSchema.parse(input.expectedCandidateTree);
  const binding = review.dryRunEvidence;

  const byteDigests = {
    manifestSha256: sha256Text(input.manifestSource),
    casesJsonlSha256: sha256Text(input.casesSource),
    summarySha256: sha256Text(input.summarySource),
  };
  for (const [key, actual] of Object.entries(byteDigests)) {
    if (binding[key as keyof typeof byteDigests] !== actual) {
      throw new Error(`freeze dry-run ${key} does not match the approved review binding`);
    }
  }

  const manifest = FreezeDryRunManifestSchema.parse(JSON.parse(input.manifestSource));
  const summary = FreezeDryRunSummarySchema.parse(JSON.parse(input.summarySource));
  const caseLines = input.casesSource.split(/\r?\n/u);
  if (caseLines.at(-1) === '') caseLines.pop();
  if (caseLines.length !== FREEZE_REVIEW_CASE_IDS.length || caseLines.some((line) => !line)) {
    throw new Error('freeze dry-run cases.jsonl must contain exactly 20 non-empty JSON lines');
  }
  const cases = caseLines.map((line) => FreezeDryRunCaseEvidenceSchema.parse(JSON.parse(line)));

  const expectedCases = new Map(
    input.expectedCases.map((expected) => [expected.entry.caseId, expected] as const),
  );
  if (
    expectedCases.size !== FREEZE_REVIEW_CASE_IDS.length ||
    input.expectedCases.length !== FREEZE_REVIEW_CASE_IDS.length
  ) {
    throw new Error('freeze dry-run validation requires the regenerated exact 20 candidate cases');
  }

  if (
    binding.candidateCommit !== expectedCommit ||
    manifest.candidateCommit !== expectedCommit ||
    summary.candidateCommit !== expectedCommit
  ) {
    throw new Error('freeze dry-run evidence is not bound to the reviewed candidate commit');
  }
  if (binding.candidateTree !== expectedTree || manifest.candidateTree !== expectedTree) {
    throw new Error('freeze dry-run evidence is not bound to the reviewed candidate tree');
  }
  if (
    binding.runId !== manifest.runId ||
    binding.runId !== summary.runId ||
    binding.outputDirectory !== manifest.outputDirectory
  ) {
    throw new Error('freeze dry-run run ID or output directory does not match the review binding');
  }
  if (manifest.casesJsonlSha256 !== byteDigests.casesJsonlSha256) {
    throw new Error('freeze dry-run manifest does not bind the reviewed cases.jsonl bytes');
  }

  const expectedSourceDigests = {
    evaluationConfig: sha256Text(input.evaluationConfigSource),
    caseManifest: sha256Text(input.caseManifestSource),
    reviewTemplate: sha256Text(input.reviewTemplateSource),
    exactCaseSet: sha256Text(JSON.stringify(FREEZE_REVIEW_CASE_IDS)),
  };
  if (JSON.stringify(manifest.sourceDigestsSha256) !== JSON.stringify(expectedSourceDigests)) {
    throw new Error('freeze dry-run source digests do not match the reviewed candidate inputs');
  }

  const caseIds = cases.map((entry) => entry.caseId);
  const reviewedIds = [...review.reviewedCaseIds];
  const reproducedIds = review.reproducedCases.map((entry) => entry.caseId);
  if (
    JSON.stringify(manifest.caseIds) !== JSON.stringify(FREEZE_REVIEW_CASE_IDS) ||
    JSON.stringify(caseIds) !== JSON.stringify(FREEZE_REVIEW_CASE_IDS) ||
    JSON.stringify(reviewedIds) !== JSON.stringify(FREEZE_REVIEW_CASE_IDS) ||
    JSON.stringify(reproducedIds) !== JSON.stringify(FREEZE_REVIEW_CASE_IDS)
  ) {
    throw new Error(
      'freeze dry-run machine and human evidence do not identify the same exact 20 cases',
    );
  }
  for (const [index, evidence] of cases.entries()) {
    const human = review.reproducedCases[index];
    const expected = expectedCases.get(evidence.caseId);
    if (!expected) throw new Error(`regenerated freeze case is absent: ${evidence.caseId}`);
    const expectedScenarioSha256 = sha256Text(JSON.stringify(expected.scenario));
    if (
      expected.entry.baseScenarioId !== evidence.baseScenarioId ||
      expected.entry.variant !== evidence.variant ||
      expected.entry.workflow !== evidence.workflow ||
      expected.entry.class !== evidence.class ||
      expected.entry.split !== evidence.split ||
      expected.entry.scenarioSha256 !== evidence.scenarioSha256 ||
      expectedScenarioSha256 !== evidence.scenarioSha256 ||
      expected.scenario.oracle.expectedDecision !== evidence.oracleExpectedDecision
    ) {
      throw new Error(
        `freeze dry-run case differs from the candidate scenario: ${evidence.caseId}`,
      );
    }
    if (
      evidence.runId !== binding.runId ||
      evidence.candidateCommit !== expectedCommit ||
      evidence.machineExpectationStatus !== 'MATCH' ||
      !evidence.expectedMatch ||
      !human?.reproduced ||
      human.caseId !== evidence.caseId
    ) {
      throw new Error(`freeze dry-run machine/human result mismatch for ${evidence.caseId}`);
    }
  }
  if (
    manifest.machineMatchCount !== FREEZE_REVIEW_CASE_IDS.length ||
    manifest.machineMismatchCaseIds.length > 0 ||
    manifest.machineFailureCaseIds.length > 0 ||
    summary.machineMatchCount !== manifest.machineMatchCount ||
    JSON.stringify(summary.machineMismatchCaseIds) !==
      JSON.stringify(manifest.machineMismatchCaseIds) ||
    JSON.stringify(summary.machineFailureCaseIds) !== JSON.stringify(manifest.machineFailureCaseIds)
  ) {
    throw new Error('freeze dry-run manifest and summary do not prove a blocker-free exact-20 run');
  }
  assertFreezeDryRunMachineGate(summary);
  return { manifest, cases, summary };
}

function isEvaluationFailure(result: z.infer<typeof RawEvaluationResultSchema>): boolean {
  return (
    result.verdict.reasonCodes.includes('EVALUATION_FAILURE') ||
    result.record.executionStatus === 'FAILED' ||
    result.record.executionStatus === 'TIMEOUT'
  );
}

/** Maps a full pre-sign plus post-state monitor result onto the authored oracle vocabulary. */
export function effectiveDecision(
  result: z.infer<typeof RawEvaluationResultSchema>,
): z.infer<typeof EffectiveDecisionSchema> {
  if (result.record.preSignDecision === 'DENY') return 'DENY';
  if (result.record.preSignDecision === 'ABSTAIN') return 'ESCALATE';
  if (result.postStateMonitorDecision === 'DENY') return 'DENY';
  if (result.postStateMonitorDecision === 'ABSTAIN') return 'ESCALATE';
  return 'ALLOW';
}

export function validatePendingFreezeReviewTemplate(input: unknown): readonly string[] {
  const template = AnyFreezeReviewRecordSchema.parse(input);
  const ids = ExactFreezeDryRunIdsSchema.parse(template.reviewedCaseIds);
  const reproducedIds = ExactFreezeDryRunIdsSchema.parse(
    template.reproducedCases.map((entry) => entry.caseId),
  );
  if (
    template.status !== 'PENDING' ||
    template.reviewedCommit !== null ||
    template.independenceAttestation ||
    template.reviewedAt !== null ||
    template.dryRunEvidence !== null ||
    template.dryRunCases !== 0 ||
    template.reproducedCases.some((entry) => entry.reproduced || entry.result !== 'INCONCLUSIVE') ||
    Object.values(template.checks).some(Boolean)
  ) {
    throw new Error('canonical freeze review template must contain only pending reviewer fields');
  }
  if (ids.some((id, index) => id !== reproducedIds[index])) {
    throw new Error('reviewed and reproduced template case IDs differ');
  }
  return ids;
}

function selectedCases(
  requestedIds: readonly string[],
  cases: readonly FreezeDryRunCaseInput[],
): FreezeDryRunCaseInput[] {
  if (new Set(cases.map(({ entry }) => entry.caseId)).size !== cases.length) {
    throw new Error('dry-run inputs contain duplicate case IDs');
  }
  return requestedIds.map((caseId) => {
    const selected = cases.find(({ entry }) => entry.caseId === caseId);
    if (!selected) throw new Error(`dry-run case is absent from regenerated matrix: ${caseId}`);
    return selected;
  });
}

/**
 * Replays the exact preregistered 20 cases through every secret-free deterministic primary system.
 * The machine match is descriptive evidence only and never populates a human review field.
 */
export async function createFreezeDryRunArtifacts(
  options: CreateFreezeDryRunOptions,
): Promise<FreezeDryRunArtifacts> {
  const runId = RunIdSchema.parse(options.runId);
  const candidateCommit = GitCommitSchema.parse(options.candidateCommit);
  const candidateTree = GitCommitSchema.parse(options.candidateTree);
  const createdAt = z.iso.datetime().parse(options.createdAt);
  const evaluatedAt = z.iso.datetime().parse(options.evaluatedAt);
  const requestedIds = validatePendingFreezeReviewTemplate(options.reviewTemplate);
  validateFreezeReviewCaseManifest(requestedIds, options.manifestEntries);
  const inputs = selectedCases(requestedIds, options.cases);

  const evidence: FreezeDryRunCaseEvidence[] = [];
  for (const { entry, scenario } of inputs) {
    const deterministicResults: z.infer<typeof SystemResultSchema>[] = [];
    for (const system of FREEZE_DRY_RUN_SYSTEMS) {
      deterministicResults.push({
        system,
        result: await evaluateCase({
          runId,
          system,
          scenario,
          entry,
          evaluatedAt,
        }),
      });
    }
    const subject = deterministicResults.find(({ system }) => system === 'INTENTLOCK');
    if (!subject) throw new Error(`IntentLock result is absent for ${entry.caseId}`);
    const failed = isEvaluationFailure(subject.result);
    const observed = failed ? null : effectiveDecision(subject.result);
    const expectedMatch = observed === scenario.oracle.expectedDecision;
    evidence.push(
      FreezeDryRunCaseEvidenceSchema.parse({
        schemaVersion: '0.1',
        evidenceType: 'PRE_FREEZE_DETERMINISTIC_CASE',
        claimScope: 'OFFLINE_DETERMINISTIC_COUNTERFACTUAL_REPLAY_ONLY',
        runId,
        candidateCommit,
        caseId: entry.caseId,
        baseScenarioId: entry.baseScenarioId,
        variant: entry.variant,
        workflow: entry.workflow,
        class: entry.class,
        split: entry.split,
        scenarioSha256: entry.scenarioSha256,
        oracleExpectedDecision: scenario.oracle.expectedDecision,
        subjectSystem: 'INTENTLOCK',
        subjectObservedDecision: observed,
        machineExpectationStatus: failed
          ? 'EVALUATION_FAILURE'
          : expectedMatch
            ? 'MATCH'
            : 'MISMATCH',
        expectedMatch,
        deterministicResults,
        humanReviewPerformed: false,
        humanApprovalProvided: false,
        reviewerFieldsPopulated: false,
      }),
    );
  }

  const casesJsonl = `${evidence.map((entry) => JSON.stringify(entry)).join('\n')}\n`;
  const mismatchIds = evidence
    .filter((entry) => entry.machineExpectationStatus === 'MISMATCH')
    .map((entry) => entry.caseId);
  const failureIds = evidence
    .filter((entry) => entry.machineExpectationStatus === 'EVALUATION_FAILURE')
    .map((entry) => entry.caseId);
  const machineMatchCount = evidence.filter(
    (entry) => entry.machineExpectationStatus === 'MATCH',
  ).length;
  const manifest = FreezeDryRunManifestSchema.parse({
    schemaVersion: '0.1',
    artifactKind: 'PRE_FREEZE_DETERMINISTIC_DRY_RUN',
    claimScope: 'OFFLINE_DETERMINISTIC_COUNTERFACTUAL_REPLAY_ONLY',
    runId,
    createdAt,
    evaluatedAt,
    candidateStatus: 'CANDIDATE_UNFROZEN',
    candidateCommit,
    candidateTree,
    repositoryCleanAtStart: true,
    repositoryCleanBeforeWrite: true,
    sourcePaths: {
      evaluationConfig: 'experiments/configs/frozen-eval.yaml',
      caseManifest: 'experiments/configs/case-manifest.json',
      reviewTemplate: 'experiments/configs/freeze-review.template.json',
    },
    sourceDigestsSha256: {
      evaluationConfig: sha256Text(options.configSource),
      caseManifest: sha256Text(options.caseManifestSource),
      reviewTemplate: sha256Text(options.reviewTemplateSource),
      exactCaseSet: sha256Text(JSON.stringify(requestedIds)),
    },
    caseCount: FREEZE_REVIEW_CASE_IDS.length,
    caseIds: requestedIds,
    deterministicSystems: FREEZE_DRY_RUN_SYSTEMS,
    excludedSystems: [
      {
        system: 'LLM_VERIFIER',
        reason: 'SECRET_OR_NETWORK_DEPENDENT_NOT_PART_OF_DETERMINISTIC_DRY_RUN',
      },
    ],
    networkAccessRequired: false,
    secretAccessRequired: false,
    subjectSystem: 'INTENTLOCK',
    machineMatchCount,
    machineMismatchCaseIds: mismatchIds,
    machineFailureCaseIds: failureIds,
    casesJsonlSha256: sha256Text(casesJsonl),
    humanReviewStatus: 'NOT_PERFORMED',
    humanReviewRecordProduced: false,
    humanApprovalProvided: false,
    outputDirectory: options.outputDirectory,
    outputFiles: {
      manifest: 'manifest.json',
      cases: 'cases.jsonl',
      summary: 'summary.json',
    },
  });
  const summary = FreezeDryRunSummarySchema.parse({
    schemaVersion: '0.1',
    runId,
    candidateCommit,
    caseCount: FREEZE_REVIEW_CASE_IDS.length,
    machineMatchCount,
    machineMismatchCaseIds: mismatchIds,
    machineFailureCaseIds: failureIds,
    allMachineExpectationsMatched: mismatchIds.length === 0 && failureIds.length === 0,
    humanReviewStatus: 'NOT_PERFORMED',
    humanApprovalProvided: false,
    reviewerAction:
      'COPY_AND_COMPLETE_FREEZE_REVIEW_TEMPLATE_SEPARATELY_AFTER_CASE_BY_CASE_HUMAN_REVIEW',
    freezeReadinessClaim: false,
  });
  return { manifest, cases: evidence, casesJsonl, summary };
}
