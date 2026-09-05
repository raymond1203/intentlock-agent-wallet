import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { applyMutation, type MutationOperatorId } from '../../src/benchmark/mutations/index.js';
import { BenchmarkScenarioSchema } from '../../src/benchmark/scenario.js';
import type { EvaluationCaseManifestEntry } from '../../src/experiments/case-matrix.js';
import { evaluateCase, type UsageReportingLlmClient } from '../../src/experiments/evaluate-case.js';
import { sha256Text } from '../../src/experiments/protocol.js';

const base = BenchmarkScenarioSchema.parse(
  JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, '../../benchmark/scenarios/base/transfer/tr-01.json'),
      'utf8',
    ),
  ),
);
const staleQuote = BenchmarkScenarioSchema.parse(
  JSON.parse(
    readFileSync(
      resolve(
        import.meta.dirname,
        '../../benchmark/scenarios/mutations/ss-01-stale-quote-2026.json',
      ),
      'utf8',
    ),
  ),
);
const partialCompletion = BenchmarkScenarioSchema.parse(
  JSON.parse(
    readFileSync(
      resolve(
        import.meta.dirname,
        '../../benchmark/scenarios/mutations/br-01-partial-completion-2026.json',
      ),
      'utf8',
    ),
  ),
);
const permit2Approval = BenchmarkScenarioSchema.parse(
  JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, '../../benchmark/scenarios/base/transfer/ap-03.json'),
      'utf8',
    ),
  ),
);
const zeroApprovalRevoke = BenchmarkScenarioSchema.parse(
  JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, '../../benchmark/scenarios/base/batch/ba-02.json'),
      'utf8',
    ),
  ),
);

function entryFor(
  scenario: typeof base,
  variant: EvaluationCaseManifestEntry['variant'],
): EvaluationCaseManifestEntry {
  const baseScenarioId = scenario.provenance.baseScenarioId ?? scenario.id;
  return {
    caseId: `${baseScenarioId}--${variant}`,
    baseScenarioId,
    variant,
    workflow: scenario.workflow,
    class: scenario.class,
    split: scenario.split,
    chainIds: [
      ...new Set([
        ...scenario.trace.actions.map((action) => action.chainId),
        ...scenario.trace.expectedEffects.flatMap((effect) =>
          effect.kind === 'BRIDGE'
            ? [effect.sourceChainId, effect.destinationChainId]
            : [effect.chainId],
        ),
      ]),
    ].sort((left, right) => left - right),
    observationStage: scenario.oracle.observationStage,
    oracleEvidenceLevel: scenario.oracle.evidenceLevel,
    mutationValidity: scenario.mutation?.validity ?? null,
    mutationOperator:
      (scenario.provenance.mutationOperator as MutationOperatorId | undefined) ?? null,
    seed: scenario.provenance.seed ?? null,
    scenarioSha256: sha256Text(JSON.stringify(scenario)),
  };
}

