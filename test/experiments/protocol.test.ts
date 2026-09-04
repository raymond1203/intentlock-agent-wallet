import { describe, expect, it } from 'vitest';

import {
  FrozenEvalConfigSchema,
  ReadyFrozenEvalConfigSchema,
  tokenCostUsd,
} from '../../src/experiments/protocol.js';

const candidate = {
  protocolVersion: '0.1',
  status: 'CANDIDATE_UNFROZEN',
  freezeIssue: 27,
  dataset: {
    version: '0.3.0',
    baseManifest: 'benchmark/splits/manifest.json',
    caseManifest: 'experiments/configs/case-manifest.json',
    m2Validation: 'experiments/configs/m2-validation.json',
    expectedBaseCases: 80,
    expectedCuratedCases: 400,
    hiddenTestClaim: false,
    hiddenTestNote: 'Author-exposed split; no unseen-test claim.',
  },
  caseMatrix: {
    seed: 2026,
    evaluatedAt: '2026-08-30T00:00:00.000Z',
    casesPerBase: 5,
    variants: [
      'BENIGN_ORIGINAL',
      'ADVERSARIAL_SCOPE',
      'ADVERSARIAL_BUDGET',
      'ADVERSARIAL_COMPOSITION',
      'BENIGN_DRIFT',
    ],
    validityPolicy: 'Reject invalid and no-op operators.',
  },
  systems: [
    { id: 'none', label: 'none', primary: true },
    { id: 'guard-mode-emulator', label: 'guard', primary: true },
    { id: 'llm-verifier', label: 'llm', primary: true },
    { id: 'per-call-policy', label: 'per-call', primary: true },
    { id: 'intentlock-full', label: 'full', primary: true },
  ],
  relatedWorkOnly: ['task-shield'],
  models: {
    primary: {
      id: 'gpt-5.4-mini-2026-03-17',
      temperature: 0,
      maxRetries: 1,
      timeoutMs: 30_000,
      malformedPolicy: 'ABSTAIN',
      pricingUsdPerMillionTokens: { input: 0.75, cachedInput: 0.075, output: 4.5 },
      pricingSource: 'https://developers.openai.com/api/docs/models/gpt-5.4-mini',
      pricingCheckedAt: '2026-09-04',
    },
    secondary: null,
    secondaryPolicy: 'No secondary model in the primary run.',
  },
  forks: [
    {
      chainId: 1,
      blockNumber: 25_773_000,
      blockHash: `0x${'a'.repeat(64)}`,
      rpcEnvVar: 'FORK_RPC_URL_1',
    },
  ],
  adaptive: { expectedCases: 40 },
  stageComparisons: [{ id: 'semantic-only' }],
  ablations: [{ id: 'stateless' }],
  metrics: {
    primary: 'offline_counterfactual_unsafe_authorization_rate',
    secondary: ['benign_task_completion'],
    confidenceInterval: 'stratified-bootstrap-95',
    bootstrapReplicates: 10_000,
    missingDataPolicy: 'Failures stay in the denominator.',
  },
  failurePolicy: {
    overwriteRun: false,
    retriesReuseCaseId: true,
    retryResultSelection: 'attempt-1-intention-to-treat-retries-operational-sensitivity-only',
    maxAttemptsPerCase: 2,
    maxTotalRetryAttempts: 2000,
    timeoutDecision: 'ABSTAIN',
    malformedDecision: 'ABSTAIN',
  },
  freeze: {
    gitCommit: null,
    dependencyDigestSha256: null,
    datasetDigestSha256: null,
    caseManifestDigestSha256: null,
    promptDigestSha256: null,
    toolSchemaDigestSha256: null,
    metricImplementationDigestSha256: null,
    protocolConfigDigestSha256: null,
    evaluationConfigDigestSha256: null,
    implementationDigestSha256: null,
    frozenAt: null,
    humanReviewer: null,
    humanReviewPath: null,
    humanReviewDigestSha256: null,
  },
} as const;

describe('frozen evaluation protocol', () => {
  it('accepts a candidate but refuses it as a runnable frozen config', () => {
    expect(FrozenEvalConfigSchema.safeParse(candidate).success).toBe(true);
    expect(ReadyFrozenEvalConfigSchema.safeParse(candidate).success).toBe(false);
  });

  it('requires every digest and the human review record before a primary run', () => {
    const ready = {
      ...candidate,
      status: 'FROZEN',
      freeze: {
        gitCommit: 'a'.repeat(40),
        dependencyDigestSha256: 'b'.repeat(64),
        datasetDigestSha256: 'c'.repeat(64),
        caseManifestDigestSha256: 'd'.repeat(64),
        promptDigestSha256: 'e'.repeat(64),
        toolSchemaDigestSha256: 'f'.repeat(64),
        metricImplementationDigestSha256: '1'.repeat(64),
        protocolConfigDigestSha256: '2'.repeat(64),
        evaluationConfigDigestSha256: '3'.repeat(64),
        implementationDigestSha256: '4'.repeat(64),
        frozenAt: '2026-09-04T00:00:00.000Z',
        humanReviewer: 'review-record-01',
        humanReviewPath: 'experiments/reviews/freeze-review.json',
        humanReviewDigestSha256: '5'.repeat(64),
      },
    };
    expect(ReadyFrozenEvalConfigSchema.safeParse(ready).success).toBe(true);
  });

  it('prices cached, uncached, and output tokens separately', () => {
    expect(
      tokenCostUsd(
        { inputTokens: 1_000_000, cachedInputTokens: 200_000, outputTokens: 100_000 },
        { input: 0.75, cachedInput: 0.075, output: 4.5 },
      ),
    ).toBeCloseTo(1.065);
    expect(() =>
      tokenCostUsd(
        { inputTokens: 1, cachedInputTokens: 2, outputTokens: 0 },
        { input: 0.75, cachedInput: 0.075, output: 4.5 },
      ),
    ).toThrow('invalid token usage');
  });
});
