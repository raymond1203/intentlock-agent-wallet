import { createHash } from 'node:crypto';

import { applyMutation, type MutationOperatorId } from '../benchmark/mutations/index.js';
import { BenchmarkScenarioSchema, type BenchmarkScenario } from '../benchmark/scenario.js';
import { BENCHMARK_DATASET_VERSION } from '../benchmark/version.js';

type ScenarioWorkflow = BenchmarkScenario['workflow'];

export const EVALUATION_VARIANTS = [
  'BENIGN_ORIGINAL',
  'ADVERSARIAL_SCOPE',
  'ADVERSARIAL_BUDGET',
  'ADVERSARIAL_COMPOSITION',
  'BENIGN_DRIFT',
] as const;

export type EvaluationVariant = (typeof EVALUATION_VARIANTS)[number];

type MutatedVariant = Exclude<EvaluationVariant, 'BENIGN_ORIGINAL'>;

const COMMON = {
  ADVERSARIAL_SCOPE: ['chain-substitution'],
  ADVERSARIAL_BUDGET: ['gas-inflation'],
  ADVERSARIAL_COMPOSITION: ['retry-double-spend', 'concurrency-race'],
  BENIGN_DRIFT: ['benign-hallucination'],
} satisfies Record<MutatedVariant, readonly MutationOperatorId[]>;

const WORKFLOW_SCHEDULE: Record<
  ScenarioWorkflow,
  Record<MutatedVariant, readonly MutationOperatorId[]>
> = {
  TRANSFER: {
    ADVERSARIAL_SCOPE: [
      'recipient-substitution',
      'token-substitution',
      ...COMMON.ADVERSARIAL_SCOPE,
    ],
    ADVERSARIAL_BUDGET: ['amount-inflation', ...COMMON.ADVERSARIAL_BUDGET],
    ADVERSARIAL_COMPOSITION: ['policy-laundering', ...COMMON.ADVERSARIAL_COMPOSITION],
    BENIGN_DRIFT: COMMON.BENIGN_DRIFT,
  },
  APPROVAL_PERMIT2: {
    ADVERSARIAL_SCOPE: COMMON.ADVERSARIAL_SCOPE,
    ADVERSARIAL_BUDGET: ['unlimited-approval', 'deadline-extension', ...COMMON.ADVERSARIAL_BUDGET],
    ADVERSARIAL_COMPOSITION: COMMON.ADVERSARIAL_COMPOSITION,
    BENIGN_DRIFT: COMMON.BENIGN_DRIFT,
  },
  SWAP_SINGLE: {
    ADVERSARIAL_SCOPE: ['recipient-substitution', ...COMMON.ADVERSARIAL_SCOPE],
    ADVERSARIAL_BUDGET: ['slippage-widening', ...COMMON.ADVERSARIAL_BUDGET],
    ADVERSARIAL_COMPOSITION: ['stale-quote', ...COMMON.ADVERSARIAL_COMPOSITION],
    BENIGN_DRIFT: COMMON.BENIGN_DRIFT,
  },
  SWAP_BATCH: {
    ADVERSARIAL_SCOPE: ['recipient-substitution', ...COMMON.ADVERSARIAL_SCOPE],
    ADVERSARIAL_BUDGET: ['slippage-widening', ...COMMON.ADVERSARIAL_BUDGET],
    ADVERSARIAL_COMPOSITION: ['hidden-batch', ...COMMON.ADVERSARIAL_COMPOSITION],
    BENIGN_DRIFT: COMMON.BENIGN_DRIFT,
  },
  BRIDGE_SWAP: {
    ADVERSARIAL_SCOPE: COMMON.ADVERSARIAL_SCOPE,
    ADVERSARIAL_BUDGET: COMMON.ADVERSARIAL_BUDGET,
    ADVERSARIAL_COMPOSITION: COMMON.ADVERSARIAL_COMPOSITION,
    BENIGN_DRIFT: ['partial-completion', ...COMMON.BENIGN_DRIFT],
  },
  LENDING: {
    ADVERSARIAL_SCOPE: COMMON.ADVERSARIAL_SCOPE,
    ADVERSARIAL_BUDGET: COMMON.ADVERSARIAL_BUDGET,
    ADVERSARIAL_COMPOSITION: COMMON.ADVERSARIAL_COMPOSITION,
    BENIGN_DRIFT: COMMON.BENIGN_DRIFT,
  },
  BATCH_RECOVERY: {
    ADVERSARIAL_SCOPE: COMMON.ADVERSARIAL_SCOPE,
    ADVERSARIAL_BUDGET: COMMON.ADVERSARIAL_BUDGET,
    ADVERSARIAL_COMPOSITION: ['hidden-batch', ...COMMON.ADVERSARIAL_COMPOSITION],
    BENIGN_DRIFT: COMMON.BENIGN_DRIFT,
  },
};

export interface EvaluationCaseManifestEntry {
  caseId: string;
  baseScenarioId: string;
  variant: EvaluationVariant;
  workflow: ScenarioWorkflow;
  class: BenchmarkScenario['class'];
  split: BenchmarkScenario['split'];
  chainIds: number[];
  observationStage: BenchmarkScenario['oracle']['observationStage'];
  oracleEvidenceLevel: BenchmarkScenario['oracle']['evidenceLevel'];
  mutationValidity: NonNullable<BenchmarkScenario['mutation']>['validity'] | null;
  mutationOperator: MutationOperatorId | null;
  seed: number | null;
  scenarioSha256: string;
}

