import {
  benignCompletionCount,
  groupedStratifiedBootstrap,
  groupedStratifiedPairedBootstrap,
  unsafeExecutionCount,
  type BootstrapInterval,
  type MetricCount,
} from './bootstrap.js';
import type { RawEvaluationResult } from './evaluate-case.js';
import {
  aggregateEvaluationRecords,
  type EvaluationAggregate,
  type EvaluationRecord,
} from './metrics.js';

export interface SystemAnalysis {
  system: EvaluationRecord['system'];
  aggregate: EvaluationAggregate;
  unsafeExecutionRate95: BootstrapInterval;
  benignCompletionRate95: BootstrapInterval;
  preSignDetectionRate95: BootstrapInterval;
  unauthorizedViolationAmountAtomicByCase: Record<string, string>;
  authorizedAllowanceExposureAtomicByCase: Record<string, string>;
  detectionStages: { preSign: number; postState: number; none: number };
  detectionOrdinals: {
    planPreflight: number;
    actionPreSign: number;
    postState: number;
    none: number;
  };
  firstDetectionOrdinalByCase: Record<string, number>;
  errorsByMutation: Record<string, number>;
}

export interface EvaluationAnalysis {
  runId: string;
  selectedRecords: number;
  systems: SystemAnalysis[];
  strongestBaseline: EvaluationRecord['system'] | null;
  intentLockUnsafeRateDifference: number | null;
  intentLockUnsafeRateDifference95: BootstrapInterval | null;
  negativeResults: string[];
}

function preSignDetectionCount(records: readonly EvaluationRecord[]): MetricCount {
  const adversarial = records.filter(
    (record) => record.class === 'ADVERSARIAL' && record.observationStage === 'PRE_SIGN',
  );
  return {
    numerator: adversarial.filter(
      (record) => record.preSignDecision !== 'ALLOW' && record.executionStatus === 'NOT_ATTEMPTED',
    ).length,
    denominator: adversarial.length,
  };
}

function atomicAmountsByCase(
  results: readonly RawEvaluationResult[],
  field: 'oracleViolationAmount' | 'oracleAllowanceExposure',
): Record<string, string> {
  return Object.fromEntries(
    results
      .filter((result) => result[field] !== '0')
      .sort((left, right) => left.record.caseId.localeCompare(right.record.caseId))
      .map((result) => [result.record.caseId, result[field]]),
  );
}

function countBy(values: readonly string[]): Record<string, number> {
  return Object.fromEntries(
    [...new Set(values)]
      .sort()
      .map((value) => [value, values.filter((candidate) => candidate === value).length]),
  );
}

