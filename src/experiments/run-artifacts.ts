import { z } from 'zod';

import type { BenchmarkScenario } from '../benchmark/scenario.js';
import { BENCHMARK_DATASET_VERSION } from '../benchmark/version.js';
import type { EvaluationCaseManifestEntry } from './case-matrix.js';
import { RawEvaluationResultSchema } from './evaluate-case.js';
import { FreezeDigestsSchema } from './freeze-digests.js';
import { RepoRelativeJsonPathSchema } from './freeze-gates.js';
import type { EvaluationRecord, EvaluationSystemSchema } from './metrics.js';
import { SoloAiReviewProtocolSchema } from './protocol.js';

export const PRIMARY_EVALUATION_SYSTEMS = [
  'NONE',
  'GUARD_MODE',
  'LLM_VERIFIER',
  'PER_CALL_POLICY',
  'INTENTLOCK',
] as const;

const PrimaryEvaluationSystemsSchema = z.tuple([
  z.literal(PRIMARY_EVALUATION_SYSTEMS[0]),
  z.literal(PRIMARY_EVALUATION_SYSTEMS[1]),
  z.literal(PRIMARY_EVALUATION_SYSTEMS[2]),
  z.literal(PRIMARY_EVALUATION_SYSTEMS[3]),
  z.literal(PRIMARY_EVALUATION_SYSTEMS[4]),
]);

export const EvaluationRunManifestSchema = z
  .object({
    schemaVersion: z.literal('0.1'),
    runId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,79}$/),
    protocolVersion: z.literal('0.1'),
    reviewProtocol: SoloAiReviewProtocolSchema.optional(),
    datasetVersion: z.literal(BENCHMARK_DATASET_VERSION),
    createdAt: z.iso.datetime(),
    gitCommit: z.string().regex(/^[a-f0-9]{40}$/),
    executionCommit: z.string().regex(/^[a-f0-9]{40}$/),
    configPath: RepoRelativeJsonPathSchema.or(z.literal('experiments/configs/frozen-eval.yaml')),
    configSha256: z.string().regex(/^[a-f0-9]{64}$/),
    ablationConfigSha256: z.string().regex(/^[a-f0-9]{64}$/),
    caseManifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    freezeDigests: FreezeDigestsSchema,
    systems: PrimaryEvaluationSystemsSchema,
    caseCount: z.literal(400),
    expectedSelectedRecords: z.literal(2_000),
    retryResultSelection: z.literal(
      'attempt-1-intention-to-treat-retries-operational-sensitivity-only',
    ),
    maxAttemptsPerCase: z.number().int().min(1).max(5),
    maxTotalRetryAttempts: z.number().int().min(0).max(2_000),
    overwrite: z.literal(false),
    modelId: z.string().min(1),
  })
  .strict();

export const EvaluationAttemptSchema = z
  .object({
    schemaVersion: z.literal('0.1'),
    attempt: z.number().int().positive(),
    startedAt: z.iso.datetime(),
    completedAt: z.iso.datetime(),
    result: RawEvaluationResultSchema,
  })
  .strict();

export type EvaluationRunManifest = z.infer<typeof EvaluationRunManifestSchema>;
export type EvaluationAttempt = z.infer<typeof EvaluationAttemptSchema>;

export function assertPrimaryRunManifestIdentity(
  manifest: EvaluationRunManifest,
  requestedRunId: string,
): void {
  if (manifest.runId !== requestedRunId) {
    throw new Error('primary run manifest runId does not match the requested result directory');
  }
}

export function primaryResultArtifactPaths(primaryRunId: string): readonly string[] {
  const runId = EvaluationRunManifestSchema.shape.runId.parse(primaryRunId);
  const root = `experiments/results/${runId}`;
  return [
    `${root}/manifest.json`,
    `${root}/raw.jsonl`,
    `${root}/summary.json`,
    `${root}/summary.csv`,
  ] as const;
}

export function assertPrimaryArtifactsTrackedAtHead(
  primaryRunId: string,
  isTrackedAtHead: (path: string) => boolean,
): void {
  for (const path of primaryResultArtifactPaths(primaryRunId)) {
    if (!isTrackedAtHead(path)) {
      throw new Error(`primary result artifact must be committed before downstream use: ${path}`);
    }
  }
}

