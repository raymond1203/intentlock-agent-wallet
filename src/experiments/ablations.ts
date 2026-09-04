import { performance } from 'node:perf_hooks';

import { z } from 'zod';

import type { BenchmarkScenario } from '../benchmark/scenario.js';
import { evaluatePostState } from '../oracle/post-state-oracle.js';
import type { EvaluationCaseManifestEntry } from './case-matrix.js';
import { RawEvaluationResultSchema, type RawEvaluationResult } from './evaluate-case.js';
import { FreezeDigestsSchema } from './freeze-digests.js';
import { EvaluationRecordSchema, type EvaluationRecord } from './metrics.js';
import { sha256Text } from './protocol.js';
import {
  evaluateSequentialSymbolic,
  type SequentialSymbolicVerdict as SymbolicVerdict,
} from './sequential-symbolic.js';

export const AblationArmSchema = z.enum([
  'INTENTLOCK_FULL',
  'SEMANTIC_ONLY',
  'SYMBOLIC_ONLY',
  'HYBRID_CONJUNCTION',
  'STATELESS_LEDGER',
  'SHALLOW_DECODER',
  'NO_POST_STATE_VERIFIER',
  'CONFIRMATION_ALWAYS',
]);
export type AblationArm = z.infer<typeof AblationArmSchema>;
export const ABLATION_ARMS: readonly AblationArm[] = AblationArmSchema.options;

export const AblationArmKindSchema = z.enum([
  'REFERENCE',
  'STAGE_COMPARISON',
  'ONE_FACTOR_ABLATION',
  'POLICY_VARIANT',
]);
export type AblationArmKind = z.infer<typeof AblationArmKindSchema>;

export const AblationEvaluatorConfigurationSchema = z
  .object({
    symbolicMonitor: z.boolean(),
    acceptedEffectHistory: z.boolean(),
    recursiveDecoder: z.boolean(),
    postStateReconciliation: z.boolean(),
    confirmationPolicy: z.enum(['AUTONOMOUS', 'ALWAYS_CONFIRM']),
    semanticDecisionSource: z.enum(['NONE', 'PRIMARY_LLM_RESULT']),
    decisionComposition: z.enum(['SYMBOLIC', 'SEMANTIC', 'CONJUNCTION']),
  })
  .strict();
export type AblationEvaluatorConfiguration = z.infer<typeof AblationEvaluatorConfigurationSchema>;

interface ArmMetadata {
  kind: AblationArmKind;
  causalAblation: boolean;
  changedFactor: string;
  configuration: AblationEvaluatorConfiguration;
  nonCausalReason: string | null;
}

const FULL_CONFIGURATION: AblationEvaluatorConfiguration = {
  symbolicMonitor: true,
  acceptedEffectHistory: true,
  recursiveDecoder: true,
  postStateReconciliation: true,
  confirmationPolicy: 'AUTONOMOUS',
  semanticDecisionSource: 'NONE',
  decisionComposition: 'SYMBOLIC',
};

