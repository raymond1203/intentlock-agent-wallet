import { performance } from 'node:perf_hooks';

import { z } from 'zod';

import { evaluateGuardMode } from '../baselines/guard-mode-emulator.js';
import {
  evaluateLlmVerifier,
  type LlmClient,
  type LlmVerifierConfig,
} from '../baselines/llm-verifier.js';
import type { OpenAiTokenUsage } from '../baselines/openai-responses-client.js';
import { evaluatePerCallPolicy } from '../baselines/per-call-policy.js';
import type { BaselineDecision } from '../baselines/types.js';
import type { BenchmarkScenario } from '../benchmark/scenario.js';
import { evaluatePostState } from '../oracle/post-state-oracle.js';
import type { EvaluationCaseManifestEntry } from './case-matrix.js';
import {
  EvaluationRecordSchema,
  EvaluationSystemSchema,
  type EvaluationRecord,
} from './metrics.js';
import { sha256Text, tokenCostUsd, type TokenPricing } from './protocol.js';
import { evaluateSequentialSymbolic } from './sequential-symbolic.js';

const SystemVerdictSchema = z
  .object({
    decision: z.enum(['ALLOW', 'DENY', 'ABSTAIN']),
    rationale: z.string().min(1),
    reasonCodes: z.array(z.string().min(1)),
    attempts: z.number().int().positive(),
    rawOutput: z.string().optional(),
  })
  .strict();

const TokenUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  })
  .strict();

export const RawEvaluationResultSchema = z
  .object({
    record: EvaluationRecordSchema,
    variant: z.string().min(1),
    mutationOperator: z.string().min(1).nullable(),
    oracleExpectedDecision: z.enum(['ALLOW', 'DENY', 'ESCALATE']),
    oracleViolationAmount: z.string().regex(/^(0|[1-9]\d*)$/),
    oracleAllowanceExposure: z.string().regex(/^(0|[1-9]\d*)$/),
    scenarioSha256: z.string().regex(/^[a-f0-9]{64}$/),
    postStateMonitorDecision: z.enum(['ALLOW', 'DENY', 'ABSTAIN', 'NOT_EVALUATED']),
    firstDetectionStage: z.enum(['PRE_SIGN', 'POST_STATE', 'NONE']),
    firstDetectionOrdinal: z.number().int().nonnegative().nullable(),
    verdict: SystemVerdictSchema,
    modelId: z.string().min(1).optional(),
    tokenUsage: TokenUsageSchema.optional(),
  })
  .strict()
  .superRefine((result, context) => {
    const expectedConfirmationRequests =
      result.record.preSignDecision === 'ABSTAIN' || result.postStateMonitorDecision === 'ABSTAIN'
        ? 1
        : 0;
    if (result.record.confirmationRequests !== expectedConfirmationRequests) {
      context.addIssue({
        code: 'custom',
        path: ['record', 'confirmationRequests'],
        message: 'terminal ABSTAIN requires one confirmation request; other outcomes require zero',
      });
    }
    if (result.firstDetectionOrdinal !== result.record.firstDetectionOrdinal) {
      context.addIssue({
        code: 'custom',
        path: ['firstDetectionOrdinal'],
        message: 'raw and record detection ordinals must match',
      });
    }
    if ((result.firstDetectionStage === 'NONE') !== (result.firstDetectionOrdinal === null)) {
      context.addIssue({
        code: 'custom',
        path: ['firstDetectionStage'],
        message: 'NONE is represented by a null first-detection ordinal',
      });
    }
    if (result.firstDetectionStage === 'PRE_SIGN') {
      if (
        result.firstDetectionOrdinal === null ||
        result.firstDetectionOrdinal > result.record.actionCount ||
        result.record.preSignDecision === 'ALLOW'
      ) {
        context.addIssue({
          code: 'custom',
          path: ['firstDetectionOrdinal'],
          message: 'pre-sign detection uses 0 for plan preflight or 1..N for an action check',
        });
      }
    }
    if (
      result.firstDetectionStage === 'POST_STATE' &&
      (result.firstDetectionOrdinal !== result.record.actionCount + 1 ||
        result.record.preSignDecision !== 'ALLOW' ||
        !['DENY', 'ABSTAIN'].includes(result.postStateMonitorDecision))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['firstDetectionOrdinal'],
        message: 'post-state detection uses ordinal N+1 after a pre-sign ALLOW',
      });
    }
  });

