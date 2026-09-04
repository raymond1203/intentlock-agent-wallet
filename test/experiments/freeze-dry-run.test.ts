import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { parse } from 'yaml';
import { beforeAll, describe, expect, it } from 'vitest';

import { BenchmarkScenarioSchema, type BenchmarkScenario } from '../../src/benchmark/scenario.js';
import { verifyCaseManifest } from '../../src/experiments/case-manifest.js';
import { createEvaluationCaseMatrix } from '../../src/experiments/case-matrix.js';
import {
  assertFreezeDryRunMachineGate,
  createFreezeDryRunArtifacts,
  FREEZE_DRY_RUN_SYSTEMS,
  freezeDryRunArtifactSources,
  FreezeDryRunCaseEvidenceSchema,
  FreezeDryRunManifestSchema,
  validateFreezeDryRunReviewEvidence,
  validatePendingFreezeReviewTemplate,
  writeFreezeDryRunArtifacts,
} from '../../src/experiments/freeze-dry-run.js';
import {
  FREEZE_REVIEW_CASE_IDS,
  validateApprovedFreezeReview,
} from '../../src/experiments/freeze-gates.js';
import { FrozenEvalConfigSchema } from '../../src/experiments/protocol.js';
import { sha256Text } from '../../src/experiments/protocol.js';
import { validateFreezeReviewEvidenceFromRepository } from '../../scripts/freeze-review-evidence.js';

function loadBaseScenarios(): BenchmarkScenario[] {
  const root = resolve(import.meta.dirname, '../../benchmark/scenarios/base');
  return readdirSync(root)
    .sort()
    .flatMap((directory) => {
      const directoryPath = resolve(root, directory);
      try {
        return readdirSync(directoryPath)
          .filter((name) => name.endsWith('.json'))
          .sort()
          .map((name) =>
            BenchmarkScenarioSchema.parse(
              JSON.parse(readFileSync(resolve(directoryPath, name), 'utf8')),
            ),
          );
      } catch {
        return [];
      }
    });
}

async function artifacts() {
  const configSource = readFileSync('experiments/configs/frozen-eval.yaml', 'utf8');
  const config = FrozenEvalConfigSchema.parse(parse(configSource));
  const caseManifestSource = readFileSync('experiments/configs/case-manifest.json', 'utf8');
  const caseManifest = JSON.parse(caseManifestSource) as unknown;
  const reviewTemplateSource = readFileSync(
    'experiments/configs/freeze-review.template.json',
    'utf8',
  );
  const matrix = createEvaluationCaseMatrix(loadBaseScenarios());
  const verified = verifyCaseManifest(caseManifest, matrix);
  return createFreezeDryRunArtifacts({
    runId: 'freeze-dry-run-test',
    createdAt: '2026-09-04T00:00:00.000Z',
    evaluatedAt: config.caseMatrix.evaluatedAt,
    candidateCommit: 'a'.repeat(40),
    candidateTree: 'b'.repeat(40),
    outputDirectory: 'experiments/results/freeze-dry-runs/freeze-dry-run-test',
    configSource,
    caseManifestSource,
    reviewTemplateSource,
    reviewTemplate: JSON.parse(reviewTemplateSource),
    manifestEntries: verified.entries,
    cases: matrix.entries.map((entry, index) => {
      const scenario = matrix.scenarios[index];
      if (!scenario) throw new Error(`missing scenario ${String(index)}`);
      return { entry, scenario };
    }),
  });
}

function approvedReview(result: Awaited<ReturnType<typeof artifacts>>) {
  const sources = freezeDryRunArtifactSources(result);
  return {
    schemaVersion: '0.2',
    status: 'APPROVED',
    reviewedCommit: result.manifest.candidateCommit,
    reviewerPseudonym: 'reviewer-test',
    reviewerType: 'HUMAN',
    independenceAttestation: true,
    reviewedAt: '2026-09-04T01:00:00.000Z',
    dryRunEvidence: {
      outputDirectory: result.manifest.outputDirectory,
      runId: result.manifest.runId,
      candidateCommit: result.manifest.candidateCommit,
      candidateTree: result.manifest.candidateTree,
      manifestSha256: sha256Text(sources.manifestSource),
      casesJsonlSha256: sha256Text(sources.casesSource),
      summarySha256: sha256Text(sources.summarySource),
    },
    dryRunCases: 20,
    reviewedCaseIds: [...FREEZE_REVIEW_CASE_IDS],
    reproducedCases: FREEZE_REVIEW_CASE_IDS.map((caseId) => ({
      caseId,
      reproduced: true,
      result: 'MATCHED_EXPECTATION',
      notes: 'Independently reproduced from the named machine evidence.',
    })),
    checks: {
      protocolConfigReviewed: true,
      implementationScopeReviewed: true,
      caseManifestReviewed: true,
      m2CompletionReviewed: true,
      retryPolicyReviewed: true,
    },
    notes: 'Independent human review completed; machine fields were copied without automation.',
  };
}

