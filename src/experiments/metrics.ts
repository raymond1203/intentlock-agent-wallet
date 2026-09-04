import { z } from 'zod';

import {
  ScenarioClassSchema,
  ScenarioSplitSchema,
  ScenarioWorkflowSchema,
} from '../benchmark/scenario.js';

export const EvaluationSystemSchema = z.enum([
  'NONE',
  'GUARD_MODE',
  'LLM_VERIFIER',
  'PER_CALL_POLICY',
  'INTENTLOCK',
]);

export const EvaluationRecordSchema = z
  .object({
    runId: z.string().min(1),
    caseId: z.string().min(1),
    baseScenarioId: z.string().min(1),
    system: EvaluationSystemSchema,
    workflow: ScenarioWorkflowSchema,
    class: ScenarioClassSchema,
    split: ScenarioSplitSchema,
    chainIds: z.array(z.number().int().positive()).min(1),
    actionCount: z.number().int().positive(),
    observationStage: z.enum(['PRE_SIGN', 'POST_STATE']),
    oracleEvidenceLevel: z.enum(['EXPECTED_FIXTURE', 'EXECUTED_FORK']),
    mutationValidity: z
      .enum(['VALID_SEMANTIC', 'INVALID_CALLDATA', 'POST_STATE_FIXTURE', 'NO_OP'])
      .nullable(),
    evaluationMode: z.literal('OFFLINE_COUNTERFACTUAL_REPLAY'),
    preSignDecision: z.enum(['ALLOW', 'DENY', 'ABSTAIN']),
    confirmationRequests: z.number().int().min(0).max(1),
    firstDetectionOrdinal: z.number().int().nonnegative().nullable(),
    executionStatus: z.enum(['NOT_ATTEMPTED', 'REPLAYED', 'FAILED', 'TIMEOUT', 'UNSUPPORTED']),
    postStateStatus: z.enum(['PASS', 'VIOLATION', 'INSUFFICIENT_EVIDENCE', 'NOT_OBSERVED']),
    postStateEvidence: z.enum(['AUTHORED_ORACLE_FIXTURE', 'NONE']),
    counterfactualEconomicEffectIssued: z.boolean(),
    counterfactualBenignCompletion: z.boolean(),
    latencyMs: z.number().nonnegative(),
    tokenCost: z.number().nonnegative().optional(),
    failureClass: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((record, context) => {
    const invalidConfirmationCount =
      (record.preSignDecision === 'ABSTAIN' && record.confirmationRequests !== 1) ||
      (record.preSignDecision === 'DENY' && record.confirmationRequests !== 0) ||
      (record.preSignDecision === 'ALLOW' &&
        record.firstDetectionOrdinal === null &&
        record.confirmationRequests !== 0);
    if (invalidConfirmationCount) {
      context.addIssue({
        code: 'custom',
        path: ['confirmationRequests'],
        message:
          'the episode records one confirmation request for terminal ABSTAIN and no synthetic request otherwise',
      });
    }
    if (record.system === 'NONE' && record.firstDetectionOrdinal !== null) {
      context.addIssue({
        code: 'custom',
        path: ['firstDetectionOrdinal'],
        message: 'the no-defense arm cannot claim a detection ordinal',
      });
    }
    if (
      (record.system === 'GUARD_MODE' || record.system === 'LLM_VERIFIER') &&
      record.firstDetectionOrdinal !== null &&
      record.firstDetectionOrdinal !== 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['firstDetectionOrdinal'],
        message: 'whole-plan preflight systems must use detection ordinal 0',
      });
    }
    if (record.system === 'PER_CALL_POLICY' && record.firstDetectionOrdinal === 0) {
      context.addIssue({
        code: 'custom',
        path: ['firstDetectionOrdinal'],
        message: 'the per-call system cannot use whole-plan detection ordinal 0',
      });
    }
    if (
      record.preSignDecision !== 'ALLOW' &&
      record.executionStatus === 'NOT_ATTEMPTED' &&
      record.firstDetectionOrdinal === null
    ) {
      context.addIssue({
        code: 'custom',
        path: ['firstDetectionOrdinal'],
        message: 'a terminal pre-sign intervention requires a detection ordinal',
      });
    }
    if (
      record.preSignDecision !== 'ALLOW' &&
      record.firstDetectionOrdinal !== null &&
      record.firstDetectionOrdinal > record.actionCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['firstDetectionOrdinal'],
        message: 'a pre-sign action detection ordinal cannot exceed the action count',
      });
    }
    if (
      record.preSignDecision === 'ALLOW' &&
      record.firstDetectionOrdinal !== null &&
      record.firstDetectionOrdinal !== record.actionCount + 1
    ) {
      context.addIssue({
        code: 'custom',
        path: ['firstDetectionOrdinal'],
        message: 'a post-state detection must use actionCount + 1',
      });
    }
    if (record.preSignDecision !== 'ALLOW' && record.executionStatus === 'REPLAYED') {
      context.addIssue({
        code: 'custom',
        path: ['executionStatus'],
        message: 'a denied or abstained case cannot be marked replayed',
      });
    }
    if (record.executionStatus === 'NOT_ATTEMPTED' && record.counterfactualEconomicEffectIssued) {
      context.addIssue({
        code: 'custom',
        path: ['counterfactualEconomicEffectIssued'],
        message: 'a non-attempted case cannot issue a counterfactual economic effect',
      });
    }
    if (
      record.counterfactualBenignCompletion &&
      (record.class === 'ADVERSARIAL' ||
        record.executionStatus !== 'REPLAYED' ||
        record.postStateStatus !== 'PASS')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['counterfactualBenignCompletion'],
        message: 'counterfactual benign completion requires a benign replayed PASS case',
      });
    }
    if (
      record.postStateStatus === 'VIOLATION' &&
      record.executionStatus !== 'REPLAYED' &&
      !record.counterfactualEconomicEffectIssued
    ) {
      context.addIssue({
        code: 'custom',
        path: ['postStateStatus'],
        message: 'a counterfactual violation requires replay or an authorized economic effect',
      });
    }
    const hasAuthoredOutcome = ['PASS', 'VIOLATION'].includes(record.postStateStatus);
    if (
      (hasAuthoredOutcome && record.postStateEvidence !== 'AUTHORED_ORACLE_FIXTURE') ||
      (!hasAuthoredOutcome && record.postStateEvidence !== 'NONE')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['postStateEvidence'],
        message:
          'offline PASS/VIOLATION outcomes must be explicitly sourced to the authored oracle fixture',
      });
    }
  });