export type RawEvaluationResult = z.infer<typeof RawEvaluationResultSchema>;

export interface UsageReportingLlmClient extends LlmClient {
  usage(): OpenAiTokenUsage;
}

export interface LlmRunOptions {
  config: LlmVerifierConfig;
  createClient: () => UsageReportingLlmClient;
  pricing: TokenPricing;
}

export interface EvaluateCaseOptions {
  runId: string;
  system: EvaluationRecord['system'];
  scenario: BenchmarkScenario;
  entry: EvaluationCaseManifestEntry;
  evaluatedAt: string;
  llm?: LlmRunOptions;
}

interface SystemVerdict {
  decision: BaselineDecision;
  rationale: string;
  reasonCodes: string[];
  attempts: number;
  firstDetectionOrdinal: number | null;
  rawOutput?: string;
  tokenUsage?: OpenAiTokenUsage;
  modelId?: string;
}

function intentLockVerdict(scenario: BenchmarkScenario, evaluatedAt: string): SystemVerdict {
  const verdict = evaluateSequentialSymbolic(scenario, evaluatedAt, {
    acceptedEffectHistory: true,
    recursiveDecoder: true,
    confirmationPolicy: 'AUTONOMOUS',
  });
  return {
    decision: verdict.decision,
    rationale: verdict.rationale,
    reasonCodes: verdict.reasonCodes,
    attempts: verdict.attempts,
    firstDetectionOrdinal: verdict.firstDetectionActionOrdinal,
  };
}

async function systemVerdict(options: EvaluateCaseOptions): Promise<SystemVerdict> {
  switch (options.system) {
    case 'NONE':
      return {
        decision: 'ALLOW',
        rationale: 'No-defense arm attempts every schema-valid offline trace.',
        reasonCodes: [],
        attempts: 1,
        firstDetectionOrdinal: null,
      };
    case 'GUARD_MODE': {
      const verdict = evaluateGuardMode(options.scenario, options.evaluatedAt, 'STRICT');
      return {
        decision: verdict.decision,
        rationale: verdict.rationale,
        reasonCodes: verdict.reasonCodes,
        attempts: verdict.attempts,
        firstDetectionOrdinal: verdict.decision === 'ALLOW' ? null : 0,
        ...(verdict.rawOutput === undefined ? {} : { rawOutput: verdict.rawOutput }),
      };
    }
    case 'PER_CALL_POLICY': {
      const verdict = evaluatePerCallPolicy(options.scenario, options.evaluatedAt);
      return {
        decision: verdict.decision,
        rationale: verdict.rationale,
        reasonCodes: verdict.reasonCodes,
        attempts: verdict.attempts,
        firstDetectionOrdinal: verdict.firstDetectionActionOrdinal ?? null,
        ...(verdict.rawOutput === undefined ? {} : { rawOutput: verdict.rawOutput }),
      };
    }
    case 'INTENTLOCK':
      return intentLockVerdict(options.scenario, options.evaluatedAt);
    case 'LLM_VERIFIER': {
      if (!options.llm) throw new Error('LLM_VERIFIER requires llm run options');
      const client = options.llm.createClient();
      const verdict = await evaluateLlmVerifier(options.scenario, options.llm.config, client);
      return {
        decision: verdict.decision,
        rationale: verdict.rationale,
        reasonCodes: verdict.reasonCodes,
        attempts: verdict.attempts,
        firstDetectionOrdinal:
          verdict.decision === 'ALLOW' || verdict.reasonCodes.includes('LLM_OUTPUT_UNAVAILABLE')
            ? null
            : 0,
        ...(verdict.rawOutput === undefined ? {} : { rawOutput: verdict.rawOutput }),
        tokenUsage: client.usage(),
        modelId: options.llm.config.model,
      };
    }
  }
}

function groundTruthStatus(
  expected: BenchmarkScenario['oracle']['expectedDecision'],
): EvaluationRecord['postStateStatus'] {
  switch (expected) {
    case 'ALLOW':
      return 'PASS';
    case 'DENY':
      return 'VIOLATION';
    case 'ESCALATE':
      return 'INSUFFICIENT_EVIDENCE';
  }
}