function reviewValidationInput(result: Awaited<ReturnType<typeof artifacts>>) {
  const matrix = createEvaluationCaseMatrix(loadBaseScenarios());
  const byId = new Map(
    matrix.entries.map((entry, index) => [
      entry.caseId,
      { entry, scenario: matrix.scenarios[index] },
    ]),
  );
  return {
    ...freezeDryRunArtifactSources(result),
    evaluationConfigSource: readFileSync('experiments/configs/frozen-eval.yaml', 'utf8'),
    caseManifestSource: readFileSync('experiments/configs/case-manifest.json', 'utf8'),
    reviewTemplateSource: readFileSync('experiments/configs/freeze-review.template.json', 'utf8'),
    expectedCandidateCommit: result.manifest.candidateCommit,
    expectedCandidateTree: result.manifest.candidateTree,
    expectedCases: FREEZE_REVIEW_CASE_IDS.map((caseId) => {
      const expected = byId.get(caseId);
      if (!expected?.scenario) throw new Error(`missing regenerated review case ${caseId}`);
      return { entry: expected.entry, scenario: expected.scenario };
    }),
  };
}

describe('pre-freeze exact-20 deterministic dry run', () => {
  let sharedArtifacts: Awaited<ReturnType<typeof artifacts>>;

  beforeAll(async () => {
    sharedArtifacts = await artifacts();
  }, 20_000);

  it('replays the exact stratified sample without producing human approval fields', () => {
    const result = sharedArtifacts;
    expect(result.manifest).toMatchObject({
      candidateStatus: 'CANDIDATE_UNFROZEN',
      candidateCommit: 'a'.repeat(40),
      candidateTree: 'b'.repeat(40),
      caseCount: 20,
      caseIds: FREEZE_REVIEW_CASE_IDS,
      deterministicSystems: FREEZE_DRY_RUN_SYSTEMS,
      networkAccessRequired: false,
      secretAccessRequired: false,
      subjectSystem: 'INTENTLOCK',
      humanReviewStatus: 'NOT_PERFORMED',
      humanReviewRecordProduced: false,
      humanApprovalProvided: false,
    });
    expect(result.cases).toHaveLength(20);
    expect(new Set(result.cases.map((entry) => entry.workflow)).size).toBe(7);
    expect(new Set(result.cases.map((entry) => entry.variant)).size).toBe(5);
    for (const entry of result.cases) {
      expect(entry).toMatchObject({
        humanReviewPerformed: false,
        humanApprovalProvided: false,
        reviewerFieldsPopulated: false,
      });
    }
    expect(result.summary.machineMatchCount).toBe(
      result.cases.filter((entry) => entry.machineExpectationStatus === 'MATCH').length,
    );
    expect(result.summary).toMatchObject({
      machineMatchCount: 20,
      machineMismatchCaseIds: [],
      machineFailureCaseIds: [],
      allMachineExpectationsMatched: true,
      freezeReadinessClaim: false,
    });
    expect(() => {
      assertFreezeDryRunMachineGate(result.summary);
    }).not.toThrow();
    expect(result.summary.allMachineExpectationsMatched).toBe(
      result.summary.machineMismatchCaseIds.length === 0 &&
        result.summary.machineFailureCaseIds.length === 0,
    );
    expect(() => FreezeDryRunManifestSchema.parse(result.manifest)).not.toThrow();
  });

  it('blocks freeze progression on machine mismatch without converting it to human review', () => {
    const result = sharedArtifacts;
    const firstCase = FREEZE_REVIEW_CASE_IDS[0];
    expect(() => {
      assertFreezeDryRunMachineGate({
        ...result.summary,
        machineMatchCount: 19,
        machineMismatchCaseIds: [firstCase],
        allMachineExpectationsMatched: false,
      });
    }).toThrow('commit a new candidate before human approval');
    expect(result.summary).toMatchObject({
      humanReviewStatus: 'NOT_PERFORMED',
      humanApprovalProvided: false,
      freezeReadinessClaim: false,
    });
  });

  it('accepts only the pending canonical template and never treats it as freeze approval', () => {
    const template = JSON.parse(
      readFileSync('experiments/configs/freeze-review.template.json', 'utf8'),
    ) as unknown;
    expect(validatePendingFreezeReviewTemplate(template)).toEqual(FREEZE_REVIEW_CASE_IDS);
    expect(() => validateApprovedFreezeReview(template, 'a'.repeat(40))).toThrow();
    expect(() =>
      validatePendingFreezeReviewTemplate({
        ...(template as Record<string, unknown>),
        status: 'APPROVED',
      }),
    ).toThrow();
  });

  it('binds approval to the exact blocker-free machine artifacts and exact human case order', () => {
    const result = sharedArtifacts;
    const review = approvedReview(result);
    const input = reviewValidationInput(result);
    expect(() => validateFreezeDryRunReviewEvidence(review, input)).not.toThrow();

    expect(() =>
      validateFreezeDryRunReviewEvidence(review, {
        ...input,
        casesSource: `${input.casesSource} `,
      }),
    ).toThrow('casesJsonlSha256');

    const first = review.reproducedCases[0];
    const second = review.reproducedCases[1];
    if (!first || !second) throw new Error('expected human review rows');
    expect(() =>
      validateFreezeDryRunReviewEvidence(
        {
          ...review,
          reproducedCases: [second, first, ...review.reproducedCases.slice(2)],
        },
        input,
      ),
    ).toThrow('same exact 20 cases');

    const blockedSummary = {
      ...result.summary,
      machineMatchCount: 19,
      machineMismatchCaseIds: [FREEZE_REVIEW_CASE_IDS[0]],
      allMachineExpectationsMatched: false,
    };
    const blockedSummarySource = `${JSON.stringify(blockedSummary, null, 2)}\n`;
    expect(() =>
      validateFreezeDryRunReviewEvidence(
        {
          ...review,
          dryRunEvidence: {
            ...review.dryRunEvidence,
            summarySha256: sha256Text(blockedSummarySource),
          },
        },
        { ...input, summarySource: blockedSummarySource },
      ),
    ).toThrow('blocker-free exact-20');
  });

  it('rejects outer case provenance that disagrees with the nested deterministic results', () => {
    const first = structuredClone(sharedArtifacts.cases[0]);
    if (!first) throw new Error('expected a freeze dry-run case');
    first.scenarioSha256 = 'f'.repeat(64);
    expect(() => FreezeDryRunCaseEvidenceSchema.parse(first)).toThrow(
      'nested deterministic result provenance/oracle does not match its case and system',
    );
  });

  it('rejects a fully rehashed case whose provenance no longer matches candidate A', () => {
    const forgedCases = structuredClone(sharedArtifacts.cases);
    const first = forgedCases[0];
    if (!first) throw new Error('expected a freeze dry-run case');
    const forgedScenarioSha256 = 'f'.repeat(64);
    first.scenarioSha256 = forgedScenarioSha256;
    for (const result of first.deterministicResults) {
      result.result.scenarioSha256 = forgedScenarioSha256;
    }
    const forgedCasesSource = `${forgedCases.map((entry) => JSON.stringify(entry)).join('\n')}\n`;
    const forgedArtifacts = {
      ...sharedArtifacts,
      cases: forgedCases,
      casesJsonl: forgedCasesSource,
      manifest: {
        ...sharedArtifacts.manifest,
        casesJsonlSha256: sha256Text(forgedCasesSource),
      },
    };
    expect(() =>
      validateFreezeDryRunReviewEvidence(
        approvedReview(forgedArtifacts),
        reviewValidationInput(forgedArtifacts),
      ),
    ).toThrow('differs from the candidate scenario');
  });

  it('rejects a review that names dry-run artifacts absent from the freeze commit', async () => {
    const repositoryRoot = resolve(import.meta.dirname, '../..');
    const currentHead = execFileSync('git', ['-C', repositoryRoot, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    const currentTree = execFileSync(
      'git',
      ['-C', repositoryRoot, 'rev-parse', `${currentHead}^{tree}`],
      { encoding: 'utf8' },
    ).trim();
    const review = approvedReview(sharedArtifacts);
    const committedConfig = FrozenEvalConfigSchema.parse(
      parse(
        execFileSync(
          'git',
          ['-C', repositoryRoot, 'show', `${currentHead}:experiments/configs/frozen-eval.yaml`],
          { encoding: 'utf8' },
        ),
      ),
    );
    const modeFields =
      committedConfig.reviewProtocol?.mode === 'SOLO_AI_ASSISTED'
        ? {
            schemaVersion: '0.3',
            status: 'COMPLETE_AI_ASSISTED',
            reviewerType: 'AI',
            independenceAttestation: false,
            reviewMode: 'SOLO_AI_ASSISTED',
            finalAuthorApproval: 'PENDING',
            independentHumanReviewClaim: false,
          }
        : {};
    await expect(
      validateFreezeReviewEvidenceFromRepository({
        repositoryRoot,
        reviewedCommit: currentHead,
        requireTrackedArtifacts: true,
        reviewInput: {
          ...review,
          ...modeFields,
          reviewedCommit: currentHead,
          dryRunEvidence: {
            ...review.dryRunEvidence,
            outputDirectory:
              'experiments/results/freeze-dry-runs/forged-review-artifacts-not-tracked',
            runId: 'forged-review-artifacts-not-tracked',
            candidateCommit: currentHead,
            candidateTree: currentTree,
          },
        },
      }),
    ).rejects.toThrow('frozen dry-run artifact is not tracked');
  });

  it('writes append-only evidence and rejects an existing output directory', async () => {
    const result = sharedArtifacts;
    const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'intentlock-freeze-dry-run-'));
    const output = resolve(temporaryRoot, 'run-01');
    try {
      await writeFreezeDryRunArtifacts(output, result);
      expect((await readdir(output)).sort()).toEqual([
        'cases.jsonl',
        'manifest.json',
        'summary.json',
      ]);
      expect(
        (await readFile(resolve(output, 'cases.jsonl'), 'utf8')).trim().split(/\r?\n/u),
      ).toHaveLength(20);
      await expect(writeFreezeDryRunArtifacts(output, result)).rejects.toThrow('append-only');
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});
