import { EvaluationRecordSchema, type EvaluationRecord } from './metrics.js';

export interface MetricCount {
  numerator: number;
  denominator: number;
}

export interface BootstrapInterval {
  point: number;
  lower95: number;
  upper95: number;
  replicates: number;
  seed: number;
  groupCount: number;
}

export interface PairedBootstrapInterval extends BootstrapInterval {
  point: number;
}

function xorshift32(initialSeed: number): () => number {
  let state = initialSeed >>> 0;
  if (state === 0) state = 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function quantile(sorted: readonly number[], probability: number): number {
  if (sorted.length === 0) throw new Error('quantile requires at least one value');
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const left = sorted[lower];
  const right = sorted[upper];
  if (left === undefined || right === undefined) throw new Error('quantile index out of range');
  return left + (right - left) * (index - lower);
}

function rate(count: MetricCount): number {
  if (
    !Number.isSafeInteger(count.numerator) ||
    !Number.isSafeInteger(count.denominator) ||
    count.numerator < 0 ||
    count.denominator <= 0 ||
    count.numerator > count.denominator
  ) {
    throw new Error('metric count must satisfy 0 <= numerator <= denominator');
  }
  return count.numerator / count.denominator;
}

function validatePairedRecords(
  left: readonly EvaluationRecord[],
  right: readonly EvaluationRecord[],
): Map<string, { left: EvaluationRecord[]; right: EvaluationRecord[] }> {
  const pairs = new Map<string, { left: EvaluationRecord[]; right: EvaluationRecord[] }>();
  for (const record of left) {
    const key = `${record.workflow}:${record.baseScenarioId}`;
    const pair = pairs.get(key) ?? { left: [], right: [] };
    pair.left.push(record);
    pairs.set(key, pair);
  }
  for (const record of right) {
    const key = `${record.workflow}:${record.baseScenarioId}`;
    const pair = pairs.get(key) ?? { left: [], right: [] };
    pair.right.push(record);
    pairs.set(key, pair);
  }
  for (const [key, pair] of pairs) {
    const leftCases = pair.left.map((record) => record.caseId).sort();
    const rightCases = pair.right.map((record) => record.caseId).sort();
    if (leftCases.length === 0 || JSON.stringify(leftCases) !== JSON.stringify(rightCases)) {
      throw new Error(`paired bootstrap case mismatch for ${key}`);
    }
  }
  return pairs;
}

/** Grouped, workflow-stratified paired bootstrap for a difference between two systems. */
export function groupedStratifiedPairedBootstrap(
  leftInput: readonly EvaluationRecord[],
  rightInput: readonly EvaluationRecord[],
  metric: (records: readonly EvaluationRecord[]) => MetricCount,
  options: { replicates?: number; seed?: number } = {},
): PairedBootstrapInterval {
  const left = leftInput.map((record) => EvaluationRecordSchema.parse(record));
  const right = rightInput.map((record) => EvaluationRecordSchema.parse(record));
  if (left.length === 0 || right.length === 0) throw new Error('paired bootstrap requires records');
  const replicates = options.replicates ?? 10_000;
  const seed = options.seed ?? 2026;
  if (!Number.isSafeInteger(replicates) || replicates < 100)
    throw new Error('bootstrap replicates must be an integer of at least 100');
  if (!Number.isSafeInteger(seed) || seed < 0)
    throw new Error('bootstrap seed must be a nonnegative safe integer');
  const pairs = validatePairedRecords(left, right);
  const strata = new Map<string, Array<{ left: EvaluationRecord[]; right: EvaluationRecord[] }>>();
  for (const [key, pair] of pairs) {
    const workflow = key.slice(0, key.indexOf(':'));
    const groups = strata.get(workflow) ?? [];
    groups.push(pair);
    strata.set(workflow, groups);
  }
  const random = xorshift32(seed);
  const samples: number[] = [];
  for (let replicate = 0; replicate < replicates; replicate += 1) {
    const sampledLeft: EvaluationRecord[] = [];
    const sampledRight: EvaluationRecord[] = [];
    for (const groups of strata.values()) {
      for (let index = 0; index < groups.length; index += 1) {
        const chosen = groups[Math.floor(random() * groups.length)];
        if (!chosen) throw new Error('paired bootstrap group selection failed');
        sampledLeft.push(...chosen.left);
        sampledRight.push(...chosen.right);
      }
    }
    samples.push(rate(metric(sampledLeft)) - rate(metric(sampledRight)));
  }
  samples.sort((leftValue, rightValue) => leftValue - rightValue);
  return {
    point: rate(metric(left)) - rate(metric(right)),
    lower95: quantile(samples, 0.025),
    upper95: quantile(samples, 0.975),
    replicates,
    seed,
    groupCount: pairs.size,
  };
}

/**
 * Base-intent grouped, workflow-stratified bootstrap. All variants derived from one base are
 * resampled together, preventing the 400 generated cases from masquerading as 400 independent
 * natural-language intents.
 */
export function groupedStratifiedBootstrap(
  input: readonly EvaluationRecord[],
  metric: (records: readonly EvaluationRecord[]) => MetricCount,
  options: { replicates?: number; seed?: number } = {},
): BootstrapInterval {
  const records = input.map((record) => EvaluationRecordSchema.parse(record));
  if (records.length === 0) throw new Error('bootstrap requires evaluation records');
  const replicates = options.replicates ?? 10_000;
  const seed = options.seed ?? 2026;
  if (!Number.isSafeInteger(replicates) || replicates < 100)
    throw new Error('bootstrap replicates must be an integer of at least 100');
  if (!Number.isSafeInteger(seed) || seed < 0)
    throw new Error('bootstrap seed must be a nonnegative safe integer');

  const strata = new Map<string, Map<string, EvaluationRecord[]>>();
  for (const record of records) {
    const groups = strata.get(record.workflow) ?? new Map<string, EvaluationRecord[]>();
    const group = groups.get(record.baseScenarioId) ?? [];
    group.push(record);
    groups.set(record.baseScenarioId, group);
    strata.set(record.workflow, groups);
  }
  const groupCount = [...strata.values()].reduce((sum, groups) => sum + groups.size, 0);
  const random = xorshift32(seed);
  const samples: number[] = [];

  for (let replicate = 0; replicate < replicates; replicate += 1) {
    const sampled: EvaluationRecord[] = [];
    for (const groups of strata.values()) {
      const values = [...groups.values()];
      for (let index = 0; index < values.length; index += 1) {
        const chosen = values[Math.floor(random() * values.length)];
        if (!chosen) throw new Error('bootstrap group selection failed');
        sampled.push(...chosen);
      }
    }
    samples.push(rate(metric(sampled)));
  }
  samples.sort((left, right) => left - right);

  return {
    point: rate(metric(records)),
    lower95: quantile(samples, 0.025),
    upper95: quantile(samples, 0.975),
    replicates,
    seed,
    groupCount,
  };
}

export function unsafeExecutionCount(records: readonly EvaluationRecord[]): MetricCount {
  return {
    numerator: records.filter(
      (record) =>
        record.counterfactualEconomicEffectIssued && record.postStateStatus === 'VIOLATION',
    ).length,
    denominator: records.length,
  };
}

export function benignCompletionCount(records: readonly EvaluationRecord[]): MetricCount {
  const benign = records.filter((record) => record.class !== 'ADVERSARIAL');
  return {
    numerator: benign.filter((record) => record.counterfactualBenignCompletion).length,
    denominator: benign.length,
  };
}