export const ARM_METADATA: Readonly<Record<AblationArm, ArmMetadata>> = {
  INTENTLOCK_FULL: {
    kind: 'REFERENCE',
    causalAblation: false,
    changedFactor: 'reference configuration',
    configuration: FULL_CONFIGURATION,
    nonCausalReason: null,
  },
  SEMANTIC_ONLY: {
    kind: 'STAGE_COMPARISON',
    causalAblation: false,
    changedFactor: 'non-causal primary LLM stage comparator',
    configuration: {
      symbolicMonitor: false,
      acceptedEffectHistory: false,
      recursiveDecoder: false,
      postStateReconciliation: false,
      confirmationPolicy: 'AUTONOMOUS',
      semanticDecisionSource: 'PRIMARY_LLM_RESULT',
      decisionComposition: 'SEMANTIC',
    },
    nonCausalReason:
      'This row references the frozen primary LLM result and changes multiple stages; it is not a causal component ablation.',
  },
  SYMBOLIC_ONLY: {
    kind: 'STAGE_COMPARISON',
    causalAblation: false,
    changedFactor: 'symbolic runtime starting from the confirmed contract',
    configuration: FULL_CONFIGURATION,
    nonCausalReason:
      'The corpus already starts from a confirmed contract, so this is a stage score rather than a semantic-stage ablation.',
  },
  HYBRID_CONJUNCTION: {
    kind: 'STAGE_COMPARISON',
    causalAblation: false,
    changedFactor: 'non-causal conjunction with the frozen primary LLM decision',
    configuration: {
      ...FULL_CONFIGURATION,
      semanticDecisionSource: 'PRIMARY_LLM_RESULT',
      decisionComposition: 'CONJUNCTION',
    },
    nonCausalReason:
      'The hybrid combines a fresh symbolic replay with a frozen primary LLM result and is reported only as a non-causal stage comparison.',
  },
  STATELESS_LEDGER: {
    kind: 'ONE_FACTOR_ABLATION',
    causalAblation: true,
    changedFactor: 'acceptedEffectHistory',
    configuration: { ...FULL_CONFIGURATION, acceptedEffectHistory: false },
    nonCausalReason: null,
  },
  SHALLOW_DECODER: {
    kind: 'ONE_FACTOR_ABLATION',
    causalAblation: true,
    changedFactor: 'recursiveDecoder',
    configuration: { ...FULL_CONFIGURATION, recursiveDecoder: false },
    nonCausalReason: null,
  },
  NO_POST_STATE_VERIFIER: {
    kind: 'ONE_FACTOR_ABLATION',
    causalAblation: true,
    changedFactor: 'postStateReconciliation',
    configuration: { ...FULL_CONFIGURATION, postStateReconciliation: false },
    nonCausalReason: null,
  },
  CONFIRMATION_ALWAYS: {
    kind: 'POLICY_VARIANT',
    causalAblation: false,
    changedFactor: 'confirmationPolicy',
    configuration: { ...FULL_CONFIGURATION, confirmationPolicy: 'ALWAYS_CONFIRM' },
    nonCausalReason:
      'Always-confirm is a separate interaction policy and is not interpreted as a causal component ablation.',
  },
};

export function ablationConfiguration(arm: AblationArm): AblationEvaluatorConfiguration {
  return structuredClone(ARM_METADATA[arm].configuration);
}

export function configurationDiff(
  referenceInput: AblationEvaluatorConfiguration,
  candidateInput: AblationEvaluatorConfiguration,
): string[] {
  const reference = AblationEvaluatorConfigurationSchema.parse(referenceInput);
  const candidate = AblationEvaluatorConfigurationSchema.parse(candidateInput);
  return (Object.keys(reference) as Array<keyof AblationEvaluatorConfiguration>).filter(
    (key) => reference[key] !== candidate[key],
  );
}

export function validateOneFactorConfigurations(): void {
  const reference = ablationConfiguration('INTENTLOCK_FULL');
  const expected: Readonly<Record<string, keyof AblationEvaluatorConfiguration>> = {
    STATELESS_LEDGER: 'acceptedEffectHistory',
    SHALLOW_DECODER: 'recursiveDecoder',
    NO_POST_STATE_VERIFIER: 'postStateReconciliation',
  };
  for (const [arm, factor] of Object.entries(expected)) {
    const diff = configurationDiff(reference, ablationConfiguration(AblationArmSchema.parse(arm)));
    if (diff.length !== 1 || diff[0] !== factor) {
      throw new Error(`${arm} must differ from INTENTLOCK_FULL only in ${factor}`);
    }
  }
}

const AblationManifestArmSchema = z
  .object({
    id: AblationArmSchema,
    kind: z.enum([
      'reference',
      'stage-comparison',
      'one-factor-ablation',
      'one-factor-policy-variant',
    ]),
    changedFactor: z.string().min(1),
    hypothesis: z.string().min(1),
  })
  .strict();

const AblationFreezeSchema = z
  .object({
    gitCommit: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .describe('Human-reviewed semantic candidate commit A, before the freeze-envelope commit')
      .nullable(),
    frozenAt: z.iso.datetime().nullable(),
    humanReviewer: z.string().min(1).nullable(),
  })
  .strict();