/** Binds selected primary rows to every frozen case-manifest field, not only case ID/hash. */
export function assertPrimaryEvaluationMatrixBinding(options: {
  attempts: readonly EvaluationAttempt[];
  primaryRunId: string;
  entries: readonly EvaluationCaseManifestEntry[];
  scenarios: readonly BenchmarkScenario[];
  systems?: readonly EvaluationRecord['system'][];
}): void {
  const systems = options.systems ?? PRIMARY_EVALUATION_SYSTEMS;
  if (options.entries.length !== options.scenarios.length) {
    throw new Error('case entries and scenarios are not index-aligned');
  }
  const expectedCases = new Map(
    options.entries.map((entry, index) => [
      entry.caseId,
      { entry, scenario: options.scenarios[index] },
    ]),
  );
  if (expectedCases.size !== options.entries.length)
    throw new Error('case manifest IDs are not unique');
  if (options.attempts.length !== expectedCases.size * systems.length) {
    throw new Error('primary selected result count does not match the frozen case matrix');
  }

  const seen = new Set<string>();
  for (const attempt of options.attempts) {
    const { record } = attempt.result;
    if (!systems.includes(record.system)) {
      throw new Error(`unexpected primary system ${record.system}`);
    }
    const key = `${record.system}:${record.caseId}`;
    if (seen.has(key)) throw new Error(`duplicate primary selected result ${key}`);
    seen.add(key);
    const expected = expectedCases.get(record.caseId);
    if (!expected?.scenario) throw new Error(`primary result has unknown case ${record.caseId}`);
    const { entry, scenario } = expected;
    if (
      attempt.attempt !== 1 ||
      record.runId !== options.primaryRunId ||
      record.baseScenarioId !== entry.baseScenarioId ||
      record.workflow !== entry.workflow ||
      record.class !== entry.class ||
      record.split !== entry.split ||
      JSON.stringify(record.chainIds) !== JSON.stringify(entry.chainIds) ||
      record.actionCount !== scenario.trace.actions.length ||
      record.observationStage !== entry.observationStage ||
      record.oracleEvidenceLevel !== entry.oracleEvidenceLevel ||
      record.mutationValidity !== entry.mutationValidity ||
      attempt.result.variant !== entry.variant ||
      attempt.result.mutationOperator !== entry.mutationOperator ||
      attempt.result.scenarioSha256 !== entry.scenarioSha256 ||
      attempt.result.oracleExpectedDecision !== scenario.oracle.expectedDecision
    ) {
      throw new Error(
        `primary ${record.system}:${record.caseId} does not match the frozen case matrix`,
      );
    }
  }

  for (const system of systems) {
    for (const caseId of expectedCases.keys()) {
      if (!seen.has(`${system}:${caseId}`)) {
        throw new Error(`primary result is missing ${system}:${caseId}`);
      }
    }
  }
}

export const AttemptProvenanceSchema = z
  .object({
    selectionPolicy: z.literal('attempt-1-intention-to-treat-retries-operational-sensitivity-only'),
    rawAttempts: z.number().int().nonnegative(),
    selectedRecords: z.number().int().nonnegative(),
    retryAttempts: z.number().int().nonnegative(),
    failedAttempts: z.number().int().nonnegative(),
    timedOutAttempts: z.number().int().nonnegative(),
    unsupportedAttempts: z.number().int().nonnegative(),
    casesWithRetries: z.number().int().nonnegative(),
    primaryAttemptFailures: z.number().int().nonnegative(),
    operationalRecoverySuccesses: z.number().int().nonnegative(),
    maxAttemptsObserved: z.number().int().nonnegative(),
    maxAttemptsPerCase: z.number().int().min(1).max(5),
    maxTotalRetryAttempts: z.number().int().min(0).max(2_000),
  })
  .strict();

export type AttemptProvenance = z.infer<typeof AttemptProvenanceSchema>;

function resultKey(attempt: EvaluationAttempt): string {
  return `${attempt.result.record.system}:${attempt.result.record.caseId}`;
}

export function isOperationalRetryEligible(
  executionStatus: EvaluationRecord['executionStatus'],
): boolean {
  return executionStatus === 'FAILED' || executionStatus === 'TIMEOUT';
}

function operationallyComplete(attempt: EvaluationAttempt): boolean {
  return !isOperationalRetryEligible(attempt.result.record.executionStatus);
}