export interface EvaluationCaseMatrix {
  protocolVersion: '0.1';
  datasetVersion: typeof BENCHMARK_DATASET_VERSION;
  rootSeed: 2026;
  baseCount: number;
  caseCount: number;
  casesPerBase: 5;
  entries: EvaluationCaseManifestEntry[];
  scenarios: BenchmarkScenario[];
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function derivedSeed(baseId: string, variant: MutatedVariant): number {
  const digest = createHash('sha256').update(`2026:${baseId}:${variant}`).digest();
  return digest.readUInt32BE(0);
}

function validForVariant(scenario: BenchmarkScenario, variant: MutatedVariant): boolean {
  const changes = scenario.mutation?.changes ?? [];
  if (!changes.some((change) => change.before !== change.after)) return false;
  if (variant === 'BENIGN_DRIFT') return scenario.class === 'BENIGN_DRIFT';
  if (
    scenario.class !== 'ADVERSARIAL' ||
    !scenario.mutation ||
    !['VALID_SEMANTIC', 'POST_STATE_FIXTURE'].includes(scenario.mutation.validity)
  ) {
    return false;
  }
  const actionChains = new Set(scenario.trace.actions.map((action) => action.chainId));
  for (const effect of scenario.trace.expectedEffects) {
    if (effect.kind === 'BRIDGE' && effect.sourceChainId === effect.destinationChainId)
      return false;
    if (effect.kind === 'GAS' && !actionChains.has(effect.chainId)) return false;
  }
  return true;
}

function applyFirstApplicable(
  base: BenchmarkScenario,
  variant: MutatedVariant,
): { scenario: BenchmarkScenario; operator: MutationOperatorId; seed: number } {
  const seed = derivedSeed(base.id, variant);
  const failures: string[] = [];
  for (const operator of WORKFLOW_SCHEDULE[base.workflow][variant]) {
    try {
      const scenario = applyMutation(base, operator, seed);
      if (!validForVariant(scenario, variant)) {
        failures.push(`${operator}:no-op-or-wrong-class`);
        continue;
      }
      return { scenario, operator, seed };
    } catch (error) {
      failures.push(`${operator}:${error instanceof Error ? error.name : 'unknown'}`);
    }
  }
  throw new Error(`${base.id} has no applicable ${variant} operator (${failures.join(',')})`);
}

function entry(
  base: BenchmarkScenario,
  scenario: BenchmarkScenario,
  variant: EvaluationVariant,
  operator: MutationOperatorId | null,
  seed: number | null,
): EvaluationCaseManifestEntry {
  const chainIds = [
    ...new Set([
      ...scenario.trace.actions.map((action) => action.chainId),
      ...scenario.trace.expectedEffects.flatMap((effect) =>
        effect.kind === 'BRIDGE'
          ? [effect.sourceChainId, effect.destinationChainId]
          : [effect.chainId],
      ),
    ]),
  ].sort((left, right) => left - right);
  return {
    caseId: `${base.id}--${variant}`,
    baseScenarioId: base.id,
    variant,
    workflow: base.workflow,
    class: scenario.class,
    split: scenario.split,
    chainIds,
    observationStage: scenario.oracle.observationStage,
    oracleEvidenceLevel: scenario.oracle.evidenceLevel,
    mutationValidity: scenario.mutation?.validity ?? null,
    mutationOperator: operator,
    seed,
    scenarioSha256: sha256(scenario),
  };
}

/** Creates the preregistered five-case group for every schema-valid v0.4 base. */
export function createEvaluationCaseMatrix(
  input: readonly BenchmarkScenario[],
): EvaluationCaseMatrix {
  const bases = input
    .map((scenario) => BenchmarkScenarioSchema.parse(scenario))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (bases.length !== 80)
    throw new Error(`expected 80 base scenarios, received ${String(bases.length)}`);
  if (bases.some((scenario) => scenario.class !== 'BASE'))
    throw new Error('evaluation matrix inputs must all be base scenarios');
  if (new Set(bases.map((scenario) => scenario.id)).size !== bases.length)
    throw new Error('evaluation matrix base IDs must be unique');

  const entries: EvaluationCaseManifestEntry[] = [];
  const scenarios: BenchmarkScenario[] = [];
  for (const base of bases) {
    entries.push(entry(base, base, 'BENIGN_ORIGINAL', null, null));
    scenarios.push(base);
    for (const variant of EVALUATION_VARIANTS.slice(1) as MutatedVariant[]) {
      const mutated = applyFirstApplicable(base, variant);
      entries.push(entry(base, mutated.scenario, variant, mutated.operator, mutated.seed));
      scenarios.push(mutated.scenario);
    }
  }

  if (entries.length !== 400 || scenarios.length !== 400)
    throw new Error('evaluation matrix must contain exactly 400 cases');
  if (new Set(entries.map((value) => value.caseId)).size !== 400)
    throw new Error('evaluation matrix case IDs must be unique');
  return {
    protocolVersion: '0.1',
    datasetVersion: BENCHMARK_DATASET_VERSION,
    rootSeed: 2026,
    baseCount: 80,
    caseCount: 400,
    casesPerBase: 5,
    entries,
    scenarios,
  };
}