export const AblationManifestSchema = z
  .object({
    schemaVersion: z.literal('0.1'),
    status: z.enum(['CANDIDATE_UNFROZEN', 'FROZEN']),
    primaryRunRequired: z.literal(true),
    seed: z.literal(2026),
    cases: z.literal(400),
    arms: z.array(AblationManifestArmSchema).length(8),
    interpretation: z.string().min(1),
    freeze: AblationFreezeSchema,
  })
  .strict()
  .superRefine((manifest, context) => {
    if (JSON.stringify(manifest.arms.map((arm) => arm.id)) !== JSON.stringify(ABLATION_ARMS)) {
      context.addIssue({
        code: 'custom',
        path: ['arms'],
        message: 'manifest arms must exactly match the preregistered order',
      });
    }
    for (const arm of manifest.arms) {
      const metadata = ARM_METADATA[arm.id];
      const expectedKind =
        metadata.kind === 'REFERENCE'
          ? 'reference'
          : metadata.kind === 'STAGE_COMPARISON'
            ? 'stage-comparison'
            : metadata.kind === 'ONE_FACTOR_ABLATION'
              ? 'one-factor-ablation'
              : 'one-factor-policy-variant';
      if (arm.kind !== expectedKind || arm.changedFactor !== metadata.changedFactor) {
        context.addIssue({
          code: 'custom',
          path: ['arms', arm.id],
          message: 'manifest kind or changedFactor differs from the evaluator configuration',
        });
      }
    }
  });

export const ReadyAblationManifestSchema = AblationManifestSchema.safeExtend({
  status: z.literal('FROZEN'),
  freeze: AblationFreezeSchema.extend({
    gitCommit: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .describe('Human-reviewed semantic candidate commit A'),
    frozenAt: z.iso.datetime(),
    humanReviewer: z.string().min(1),
  }),
});

export const AblationProvenanceSchema = z
  .object({
    source: z.enum([
      'FRESH_SCENARIO_EVALUATION',
      'PRIMARY_LLM_REFERENCE',
      'FRESH_PLUS_PRIMARY_LLM',
    ]),
    evaluatorVersion: z.literal('0.2'),
    scenarioSha256: z.string().regex(/^[a-f0-9]{64}$/),
    caseManifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    primaryRunId: z.string().min(1).nullable(),
    primaryResultSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
  })
  .strict();

export const AblationResultSchema = z
  .object({
    schemaVersion: z.literal('0.2'),
    runId: z.string().min(1),
    arm: AblationArmSchema,
    kind: AblationArmKindSchema,
    causalAblation: z.boolean(),
    changedFactor: z.string().min(1),
    nonCausalReason: z.string().min(1).nullable(),
    configuration: AblationEvaluatorConfigurationSchema,
    variant: z.string().min(1),
    mutationOperator: z.string().min(1).nullable(),
    result: RawEvaluationResultSchema,
    provenance: AblationProvenanceSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const metadata = ARM_METADATA[value.arm];
    if (
      value.kind !== metadata.kind ||
      value.causalAblation !== metadata.causalAblation ||
      value.changedFactor !== metadata.changedFactor ||
      JSON.stringify(value.configuration) !== JSON.stringify(metadata.configuration)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['configuration'],
        message: 'result metadata differs from the preregistered arm',
      });
    }
    if (
      metadata.kind === 'ONE_FACTOR_ABLATION' &&
      value.provenance.source !== 'FRESH_SCENARIO_EVALUATION'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['provenance', 'source'],
        message: 'causal ablations require fresh scenario evaluation',
      });
    }
    if (metadata.kind === 'STAGE_COMPARISON' && !value.nonCausalReason) {
      context.addIssue({
        code: 'custom',
        path: ['nonCausalReason'],
        message: 'stage comparisons require an explicit non-causal reason',
      });
    }
  });
export type AblationResult = z.infer<typeof AblationResultSchema>;

export const AblationRawEnvelopeSchema = z
  .object({
    schemaVersion: z.literal('0.1'),
    sequence: z.number().int().nonnegative(),
    recordedAt: z.iso.datetime(),
    value: AblationResultSchema,
  })
  .strict();