/** Attempt 1 is always the primary intention-to-treat record. Retries never replace it. */
export function selectEvaluationAttempts(
  attemptsInput: readonly EvaluationAttempt[],
  options: { maxAttemptsPerCase: number; maxTotalRetryAttempts: number },
): EvaluationAttempt[] {
  const attempts = z.array(EvaluationAttemptSchema).parse(attemptsInput);
  const { maxAttemptsPerCase, maxTotalRetryAttempts } = options;
  if (
    !Number.isSafeInteger(maxAttemptsPerCase) ||
    maxAttemptsPerCase < 1 ||
    maxAttemptsPerCase > 5
  ) {
    throw new Error('maxAttemptsPerCase must be an integer from 1 to 5');
  }
  if (
    !Number.isSafeInteger(maxTotalRetryAttempts) ||
    maxTotalRetryAttempts < 0 ||
    maxTotalRetryAttempts > 2_000
  ) {
    throw new Error('maxTotalRetryAttempts must be an integer from 0 to 2000');
  }
  if (attempts.filter((attempt) => attempt.attempt > 1).length > maxTotalRetryAttempts) {
    throw new Error(`total retry attempts exceed frozen cap ${String(maxTotalRetryAttempts)}`);
  }
  const grouped = new Map<string, EvaluationAttempt[]>();
  for (const attempt of attempts) {
    const group = grouped.get(resultKey(attempt)) ?? [];
    if (group.some((candidate) => candidate.attempt === attempt.attempt)) {
      throw new Error(`duplicate attempt number for ${resultKey(attempt)}`);
    }
    group.push(attempt);
    grouped.set(resultKey(attempt), group);
  }
  return [...grouped]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, group]) => {
      const ordered = [...group].sort((left, right) => left.attempt - right.attempt);
      if (ordered.length > maxAttemptsPerCase) {
        throw new Error(`attempt count exceeds frozen cap ${String(maxAttemptsPerCase)}`);
      }
      if (ordered.some((attempt, index) => attempt.attempt !== index + 1)) {
        throw new Error('attempt numbers must be contiguous and start at one');
      }
      const primary = ordered[0];
      if (!primary) throw new Error('empty attempt group');
      return primary;
    });
}

export function summarizeEvaluationAttempts(
  attemptsInput: readonly EvaluationAttempt[],
  options: { maxAttemptsPerCase: number; maxTotalRetryAttempts: number },
): AttemptProvenance {
  const attempts = z.array(EvaluationAttemptSchema).parse(attemptsInput);
  const { maxAttemptsPerCase, maxTotalRetryAttempts } = options;
  const selected = selectEvaluationAttempts(attempts, options);
  const selectedByKey = new Map(selected.map((attempt) => [resultKey(attempt), attempt]));
  const grouped = new Map<string, EvaluationAttempt[]>();
  for (const attempt of attempts) {
    const group = grouped.get(resultKey(attempt)) ?? [];
    group.push(attempt);
    grouped.set(resultKey(attempt), group);
  }
  const primaryAttemptFailures = [...selectedByKey.values()].filter(
    (attempt) => !operationallyComplete(attempt),
  ).length;
  const operationalRecoverySuccesses = [...grouped].filter(([key, group]) => {
    const primary = selectedByKey.get(key);
    return Boolean(
      primary &&
      !operationallyComplete(primary) &&
      group.some((attempt) => attempt.attempt > 1 && operationallyComplete(attempt)),
    );
  }).length;
  return AttemptProvenanceSchema.parse({
    selectionPolicy: 'attempt-1-intention-to-treat-retries-operational-sensitivity-only',
    rawAttempts: attempts.length,
    selectedRecords: selected.length,
    retryAttempts: attempts.length - selected.length,
    failedAttempts: attempts.filter((attempt) => attempt.result.record.executionStatus === 'FAILED')
      .length,
    timedOutAttempts: attempts.filter(
      (attempt) => attempt.result.record.executionStatus === 'TIMEOUT',
    ).length,
    unsupportedAttempts: attempts.filter(
      (attempt) => attempt.result.record.executionStatus === 'UNSUPPORTED',
    ).length,
    casesWithRetries: [...grouped.values()].filter((group) => group.length > 1).length,
    primaryAttemptFailures,
    operationalRecoverySuccesses,
    maxAttemptsObserved: Math.max(0, ...[...grouped.values()].map((group) => group.length)),
    maxAttemptsPerCase,
    maxTotalRetryAttempts,
  });
}

export function nextAttemptNumber(
  attempts: readonly EvaluationAttempt[],
  system: z.infer<typeof EvaluationSystemSchema>,
  caseId: string,
): number {
  const numbers = attempts
    .filter(
      (candidate) =>
        candidate.result.record.system === system && candidate.result.record.caseId === caseId,
    )
    .map((candidate) => candidate.attempt);
  return Math.max(0, ...numbers) + 1;
}