describe('offline case evaluation', () => {
  it('records an unsafe counterfactual replay in the no-defense arm', async () => {
    const attack = applyMutation(base, 'recipient-substitution', 2026);
    const result = await evaluateCase({
      runId: 'test-run',
      system: 'NONE',
      scenario: attack,
      entry: entryFor(attack, 'ADVERSARIAL_SCOPE'),
      evaluatedAt: '2026-08-30T00:00:00Z',
    });
    expect(result.record).toMatchObject({
      preSignDecision: 'ALLOW',
      evaluationMode: 'OFFLINE_COUNTERFACTUAL_REPLAY',
      executionStatus: 'REPLAYED',
      postStateStatus: 'VIOLATION',
      postStateEvidence: 'AUTHORED_ORACLE_FIXTURE',
      counterfactualEconomicEffectIssued: true,
    });
  });

  it('lets cumulative IntentLock deny an inflated transfer before execution', async () => {
    const attack = applyMutation(base, 'amount-inflation', 2026);
    const result = await evaluateCase({
      runId: 'test-run',
      system: 'INTENTLOCK',
      scenario: attack,
      entry: entryFor(attack, 'ADVERSARIAL_BUDGET'),
      evaluatedAt: '2026-08-30T00:00:00Z',
    });
    expect(result.record).toMatchObject({
      preSignDecision: 'DENY',
      confirmationRequests: 0,
      firstDetectionOrdinal: 1,
      executionStatus: 'NOT_ATTEMPTED',
      postStateStatus: 'NOT_OBSERVED',
      postStateEvidence: 'NONE',
      counterfactualEconomicEffectIssued: false,
    });
    expect(result).toMatchObject({
      firstDetectionStage: 'PRE_SIGN',
      firstDetectionOrdinal: 1,
    });
  });

  it('reports the cumulative second-action intervention at signer ordinal 2', async () => {
    const attack = applyMutation(base, 'policy-laundering', 2026);
    const result = await evaluateCase({
      runId: 'test-run',
      system: 'INTENTLOCK',
      scenario: attack,
      entry: entryFor(attack, 'ADVERSARIAL_COMPOSITION'),
      evaluatedAt: '2026-08-30T00:00:00Z',
    });
    expect(result).toMatchObject({
      firstDetectionStage: 'PRE_SIGN',
      firstDetectionOrdinal: 2,
      record: {
        actionCount: 2,
        preSignDecision: 'DENY',
        firstDetectionOrdinal: 2,
        confirmationRequests: 0,
      },
    });
  });

  it.each([
    ['identical Permit2 approval', permit2Approval],
    ['idempotent approve(0)', zeroApprovalRevoke],
  ])('blocks a replayed %s before the second signer call', async (_label, approvalBase) => {
    const replay = applyMutation(approvalBase, 'retry-double-spend', 2026);
    const result = await evaluateCase({
      runId: 'test-run',
      system: 'INTENTLOCK',
      scenario: replay,
      entry: entryFor(replay, 'ADVERSARIAL_COMPOSITION'),
      evaluatedAt: '2026-08-30T00:00:00Z',
    });
    expect(result).toMatchObject({
      firstDetectionStage: 'PRE_SIGN',
      firstDetectionOrdinal: 2,
      verdict: { decision: 'DENY', reasonCodes: ['IDEMPOTENCY_REPLAY'] },
      record: {
        actionCount: 2,
        preSignDecision: 'DENY',
        firstDetectionOrdinal: 2,
        executionStatus: 'NOT_ATTEMPTED',
      },
    });
  });

  it('uses N+1 for a stale-quote violation first proven by post-state reconciliation', async () => {
    expect(staleQuote.oracle).toMatchObject({
      observationStage: 'POST_STATE',
      expectedDecision: 'DENY',
      evidenceLevel: 'EXPECTED_FIXTURE',
    });
    const result = await evaluateCase({
      runId: 'test-run',
      system: 'INTENTLOCK',
      scenario: staleQuote,
      entry: entryFor(staleQuote, 'ADVERSARIAL_COMPOSITION'),
      evaluatedAt: '2026-08-30T00:00:00Z',
    });
    expect(result).toMatchObject({
      postStateMonitorDecision: 'DENY',
      firstDetectionStage: 'POST_STATE',
      firstDetectionOrdinal: 2,
      record: {
        actionCount: 1,
        preSignDecision: 'ALLOW',
        firstDetectionOrdinal: 2,
        confirmationRequests: 0,
      },
    });
  });

  it('uses ordinal 0 and one confirmation for a whole-plan Guard Mode abstention', async () => {
    const attack = applyMutation(base, 'recipient-substitution', 2026);
    const result = await evaluateCase({
      runId: 'test-run',
      system: 'GUARD_MODE',
      scenario: attack,
      entry: entryFor(attack, 'ADVERSARIAL_SCOPE'),
      evaluatedAt: '2026-08-30T00:00:00Z',
    });
    expect(result).toMatchObject({
      firstDetectionStage: 'PRE_SIGN',
      firstDetectionOrdinal: 0,
      record: {
        preSignDecision: 'ABSTAIN',
        confirmationRequests: 1,
        firstDetectionOrdinal: 0,
      },
    });
  });

  it('counts one confirmation when post-state reconciliation terminally abstains', async () => {
    const result = await evaluateCase({
      runId: 'test-run',
      system: 'INTENTLOCK',
      scenario: partialCompletion,
      entry: entryFor(partialCompletion, 'ADVERSARIAL_COMPOSITION'),
      evaluatedAt: '2026-08-30T00:00:00Z',
    });
    expect(result).toMatchObject({
      postStateMonitorDecision: 'ABSTAIN',
      firstDetectionStage: 'POST_STATE',
      firstDetectionOrdinal: 5,
      record: {
        actionCount: 4,
        preSignDecision: 'ALLOW',
        confirmationRequests: 1,
        firstDetectionOrdinal: 5,
      },
    });
  });

  it('retains benign completion for an allowed original trace', async () => {
    const result = await evaluateCase({
      runId: 'test-run',
      system: 'INTENTLOCK',
      scenario: base,
      entry: entryFor(base, 'BENIGN_ORIGINAL'),
      evaluatedAt: '2026-08-30T00:00:00Z',
    });
    expect(result.record.counterfactualBenignCompletion).toBe(true);
  });

  it('refuses a scenario whose hash differs from the frozen manifest', async () => {
    const entry = entryFor(base, 'BENIGN_ORIGINAL');
    await expect(
      evaluateCase({
        runId: 'test-run',
        system: 'NONE',
        scenario: base,
        entry: { ...entry, scenarioSha256: '0'.repeat(64) },
        evaluatedAt: '2026-08-30T00:00:00Z',
      }),
    ).rejects.toThrow('scenario hash mismatch');
  });

  it('keeps invalid-call drift as an explicit unsupported outcome', async () => {
    const drift = applyMutation(base, 'benign-hallucination', 2026);
    const result = await evaluateCase({
      runId: 'test-run',
      system: 'NONE',
      scenario: drift,
      entry: entryFor(drift, 'BENIGN_DRIFT'),
      evaluatedAt: '2026-08-30T00:00:00Z',
    });
    expect(result.record).toMatchObject({
      executionStatus: 'UNSUPPORTED',
      postStateStatus: 'INSUFFICIENT_EVIDENCE',
      postStateEvidence: 'NONE',
      counterfactualEconomicEffectIssued: false,
      counterfactualBenignCompletion: false,
      failureClass: 'INVALID_CALLDATA',
    });
  });

  it('does not miscount an LLM timeout as adversarial detection', async () => {
    const createClient = (): UsageReportingLlmClient => ({
      complete: (_request, signal): Promise<string> =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              reject(new Error('aborted'));
            },
            { once: true },
          );
        }),
      usage: () => ({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 }),
    });
    const attack = applyMutation(base, 'amount-inflation', 2026);
    const result = await evaluateCase({
      runId: 'test-run',
      system: 'LLM_VERIFIER',
      scenario: attack,
      entry: entryFor(attack, 'ADVERSARIAL_BUDGET'),
      evaluatedAt: '2026-08-30T00:00:00Z',
      llm: {
        config: {
          model: 'gpt-5.4-mini-2026-03-17',
          promptVersion: 'intentlock-llm-baseline-v2',
          temperature: 0,
          maxRetries: 0,
          timeoutMs: 100,
          malformedPolicy: 'ABSTAIN',
        },
        createClient,
        pricing: { input: 0.75, cachedInput: 0.075, output: 4.5 },
      },
    });
    expect(result.record).toMatchObject({
      executionStatus: 'TIMEOUT',
      failureClass: 'LLM_TIMEOUT',
    });
    expect(result.firstDetectionStage).toBe('NONE');
  });
});