export const AblationRunManifestSchema = z
  .object({
    schemaVersion: z.literal('0.2'),
    runId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,79}$/),
    createdAt: z.iso.datetime(),
    gitCommit: z.string().regex(/^[a-f0-9]{40}$/),
    primaryExecutionCommit: z.string().regex(/^[a-f0-9]{40}$/),
    executionCommit: z.string().regex(/^[a-f0-9]{40}$/),
    primaryRunId: z.string().min(1),
    primaryRunManifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    primaryRawSha256: z.string().regex(/^[a-f0-9]{64}$/),
    primarySummarySha256: z.string().regex(/^[a-f0-9]{64}$/),
    primarySummaryCsvSha256: z.string().regex(/^[a-f0-9]{64}$/),
    primarySelectedResultsSha256: z.string().regex(/^[a-f0-9]{64}$/),
    frozenEvalSha256: z.string().regex(/^[a-f0-9]{64}$/),
    ablationManifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    caseManifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    freezeDigests: FreezeDigestsSchema,
    rootSeed: z.literal(2026),
    caseCount: z.literal(400),
    arms: z.array(AblationArmSchema).length(8),
    expectedRecords: z.literal(3200),
    evaluationMode: z.literal('OFFLINE_COUNTERFACTUAL_REPLAY'),
    appendOnly: z.literal(true),
    overwrite: z.literal(false),
  })
  .strict();

function postStateDecision(scenario: BenchmarkScenario): 'ALLOW' | 'DENY' | 'ABSTAIN' {
  const result = evaluatePostState({
    contract: scenario.intent,
    preState: scenario.oracle.preState,
    postState: scenario.oracle.postState,
    evidenceLevel: 'EXPECTED_FIXTURE',
    observedEffects: scenario.trace.expectedEffects,
    ...(scenario.oracle.referenceMode === 'ABSOLUTE'
      ? { expectedPostState: scenario.oracle.postState }
      : { expectedDeltas: scenario.oracle.expectedDeltas }),
    executionComplete: scenario.oracle.executionComplete,
  });
  return result.status === 'PASS' ? 'ALLOW' : result.status === 'VIOLATION' ? 'DENY' : 'ABSTAIN';
}

function postStatus(decision: 'ALLOW' | 'DENY' | 'ABSTAIN'): EvaluationRecord['postStateStatus'] {
  return decision === 'ALLOW'
    ? 'PASS'
    : decision === 'DENY'
      ? 'VIOLATION'
      : 'INSUFFICIENT_EVIDENCE';
}

function authoredOutcomeStatus(
  expected: BenchmarkScenario['oracle']['expectedDecision'],
): EvaluationRecord['postStateStatus'] {
  return expected === 'ALLOW'
    ? 'PASS'
    : expected === 'DENY'
      ? 'VIOLATION'
      : 'INSUFFICIENT_EVIDENCE';
}