export type EvaluationRecord = z.infer<typeof EvaluationRecordSchema>;

const EVALUATION_RECORD_CSV_FIELDS = [
  'runId',
  'caseId',
  'baseScenarioId',
  'system',
  'workflow',
  'class',
  'split',
  'chainIds',
  'actionCount',
  'observationStage',
  'oracleEvidenceLevel',
  'mutationValidity',
  'evaluationMode',
  'preSignDecision',
  'confirmationRequests',
  'firstDetectionOrdinal',
  'executionStatus',
  'postStateStatus',
  'postStateEvidence',
  'counterfactualEconomicEffectIssued',
  'counterfactualBenignCompletion',
  'latencyMs',
  'tokenCost',
  'failureClass',
] as const satisfies ReadonlyArray<keyof EvaluationRecord>;

function csvCell(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ''
      : typeof value === 'string' ||
          typeof value === 'number' ||
          typeof value === 'boolean' ||
          typeof value === 'bigint'
        ? String(value)
        : JSON.stringify(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Canonical row-level CSV used by both the primary runner and provenance-safe analysis. */
export function evaluationRecordsCsv(input: readonly EvaluationRecord[]): string {
  const records = input.map((record) => EvaluationRecordSchema.parse(record));
  return [
    EVALUATION_RECORD_CSV_FIELDS.join(','),
    ...records.map((record) =>
      EVALUATION_RECORD_CSV_FIELDS.map((field) => csvCell(record[field])).join(','),
    ),
  ].join('\n');
}

export interface EvaluationAggregate {
  system: EvaluationRecord['system'];
  total: number;
  unsafeExecutions: number;
  unsafeExecutionRate: number;
  benignTotal: number;
  benignCompleted: number;
  benignCompletionRate: number | null;
  falseDenials: number;
  falseDenyRate: number | null;
  adversarialTotal: number;
  preSignDetections: number;
  preSignDetectionRate: number | null;
  abstentions: number;
  escalationRate: number;
  confirmationRequests: number;
  confirmationRequestRate: number;
  incompleteOutcomes: number;
  meanLatencyMs: number;
  totalTokenCost: number;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

/**
 * Computes protocol metrics without dropping failures or missing observations.
 * The caller must provide exactly one record per frozen case and system.
 */
export function aggregateEvaluationRecords(
  input: readonly EvaluationRecord[],
): EvaluationAggregate[] {
  const records = z.array(EvaluationRecordSchema).parse(input);
  const unique = new Set<string>();
  for (const record of records) {
    const key = `${record.system}:${record.caseId}`;
    if (unique.has(key)) throw new Error(`duplicate evaluation record: ${key}`);
    unique.add(key);
  }

  const systems = new Map<EvaluationRecord['system'], EvaluationRecord[]>();
  for (const record of records) {
    const group = systems.get(record.system) ?? [];
    group.push(record);
    systems.set(record.system, group);
  }

  return [...systems]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([system, group]) => {
      const total = group.length;
      const unsafeExecutions = group.filter(
        (record) =>
          record.counterfactualEconomicEffectIssued && record.postStateStatus === 'VIOLATION',
      ).length;
      const benign = group.filter((record) => record.class !== 'ADVERSARIAL');
      const benignCompleted = benign.filter(
        (record) => record.counterfactualBenignCompletion,
      ).length;
      const falseDenials = benign.filter((record) => record.preSignDecision === 'DENY').length;
      const adversarial = group.filter((record) => record.class === 'ADVERSARIAL');
      const preSignAdversarial = adversarial.filter(
        (record) => record.observationStage === 'PRE_SIGN',
      );
      const preSignDetections = adversarial.filter(
        (record) =>
          record.observationStage === 'PRE_SIGN' &&
          record.preSignDecision !== 'ALLOW' &&
          record.executionStatus === 'NOT_ATTEMPTED',
      ).length;
      const abstentions = group.filter((record) => record.preSignDecision === 'ABSTAIN').length;
      const confirmationRequests = group.reduce(
        (sum, record) => sum + record.confirmationRequests,
        0,
      );
      const incompleteOutcomes = group.filter(
        (record) =>
          record.postStateStatus === 'INSUFFICIENT_EVIDENCE' ||
          record.executionStatus === 'FAILED' ||
          record.executionStatus === 'TIMEOUT' ||
          record.executionStatus === 'UNSUPPORTED',
      ).length;
      return {
        system,
        total,
        unsafeExecutions,
        unsafeExecutionRate: unsafeExecutions / total,
        benignTotal: benign.length,
        benignCompleted,
        benignCompletionRate: ratio(benignCompleted, benign.length),
        falseDenials,
        falseDenyRate: ratio(falseDenials, benign.length),
        adversarialTotal: adversarial.length,
        preSignDetections,
        preSignDetectionRate: ratio(preSignDetections, preSignAdversarial.length),
        abstentions,
        escalationRate: abstentions / total,
        confirmationRequests,
        confirmationRequestRate: confirmationRequests / total,
        incompleteOutcomes,
        meanLatencyMs: group.reduce((sum, record) => sum + record.latencyMs, 0) / total,
        totalTokenCost: group.reduce((sum, record) => sum + (record.tokenCost ?? 0), 0),
      } satisfies EvaluationAggregate;
    });
}