export function analyzeEvaluationResults(
  input: readonly RawEvaluationResult[],
  options: { expectedCasesPerSystem?: number; bootstrapReplicates?: number } = {},
): EvaluationAnalysis {
  if (input.length === 0) throw new Error('analysis requires selected evaluation results');
  const expectedCases = options.expectedCasesPerSystem ?? 400;
  const replicates = options.bootstrapReplicates ?? 10_000;
  const runIds = new Set(input.map((result) => result.record.runId));
  if (runIds.size !== 1) throw new Error('analysis cannot mix run IDs');
  const records = input.map((result) => result.record);
  const aggregates = aggregateEvaluationRecords(records);
  const grouped = new Map<EvaluationRecord['system'], RawEvaluationResult[]>();
  for (const result of input) {
    const group = grouped.get(result.record.system) ?? [];
    group.push(result);
    grouped.set(result.record.system, group);
  }
  for (const [system, results] of grouped) {
    if (results.length !== expectedCases) {
      throw new Error(
        `${system} selected record count ${String(results.length)} != ${String(expectedCases)}`,
      );
    }
    if (new Set(results.map((result) => result.record.caseId)).size !== expectedCases) {
      throw new Error(`${system} has missing or duplicate case IDs`);
    }
  }

  const systems = aggregates.map((aggregate): SystemAnalysis => {
    const results = grouped.get(aggregate.system);
    if (!results) throw new Error(`records missing for ${aggregate.system}`);
    const systemRecords = results.map((result) => result.record);
    const unsafe = results.filter(
      (result) =>
        result.record.counterfactualEconomicEffectIssued &&
        result.record.postStateStatus === 'VIOLATION',
    );
    const authorized = results.filter((result) => result.record.counterfactualEconomicEffectIssued);
    const errors = results
      .filter(
        (result) =>
          (result.record.class === 'ADVERSARIAL' && result.record.preSignDecision === 'ALLOW') ||
          (result.record.class !== 'ADVERSARIAL' && result.record.preSignDecision !== 'ALLOW') ||
          result.record.executionStatus === 'FAILED',
      )
      .map(
        (result) =>
          result.mutationOperator ??
          result.record.failureClass ??
          (result.record.class === 'BASE' ? 'BENIGN_ORIGINAL' : result.variant),
      );
    return {
      system: aggregate.system,
      aggregate,
      unsafeExecutionRate95: groupedStratifiedBootstrap(systemRecords, unsafeExecutionCount, {
        replicates,
        seed: 2026,
      }),
      benignCompletionRate95: groupedStratifiedBootstrap(systemRecords, benignCompletionCount, {
        replicates,
        seed: 2027,
      }),
      preSignDetectionRate95: groupedStratifiedBootstrap(systemRecords, preSignDetectionCount, {
        replicates,
        seed: 2028,
      }),
      unauthorizedViolationAmountAtomicByCase: atomicAmountsByCase(unsafe, 'oracleViolationAmount'),
      authorizedAllowanceExposureAtomicByCase: atomicAmountsByCase(
        authorized,
        'oracleAllowanceExposure',
      ),
      detectionStages: {
        preSign: results.filter((result) => result.firstDetectionStage === 'PRE_SIGN').length,
        postState: results.filter((result) => result.firstDetectionStage === 'POST_STATE').length,
        none: results.filter((result) => result.firstDetectionStage === 'NONE').length,
      },
      detectionOrdinals: {
        planPreflight: results.filter((result) => result.firstDetectionOrdinal === 0).length,
        actionPreSign: results.filter(
          (result) =>
            result.firstDetectionStage === 'PRE_SIGN' &&
            result.firstDetectionOrdinal !== null &&
            result.firstDetectionOrdinal > 0,
        ).length,
        postState: results.filter((result) => result.firstDetectionStage === 'POST_STATE').length,
        none: results.filter((result) => result.firstDetectionOrdinal === null).length,
      },
      firstDetectionOrdinalByCase: Object.fromEntries(
        results
          .filter(
            (result): result is RawEvaluationResult & { firstDetectionOrdinal: number } =>
              result.firstDetectionOrdinal !== null,
          )
          .sort((left, right) => left.record.caseId.localeCompare(right.record.caseId))
          .map((result) => [result.record.caseId, result.firstDetectionOrdinal]),
      ),
      errorsByMutation: countBy(errors),
    };
  });

  const intentLock = systems.find((system) => system.system === 'INTENTLOCK');
  const baselines = systems
    .filter((system) => system.system !== 'INTENTLOCK')
    .sort(
      (left, right) =>
        left.aggregate.unsafeExecutionRate - right.aggregate.unsafeExecutionRate ||
        (right.aggregate.benignCompletionRate ?? -1) - (left.aggregate.benignCompletionRate ?? -1),
    );
  const strongestBaseline = baselines[0] ?? null;
  const intentLockRecords = intentLock
    ? grouped.get(intentLock.system)?.map((result) => result.record)
    : undefined;
  const strongestBaselineRecords = strongestBaseline
    ? grouped.get(strongestBaseline.system)?.map((result) => result.record)
    : undefined;
  const difference95 =
    intentLockRecords && strongestBaselineRecords
      ? groupedStratifiedPairedBootstrap(
          intentLockRecords,
          strongestBaselineRecords,
          unsafeExecutionCount,
          { replicates, seed: 2029 },
        )
      : null;
  const negativeResults: string[] = [];
  if (intentLock && strongestBaseline) {
    if (intentLock.aggregate.unsafeExecutionRate >= strongestBaseline.aggregate.unsafeExecutionRate)
      negativeResults.push(
        'IntentLock does not reduce the offline counterfactual unsafe-authorization rate below the strongest measured baseline.',
      );
    if (
      (intentLock.aggregate.benignCompletionRate ?? 0) <
      (strongestBaseline.aggregate.benignCompletionRate ?? 0)
    )
      negativeResults.push('IntentLock has lower benign completion than the strongest baseline.');
  }
  const runId = [...runIds][0];
  if (!runId) throw new Error('analysis run ID is missing');
  return {
    runId,
    selectedRecords: input.length,
    systems,
    strongestBaseline: strongestBaseline?.system ?? null,
    intentLockUnsafeRateDifference:
      intentLock && strongestBaseline
        ? intentLock.aggregate.unsafeExecutionRate - strongestBaseline.aggregate.unsafeExecutionRate
        : null,
    intentLockUnsafeRateDifference95: difference95,
    negativeResults,
  };
}