function intentLockPostStateDecision(scenario: BenchmarkScenario): 'ALLOW' | 'DENY' | 'ABSTAIN' {
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

function recordFromVerdict(
  options: EvaluateCaseOptions,
  verdict: SystemVerdict,
  latencyMs: number,
  firstDetectionOrdinal: number | null,
  confirmationRequests: 0 | 1,
): EvaluationRecord {
  const allowed = verdict.decision === 'ALLOW';
  const invalidCalldata = options.scenario.mutation?.validity === 'INVALID_CALLDATA';
  const llmUnavailable = verdict.reasonCodes.includes('LLM_OUTPUT_UNAVAILABLE');
  const llmTimedOut = llmUnavailable && verdict.rationale.toLowerCase().includes('timed out');
  const postStateStatus = groundTruthStatus(options.scenario.oracle.expectedDecision);
  const counterfactualEconomicEffectIssued =
    allowed &&
    !invalidCalldata &&
    options.scenario.trace.actions.length > 0 &&
    options.scenario.trace.expectedEffects.some(
      (effect) => effect.kind !== 'UNKNOWN' && effect.kind !== 'GAS',
    );
  const tokenCost =
    verdict.tokenUsage && options.llm
      ? tokenCostUsd(verdict.tokenUsage, options.llm.pricing)
      : undefined;
  const executionStatus: EvaluationRecord['executionStatus'] = allowed
    ? invalidCalldata
      ? 'UNSUPPORTED'
      : 'REPLAYED'
    : llmUnavailable
      ? llmTimedOut
        ? 'TIMEOUT'
        : 'FAILED'
      : 'NOT_ATTEMPTED';
  const observedPostState: EvaluationRecord['postStateStatus'] = allowed
    ? invalidCalldata
      ? 'INSUFFICIENT_EVIDENCE'
      : postStateStatus
    : llmUnavailable
      ? 'INSUFFICIENT_EVIDENCE'
      : 'NOT_OBSERVED';
  return EvaluationRecordSchema.parse({
    runId: options.runId,
    caseId: options.entry.caseId,
    baseScenarioId: options.entry.baseScenarioId,
    system: options.system,
    workflow: options.scenario.workflow,
    class: options.scenario.class,
    split: options.scenario.split,
    chainIds: options.entry.chainIds,
    actionCount: options.scenario.trace.actions.length,
    observationStage: options.scenario.oracle.observationStage,
    oracleEvidenceLevel: options.entry.oracleEvidenceLevel,
    mutationValidity: options.entry.mutationValidity,
    evaluationMode: 'OFFLINE_COUNTERFACTUAL_REPLAY',
    preSignDecision: verdict.decision,
    confirmationRequests,
    firstDetectionOrdinal,
    executionStatus,
    postStateStatus: observedPostState,
    postStateEvidence:
      observedPostState === 'PASS' || observedPostState === 'VIOLATION'
        ? 'AUTHORED_ORACLE_FIXTURE'
        : 'NONE',
    counterfactualEconomicEffectIssued,
    counterfactualBenignCompletion:
      allowed &&
      !invalidCalldata &&
      options.scenario.class !== 'ADVERSARIAL' &&
      postStateStatus === 'PASS',
    latencyMs,
    ...(tokenCost === undefined ? {} : { tokenCost }),
    ...(llmUnavailable
      ? { failureClass: llmTimedOut ? 'LLM_TIMEOUT' : 'LLM_OUTPUT_UNAVAILABLE' }
      : invalidCalldata && allowed
        ? { failureClass: 'INVALID_CALLDATA' }
        : {}),
  });
}

function failureResult(
  options: EvaluateCaseOptions,
  error: unknown,
  latencyMs: number,
): RawEvaluationResult {
  const failureClass = error instanceof Error ? error.name : 'UnknownError';
  const record = EvaluationRecordSchema.parse({
    runId: options.runId,
    caseId: options.entry.caseId,
    baseScenarioId: options.entry.baseScenarioId,
    system: options.system,
    workflow: options.scenario.workflow,
    class: options.scenario.class,
    split: options.scenario.split,
    chainIds: options.entry.chainIds,
    actionCount: options.scenario.trace.actions.length,
    observationStage: options.scenario.oracle.observationStage,
    oracleEvidenceLevel: options.entry.oracleEvidenceLevel,
    mutationValidity: options.entry.mutationValidity,
    evaluationMode: 'OFFLINE_COUNTERFACTUAL_REPLAY',
    preSignDecision: 'ABSTAIN',
    confirmationRequests: 1,
    firstDetectionOrdinal: null,
    executionStatus: 'FAILED',
    postStateStatus: 'INSUFFICIENT_EVIDENCE',
    postStateEvidence: 'NONE',
    counterfactualEconomicEffectIssued: false,
    counterfactualBenignCompletion: false,
    latencyMs,
    failureClass,
  });
  return RawEvaluationResultSchema.parse({
    record,
    variant: options.entry.variant,
    mutationOperator: options.entry.mutationOperator,
    oracleExpectedDecision: options.scenario.oracle.expectedDecision,
    oracleViolationAmount: options.scenario.oracle.violationAmount ?? '0',
    oracleAllowanceExposure: options.scenario.oracle.allowanceExposure ?? '0',
    scenarioSha256: options.entry.scenarioSha256,
    postStateMonitorDecision: 'NOT_EVALUATED',
    firstDetectionStage: 'NONE',
    firstDetectionOrdinal: null,
    verdict: {
      decision: 'ABSTAIN',
      rationale: `Evaluation failed with ${failureClass}; the error message is omitted from public raw data.`,
      reasonCodes: ['EVALUATION_FAILURE'],
      attempts: 1,
    },
  });
}

/** Evaluates one system/case pair and converts all failures into explicit records. */
export async function evaluateCase(options: EvaluateCaseOptions): Promise<RawEvaluationResult> {
  EvaluationSystemSchema.parse(options.system);
  const actualHash = sha256Text(JSON.stringify(options.scenario));
  if (actualHash !== options.entry.scenarioSha256) {
    throw new Error(`scenario hash mismatch for ${options.entry.caseId}`);
  }
  const started = performance.now();
  try {
    const verdict = await systemVerdict(options);
    const invalidCalldata = options.scenario.mutation?.validity === 'INVALID_CALLDATA';
    const llmUnavailable = verdict.reasonCodes.includes('LLM_OUTPUT_UNAVAILABLE');
    const postStateMonitorDecision =
      options.system !== 'INTENTLOCK' || verdict.decision !== 'ALLOW' || invalidCalldata
        ? 'NOT_EVALUATED'
        : intentLockPostStateDecision(options.scenario);
    const firstDetectionOrdinal =
      verdict.decision !== 'ALLOW' && !llmUnavailable
        ? verdict.firstDetectionOrdinal
        : postStateMonitorDecision === 'DENY' || postStateMonitorDecision === 'ABSTAIN'
          ? options.scenario.trace.actions.length + 1
          : null;
    const firstDetectionStage =
      firstDetectionOrdinal === null
        ? 'NONE'
        : firstDetectionOrdinal === options.scenario.trace.actions.length + 1
          ? 'POST_STATE'
          : 'PRE_SIGN';
    const confirmationRequests =
      verdict.decision === 'ABSTAIN' || postStateMonitorDecision === 'ABSTAIN' ? 1 : 0;
    const record = recordFromVerdict(
      options,
      verdict,
      performance.now() - started,
      firstDetectionOrdinal,
      confirmationRequests,
    );
    return RawEvaluationResultSchema.parse({
      record,
      variant: options.entry.variant,
      mutationOperator: options.entry.mutationOperator,
      oracleExpectedDecision: options.scenario.oracle.expectedDecision,
      oracleViolationAmount: options.scenario.oracle.violationAmount ?? '0',
      oracleAllowanceExposure: options.scenario.oracle.allowanceExposure ?? '0',
      scenarioSha256: options.entry.scenarioSha256,
      postStateMonitorDecision,
      firstDetectionStage,
      firstDetectionOrdinal,
      verdict: {
        decision: verdict.decision,
        rationale: verdict.rationale,
        reasonCodes: verdict.reasonCodes,
        attempts: verdict.attempts,
        ...(verdict.rawOutput === undefined ? {} : { rawOutput: verdict.rawOutput }),
      },
      ...(verdict.modelId === undefined ? {} : { modelId: verdict.modelId }),
      ...(verdict.tokenUsage === undefined ? {} : { tokenUsage: verdict.tokenUsage }),
    });
  } catch (error) {
    return failureResult(options, error, performance.now() - started);
  }
}