function buildFreshRawResult(input: {
  runId: string;
  scenario: BenchmarkScenario;
  entry: EvaluationCaseManifestEntry;
  configuration: AblationEvaluatorConfiguration;
  verdict: SymbolicVerdict;
  latencyMs: number;
}): RawEvaluationResult {
  const allowed = input.verdict.decision === 'ALLOW';
  const invalidCalldata = input.scenario.mutation?.validity === 'INVALID_CALLDATA';
  const reconcile = allowed && !invalidCalldata && input.configuration.postStateReconciliation;
  const postDecision = reconcile ? postStateDecision(input.scenario) : 'NOT_EVALUATED';
  const counterfactualEconomicEffectIssued =
    allowed &&
    !invalidCalldata &&
    input.scenario.trace.expectedEffects.some(
      (effect) => effect.kind !== 'UNKNOWN' && effect.kind !== 'GAS',
    );
  const observedMonitorStatus =
    postDecision === 'NOT_EVALUATED' ? 'NOT_OBSERVED' : postStatus(postDecision);
  const counterfactualOutcomeStatus = authoredOutcomeStatus(input.scenario.oracle.expectedDecision);
  const recordPostStateStatus = allowed
    ? invalidCalldata
      ? 'INSUFFICIENT_EVIDENCE'
      : counterfactualOutcomeStatus
    : 'NOT_OBSERVED';
  const firstDetectionOrdinal =
    input.verdict.decision !== 'ALLOW'
      ? input.verdict.firstDetectionActionOrdinal
      : observedMonitorStatus === 'VIOLATION' || observedMonitorStatus === 'INSUFFICIENT_EVIDENCE'
        ? input.scenario.trace.actions.length + 1
        : null;
  const record = EvaluationRecordSchema.parse({
    runId: input.runId,
    caseId: input.entry.caseId,
    baseScenarioId: input.entry.baseScenarioId,
    system: 'INTENTLOCK',
    evaluationMode: 'OFFLINE_COUNTERFACTUAL_REPLAY',
    chainIds: input.entry.chainIds,
    oracleEvidenceLevel: input.entry.oracleEvidenceLevel,
    mutationValidity: input.entry.mutationValidity,
    workflow: input.scenario.workflow,
    class: input.scenario.class,
    split: input.scenario.split,
    actionCount: input.scenario.trace.actions.length,
    observationStage: input.scenario.oracle.observationStage,
    preSignDecision: input.verdict.decision,
    confirmationRequests:
      input.verdict.decision === 'ABSTAIN' || postDecision === 'ABSTAIN' ? 1 : 0,
    firstDetectionOrdinal,
    executionStatus: allowed ? (invalidCalldata ? 'UNSUPPORTED' : 'REPLAYED') : 'NOT_ATTEMPTED',
    postStateStatus: recordPostStateStatus,
    postStateEvidence:
      recordPostStateStatus === 'PASS' || recordPostStateStatus === 'VIOLATION'
        ? 'AUTHORED_ORACLE_FIXTURE'
        : 'NONE',
    counterfactualEconomicEffectIssued,
    counterfactualBenignCompletion:
      allowed &&
      !invalidCalldata &&
      input.scenario.class !== 'ADVERSARIAL' &&
      counterfactualOutcomeStatus === 'PASS',
    latencyMs: input.latencyMs,
    ...(invalidCalldata && allowed ? { failureClass: 'INVALID_CALLDATA' } : {}),
  });
  return RawEvaluationResultSchema.parse({
    record,
    variant: input.entry.variant,
    mutationOperator: input.entry.mutationOperator,
    oracleExpectedDecision: input.scenario.oracle.expectedDecision,
    oracleViolationAmount: input.scenario.oracle.violationAmount ?? '0',
    oracleAllowanceExposure: input.scenario.oracle.allowanceExposure ?? '0',
    scenarioSha256: input.entry.scenarioSha256,
    postStateMonitorDecision: postDecision,
    firstDetectionStage:
      input.verdict.decision !== 'ALLOW'
        ? 'PRE_SIGN'
        : observedMonitorStatus === 'VIOLATION' || observedMonitorStatus === 'INSUFFICIENT_EVIDENCE'
          ? 'POST_STATE'
          : 'NONE',
    firstDetectionOrdinal,
    verdict: {
      decision: input.verdict.decision,
      rationale: input.verdict.rationale,
      reasonCodes: input.verdict.reasonCodes,
      attempts: input.verdict.attempts,
    },
  });
}

function validatePrimaryLlm(
  primary: RawEvaluationResult | undefined,
  entry: EvaluationCaseManifestEntry,
): RawEvaluationResult {
  if (!primary) throw new Error(`primary LLM result missing for ${entry.caseId}`);
  const parsed = RawEvaluationResultSchema.parse(primary);
  if (
    parsed.record.system !== 'LLM_VERIFIER' ||
    parsed.record.caseId !== entry.caseId ||
    parsed.scenarioSha256 !== entry.scenarioSha256
  ) {
    throw new Error(`primary LLM provenance mismatch for ${entry.caseId}`);
  }
  return parsed;
}

function hybridVerdict(symbolic: SymbolicVerdict, semantic: RawEvaluationResult): SymbolicVerdict {
  const decisions = [symbolic.decision, semantic.verdict.decision];
  const decision = decisions.includes('DENY')
    ? 'DENY'
    : decisions.includes('ABSTAIN')
      ? 'ABSTAIN'
      : 'ALLOW';
  return {
    decision,
    rationale: 'Conjunction of a fresh symbolic replay and the frozen primary LLM decision.',
    reasonCodes: [
      ...symbolic.reasonCodes.map((code) => `SYMBOLIC:${code}`),
      ...semantic.verdict.reasonCodes.map((code) => `SEMANTIC:${code}`),
    ],
    attempts: symbolic.attempts + semantic.verdict.attempts,
    firstDetectionActionOrdinal:
      semantic.verdict.decision !== 'ALLOW'
        ? 0
        : decision !== 'ALLOW'
          ? symbolic.firstDetectionActionOrdinal
          : null,
  };
}

export interface EvaluateAblationCaseInput {
  runId: string;
  arm: AblationArm;
  scenario: BenchmarkScenario;
  entry: EvaluationCaseManifestEntry;
  evaluatedAt: string;
  caseManifestSha256: string;
  primaryRunId: string;
  primaryLlmResult?: RawEvaluationResult;
}

/** Evaluates a frozen case under the arm configuration; only stage rows may reference LLM output. */
export function evaluateAblationCase(input: EvaluateAblationCaseInput): AblationResult {
  if (sha256Text(JSON.stringify(input.scenario)) !== input.entry.scenarioSha256) {
    throw new Error(`scenario hash mismatch for ${input.entry.caseId}`);
  }
  const metadata = ARM_METADATA[input.arm];
  const started = performance.now();
  let result: RawEvaluationResult;
  let source: z.infer<typeof AblationProvenanceSchema>['source'] = 'FRESH_SCENARIO_EVALUATION';
  let primaryResultSha256: string | null = null;

  if (input.arm === 'SEMANTIC_ONLY') {
    const primary = validatePrimaryLlm(input.primaryLlmResult, input.entry);
    result = primary;
    source = 'PRIMARY_LLM_REFERENCE';
    primaryResultSha256 = sha256Text(JSON.stringify(primary));
  } else {
    if (!metadata.configuration.symbolicMonitor) throw new Error('symbolic evaluator is disabled');
    const symbolic = evaluateSequentialSymbolic(
      input.scenario,
      input.evaluatedAt,
      metadata.configuration,
    );
    if (input.arm === 'HYBRID_CONJUNCTION') {
      const primary = validatePrimaryLlm(input.primaryLlmResult, input.entry);
      result = buildFreshRawResult({
        runId: input.runId,
        scenario: input.scenario,
        entry: input.entry,
        configuration: metadata.configuration,
        verdict: hybridVerdict(symbolic, primary),
        latencyMs: performance.now() - started + primary.record.latencyMs,
      });
      source = 'FRESH_PLUS_PRIMARY_LLM';
      primaryResultSha256 = sha256Text(JSON.stringify(primary));
    } else {
      result = buildFreshRawResult({
        runId: input.runId,
        scenario: input.scenario,
        entry: input.entry,
        configuration: metadata.configuration,
        verdict: symbolic,
        latencyMs: performance.now() - started,
      });
    }
  }

  return AblationResultSchema.parse({
    schemaVersion: '0.2',
    runId: input.runId,
    arm: input.arm,
    kind: metadata.kind,
    causalAblation: metadata.causalAblation,
    changedFactor: metadata.changedFactor,
    nonCausalReason: metadata.nonCausalReason,
    configuration: metadata.configuration,
    variant: input.entry.variant,
    mutationOperator: input.entry.mutationOperator,
    result,
    provenance: {
      source,
      evaluatorVersion: '0.2',
      scenarioSha256: input.entry.scenarioSha256,
      caseManifestSha256: input.caseManifestSha256,
      primaryRunId: source === 'FRESH_SCENARIO_EVALUATION' ? null : input.primaryRunId,
      primaryResultSha256,
    },
  });
}
