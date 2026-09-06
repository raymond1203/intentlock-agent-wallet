import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';

import { z } from 'zod';

import {
  BenchmarkScenarioSchema,
  StateObservationSchema,
  TraceActionSchema,
  type BenchmarkScenario,
} from '../../src/benchmark/scenario.js';
import { BENCHMARK_DATASET_VERSION } from '../../src/benchmark/version.js';
import { EconomicEffectSchema } from '../../src/domain/action-ir.js';
import { evaluatePostState, observationKey } from '../../src/oracle/post-state-oracle.js';
import { M2_ATTEMPT_SELECTION_POLICY, selectFirstCompleteOrLatest } from './attempt-selection.js';
import { requiredReceiptCount } from './receipt-requirements.js';

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const GitCommitSchema = z.string().regex(/^[a-f0-9]{40}$/);
const AddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const Bytes32Schema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
const HexSchema = z.string().regex(/^0x[a-fA-F0-9]*$/);
const UnsignedStringSchema = z.string().regex(/^(0|[1-9]\d*)$/);

export function canonicalM2RawEvidencePath(rawFileSha256: string): string {
  const digest = Sha256Schema.parse(rawFileSha256);
  return `benchmark/evidence/raw/v${BENCHMARK_DATASET_VERSION}/sha256/${digest}.json`;
}

export const M2RawEvidencePathSchema = z.string().superRefine((path, context) => {
  const match = new RegExp(
    `^benchmark/evidence/raw/v${BENCHMARK_DATASET_VERSION.replaceAll('.', '\\.')}/sha256/([a-f0-9]{64})\\.json$`,
  ).exec(path);
  if (!match) {
    context.addIssue({ code: 'custom', message: 'non-canonical M2 raw evidence path' });
  }
});

export const M2OracleEvidenceSchema = z
  .object({
    status: z.enum(['PASS', 'VIOLATION', 'INSUFFICIENT_EVIDENCE', 'DISAGREEMENT']),
    violations: z.array(z.object({ code: z.string(), key: z.string(), amount: z.string() })),
    missing: z.array(z.string()),
    disagreements: z.array(
      z.object({ key: z.string(), expected: z.string(), actual: z.string().nullable() }),
    ),
  })
  .strict();

export const M2VerifiedForkSchema = z
  .object({
    chainId: z.number().int().positive(),
    blockNumber: z.number().int().nonnegative(),
    blockHash: Bytes32Schema,
    digest: Bytes32Schema,
    contracts: z.array(
      z
        .object({
          key: z.string().min(1),
          address: AddressSchema,
          codehash: Bytes32Schema,
        })
        .strict(),
    ),
  })
  .strict();

export const M2FixtureCorrectionSchema = z
  .object({
    kind: z.literal('ACCOUNT_PREFIX_FUNDING'),
    chainId: z.number().int().positive(),
    asset: z.string().min(1),
    authored: z.string().regex(/^\d+$/),
    required: z.string().regex(/^\d+$/),
  })
  .strict();

export const M2PublishedReceiptSchema = z
  .object({
    sequence: z.number().int().nonnegative().nullable(),
    role: z.enum(['SETUP', 'USER', 'RELAY']),
    chainId: z.number().int().positive(),
    from: z.string().min(1),
    to: z.string().min(1),
    transactionHash: z.string().min(1),
    status: z.enum(['success', 'reverted']),
    gasCostWei: z.string().regex(/^\d+$/),
    blockNumber: z.string().min(1),
    blockHash: z.string().min(1),
    gasUsed: z.string().min(1),
  })
  .strict();

export const M2PublishedQuoteSchema = z
  .object({
    chainId: z.number().int().positive(),
    blockNumber: z.string().min(1),
    blockHash: z.string().min(1),
    amountIn: z.string().regex(/^\d+$/),
    authoredMinimum: z.string().regex(/^\d+$/),
    quotedAmountOut: z.string().regex(/^\d+$/),
    authoredSlippageBps: z.string().nullable(),
    sourceCalldataHash: z.string().min(1),
    quoter: z.object({ address: z.string().min(1), codehash: z.string().min(1) }).strict(),
    pools: z.array(
      z
        .object({
          address: z.string().min(1),
          codehash: z.string().min(1),
          tokenA: z.string().min(1),
          tokenB: z.string().min(1),
          fee: z.number().int().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict();

const M2RawQuoteSchema = M2PublishedQuoteSchema.extend({
  path: z.string().regex(/^0x[a-fA-F0-9]+$/),
}).strict();

export const M2RawOracleSchema = z
  .object({
    status: z.enum(['PASS', 'VIOLATION', 'INSUFFICIENT_EVIDENCE', 'DISAGREEMENT']),
    decision: z.enum(['ALLOW', 'DENY', 'ESCALATE']),
    evidenceLevel: z.literal('EXECUTED_FORK'),
    finalGoals: z.array(
      z
        .object({
          index: z.number().int().nonnegative(),
          satisfied: z.boolean().nullable(),
          actual: z.string().nullable(),
          code: z.string().min(1),
        })
        .strict(),
    ),
    deltas: z.array(
      z
        .object({
          key: z.string().min(1),
          before: z.string(),
          after: z.string(),
          delta: z.string(),
        })
        .strict(),
    ),
    violations: z.array(
      z.object({ code: z.string(), key: z.string(), amount: z.string() }).strict(),
    ),
    allowanceExposure: z.array(z.object({ key: z.string(), amount: z.string() }).strict()),
    missing: z.array(z.string()),
    disagreements: z.array(
      z.object({ key: z.string(), expected: z.string(), actual: z.string().nullable() }).strict(),
    ),
  })
  .strict();

const M2RawLogSchema = z
  .object({
    address: AddressSchema,
    topics: z.array(Bytes32Schema),
    data: HexSchema,
    blockHash: Bytes32Schema,
    blockNumber: UnsignedStringSchema,
    blockTimestamp: UnsignedStringSchema,
    transactionHash: Bytes32Schema,
    transactionIndex: z.number().int().nonnegative(),
    logIndex: z.number().int().nonnegative(),
    removed: z.boolean(),
  })
  .strict();

const M2RawReceiptSchema = z
  .object({
    type: z.string().min(1),
    status: z.enum(['success', 'reverted']),
    cumulativeGasUsed: UnsignedStringSchema,
    logs: z.array(M2RawLogSchema),
    logsBloom: HexSchema,
    transactionHash: Bytes32Schema,
    transactionIndex: z.number().int().nonnegative(),
    blockHash: Bytes32Schema,
    blockNumber: UnsignedStringSchema,
    gasUsed: UnsignedStringSchema,
    effectiveGasPrice: UnsignedStringSchema,
    blobGasPrice: UnsignedStringSchema.optional(),
    blobGasUsed: UnsignedStringSchema.optional(),
    from: AddressSchema,
    to: AddressSchema.nullable(),
    contractAddress: AddressSchema.nullable(),
    blockTimestamp: z.union([z.number().int().nonnegative(), UnsignedStringSchema]),
  })
  .strict();

export const M2RawTransactionSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    role: z.enum(['SETUP', 'USER', 'RELAY']),
    chainId: z.number().int().positive(),
    from: AddressSchema,
    to: AddressSchema,
    calldata: HexSchema,
    valueWei: UnsignedStringSchema,
    transactionHash: Bytes32Schema,
    status: z.enum(['success', 'reverted']),
    gasCostWei: UnsignedStringSchema,
    receipt: M2RawReceiptSchema,
  })
  .strict()
  .superRefine((transaction, context) => {
    if (
      transaction.receipt.transactionHash.toLowerCase() !==
        transaction.transactionHash.toLowerCase() ||
      transaction.receipt.status !== transaction.status ||
      transaction.receipt.from.toLowerCase() !== transaction.from.toLowerCase() ||
      transaction.receipt.to?.toLowerCase() !== transaction.to.toLowerCase()
    ) {
      context.addIssue({
        code: 'custom',
        path: ['receipt'],
        message: 'raw receipt identity/status must match the transaction envelope',
      });
    }
  });

/** Exact collector artifact accepted by the publisher and independent validator. */
export const M2RawExecutionEvidenceSchema = z
  .object({
    datasetVersion: z.literal(BENCHMARK_DATASET_VERSION),
    scenarioId: z.string().min(1),
    sourceCommit: GitCommitSchema,
    workingTreeDirty: z.boolean(),
    collectorSha256: Sha256Schema,
    sourceScenarioSha256: Sha256Schema,
    fixture: BenchmarkScenarioSchema.shape.fixture,
    verifiedForks: z.array(M2VerifiedForkSchema),
    setupNotes: z.array(z.string()),
    fixtureCorrections: z.array(M2FixtureCorrectionSchema),
    quotes: z.array(M2RawQuoteSchema),
    resolvedActions: z.array(TraceActionSchema),
    requiredReceiptCount: z.number().int().nonnegative(),
    transactions: z.array(M2RawTransactionSchema),
    pre: z.array(StateObservationSchema),
    post: z.array(StateObservationSchema),
    observedEffects: z.array(EconomicEffectSchema),
    positionTokenEvents: z.array(EconomicEffectSchema),
    oracle: M2RawOracleSchema,
    referenceReconciliation: M2RawOracleSchema.nullable(),
    error: z.string().nullable(),
  })
  .strict();

export type M2RawExecutionEvidence = z.infer<typeof M2RawExecutionEvidenceSchema>;

export const M2PublishedAttemptSchema = z
  .object({
    datasetVersion: z.literal(BENCHMARK_DATASET_VERSION),
    scenarioId: z.string().min(1),
    run: z.string().min(1),
    rawFilePath: M2RawEvidencePathSchema,
    rawFileSha256: Sha256Schema,
    sourceCommit: GitCommitSchema,
    workingTreeDirty: z.boolean(),
    collectorSha256: Sha256Schema,
    sourceScenarioSha256: Sha256Schema,
    verifiedForks: z.array(M2VerifiedForkSchema),
    setupNotes: z.array(z.string()),
    fixtureCorrections: z.array(M2FixtureCorrectionSchema),
    fixtureCorrected: z.boolean(),
    requiredReceiptCount: z.number().int().nonnegative(),
    receipts: z.array(M2PublishedReceiptSchema),
    pre: z.array(StateObservationSchema),
    post: z.array(StateObservationSchema),
    quotes: z.array(M2PublishedQuoteSchema),
    oracle: M2OracleEvidenceSchema,
    referenceReconciliation: M2OracleEvidenceSchema.nullable(),
    executionComplete: z.boolean(),
    incompletenessReasons: z.array(z.string().min(1)),
    failure: z
      .object({
        kind: z.enum([
          'UPSTREAM_RATE_LIMIT',
          'UPSTREAM_TIMEOUT',
          'ARCHIVE_STATE_UNAVAILABLE',
          'TRANSACTION_REVERTED',
          'OTHER',
        ]),
        sha256: Sha256Schema,
      })
      .strict()
      .nullable(),
  })
  .strict();

export type PublishedM2Attempt = z.infer<typeof M2PublishedAttemptSchema>;

export const M2PublishedLatestSchema = z
  .object({
    datasetVersion: z.literal(BENCHMARK_DATASET_VERSION),
    scenarioId: z.string().min(1),
    run: z.string().min(1),
    rawFilePath: M2RawEvidencePathSchema,
    rawFileSha256: Sha256Schema,
    executionComplete: z.boolean(),
    fixtureCorrected: z.boolean(),
    oracleStatus: M2OracleEvidenceSchema.shape.status,
  })
  .strict();

export const M2PublishedEvidenceSchema = z
  .object({
    datasetVersion: z.literal(BENCHMARK_DATASET_VERSION),
    purpose: z.literal('Diagnostic evidence, not a frozen performance result'),
    selection: z.literal(M2_ATTEMPT_SELECTION_POLICY),
    baseCount: z.number().int().nonnegative(),
    attemptedCount: z.number().int().nonnegative(),
    missing: z.array(z.string().min(1)),
    completedExecutionCount: z.number().int().nonnegative(),
    strictAuthoredFixtureExecutionCount: z.number().int().nonnegative(),
    finalGoalPassCount: z.number().int().nonnegative(),
    strictAuthoredFixtureFinalGoalPassCount: z.number().int().nonnegative(),
    syntheticReferenceCheckedCount: z.number().int().nonnegative(),
    syntheticReferenceDisagreementCount: z.number().int().nonnegative(),
    humanReview: z.literal('PENDING'),
    m2Complete: z.literal(false),
    latest: z.array(M2PublishedLatestSchema),
    attempts: z.array(M2PublishedAttemptSchema),
  })
  .strict();

export type PublishedM2Evidence = z.infer<typeof M2PublishedEvidenceSchema>;

type RawOracle = z.infer<typeof M2RawOracleSchema>;

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function compactOracle(oracle: RawOracle): z.infer<typeof M2OracleEvidenceSchema> {
  return {
    status: oracle.status,
    violations: oracle.violations,
    missing: oracle.missing,
    disagreements: oracle.disagreements,
  };
}

export type PublicM2Failure = NonNullable<PublishedM2Attempt['failure']>;

export function publicM2Failure(error: string | null): PublicM2Failure | null {
  if (error === null) return null;
  const kind: PublicM2Failure['kind'] = /\b429\b|rate.?limit|compute units/i.test(error)
    ? 'UPSTREAM_RATE_LIMIT'
    : /timed? ?out|timeout/i.test(error)
      ? 'UPSTREAM_TIMEOUT'
      : /archive|pruned|historical state/i.test(error)
        ? 'ARCHIVE_STATE_UNAVAILABLE'
        : /revert/i.test(error)
          ? 'TRANSACTION_REVERTED'
          : 'OTHER';
  return { kind, sha256: createHash('sha256').update(error).digest('hex') };
}

function deltaObservation(
  delta: BenchmarkScenario['oracle']['expectedDeltas'][number],
): z.infer<typeof StateObservationSchema> {
  return {
    chainId: delta.chainId,
    subject: delta.subject,
    field: delta.field,
    asset: delta.asset,
    ...(delta.counterparty ? { counterparty: delta.counterparty } : {}),
    value: '0',
    source: 'EXPECTED_FIXTURE',
  };
}

function independentlyEvaluateRaw(
  raw: M2RawExecutionEvidence,
  scenario: BenchmarkScenario,
): {
  oracle: RawOracle;
  referenceReconciliation: RawOracle | null;
  problems: string[];
} {
  const userReceipts = raw.transactions.filter((transaction) => transaction.role !== 'SETUP');
  const userTransactions = raw.transactions.filter((transaction) => transaction.role === 'USER');
  const bindingProblems: string[] = [];
  if (
    new Set(raw.transactions.map((transaction) => transaction.sequence)).size !==
      raw.transactions.length ||
    raw.transactions.some(
      (transaction, index) =>
        index > 0 &&
        transaction.sequence <= (raw.transactions[index - 1]?.sequence ?? transaction.sequence),
    )
  ) {
    bindingProblems.push('receipts:sequence');
  }
  if (raw.error === null && userTransactions.length !== raw.resolvedActions.length) {
    bindingProblems.push('actions:user-receipt-count');
  }
  for (const [index, action] of raw.resolvedActions.entries()) {
    const authored = scenario.trace.actions[index];
    if (
      !authored ||
      action.id !== authored.id ||
      action.executionIndex !== authored.executionIndex ||
      action.chainId !== authored.chainId ||
      action.target.toLowerCase() !== authored.target.toLowerCase() ||
      action.selector.toLowerCase() !== authored.selector.toLowerCase() ||
      action.valueWei !== authored.valueWei
    ) {
      bindingProblems.push(`actions:scenario:${String(index)}`);
    }
    const transaction = userTransactions[index];
    if (
      transaction &&
      (transaction.chainId !== action.chainId ||
        transaction.from.toLowerCase() !== scenario.intent.account.toLowerCase() ||
        transaction.to.toLowerCase() !== action.target.toLowerCase() ||
        transaction.calldata.toLowerCase() !== action.calldata.toLowerCase() ||
        transaction.valueWei !== action.valueWei)
    ) {
      bindingProblems.push(`actions:receipt:${String(index)}`);
    }
  }
  if (raw.pre.some((row) => row.source !== 'FIXED_FORK'))
    bindingProblems.push('observations:pre-source');
  if (raw.post.some((row) => row.source !== 'POST_STATE'))
    bindingProblems.push('observations:post-source');
  if (
    raw.observedEffects.some(
      (effect) => effect.phase !== 'OBSERVED' || effect.provenance.source !== 'RECEIPT',
    )
  )
    bindingProblems.push('effects:not-receipt-observed');
  const receiptInputs = userReceipts.map((transaction) => ({
    chainId: transaction.chainId,
    transactionHash: transaction.transactionHash,
    status: transaction.status,
    gasCostWei: transaction.gasCostWei,
  }));
  const oracle = M2RawOracleSchema.parse(
    evaluatePostState({
      contract: scenario.intent,
      preState: raw.pre,
      postState: raw.post,
      evidenceLevel: 'EXECUTED_FORK',
      executionComplete: raw.error === null,
      observedEffects: raw.observedEffects,
      receipts: receiptInputs,
      requiredReceiptCount: requiredReceiptCount(scenario),
    }),
  );
  const deltaReferenceKeys = new Set(
    scenario.oracle.expectedDeltas.map((delta) => observationKey(deltaObservation(delta))),
  );
  const absoluteReferenceRows = scenario.oracle.postState.filter(
    (row) => !deltaReferenceKeys.has(observationKey(row)),
  );
  const referenceReconciliation = raw.post.length
    ? M2RawOracleSchema.parse(
        evaluatePostState({
          contract: scenario.intent,
          preState: raw.pre,
          postState: raw.post,
          expectedPostState: absoluteReferenceRows,
          expectedDeltas: scenario.oracle.expectedDeltas,
          evidenceLevel: 'EXECUTED_FORK',
          executionComplete: raw.error === null,
          observedEffects: raw.observedEffects,
          receipts: receiptInputs,
          requiredReceiptCount: requiredReceiptCount(scenario),
        }),
      )
    : null;
  const problems = executionProblems(
    {
      error: raw.error,
      verifiedForks: raw.verifiedForks,
      requiredReceiptCount: raw.requiredReceiptCount,
      transactions: raw.transactions,
      pre: raw.pre,
      post: raw.post,
      oracle,
    },
    scenario,
  );
  return {
    oracle,
    referenceReconciliation,
    problems: [...new Set([...problems, ...bindingProblems])],
  };
}

function compactRawAttempt(
  raw: M2RawExecutionEvidence,
  attempt: PublishedM2Attempt,
  independentlyEvaluated: ReturnType<typeof independentlyEvaluateRaw>,
): PublishedM2Attempt {
  return {
    datasetVersion: raw.datasetVersion,
    scenarioId: raw.scenarioId,
    run: attempt.run,
    rawFilePath: attempt.rawFilePath,
    rawFileSha256: attempt.rawFileSha256,
    sourceCommit: raw.sourceCommit,
    workingTreeDirty: raw.workingTreeDirty,
    collectorSha256: raw.collectorSha256,
    sourceScenarioSha256: raw.sourceScenarioSha256,
    verifiedForks: raw.verifiedForks,
    setupNotes: raw.setupNotes,
    fixtureCorrections: raw.fixtureCorrections,
    fixtureCorrected: raw.fixtureCorrections.length > 0,
    requiredReceiptCount: raw.requiredReceiptCount,
    receipts: raw.transactions.map((transaction) => ({
      sequence: transaction.sequence,
      role: transaction.role,
      chainId: transaction.chainId,
      from: transaction.from,
      to: transaction.to,
      transactionHash: transaction.transactionHash,
      status: transaction.status,
      gasCostWei: transaction.gasCostWei,
      blockNumber: transaction.receipt.blockNumber,
      blockHash: transaction.receipt.blockHash,
      gasUsed: transaction.receipt.gasUsed,
    })),
    pre: raw.pre,
    post: raw.post,
    quotes: raw.quotes.map(({ path: _path, ...quote }) => {
      return quote;
    }),
    oracle: compactOracle(independentlyEvaluated.oracle),
    referenceReconciliation: independentlyEvaluated.referenceReconciliation
      ? compactOracle(independentlyEvaluated.referenceReconciliation)
      : null,
    executionComplete: independentlyEvaluated.problems.length === 0,
    incompletenessReasons: independentlyEvaluated.problems,
    failure: publicM2Failure(raw.error),
  };
}

export interface ExecutionEvidenceCandidate {
  error: string | null;
  verifiedForks: {
    chainId: number;
    blockNumber: number;
    blockHash: string;
    contracts: { address: string; codehash: string }[];
  }[];
  requiredReceiptCount: number;
  transactions: { role: 'SETUP' | 'USER' | 'RELAY'; status: 'success' | 'reverted' }[];
  pre: unknown[];
  post: unknown[];
  oracle: {
    status: 'PASS' | 'VIOLATION' | 'INSUFFICIENT_EVIDENCE' | 'DISAGREEMENT';
    violations: unknown[];
    missing: string[];
    disagreements: unknown[];
  };
}

export function executionProblems(
  candidate: ExecutionEvidenceCandidate,
  scenario: BenchmarkScenario,
): string[] {
  const problems: string[] = [];
  if (candidate.error !== null) problems.push('execution:error');

  const fixture = scenario.fixture;
  if (!fixture) problems.push('fixture:missing');
  const expectedChains = [...(fixture?.chains ?? [])].sort(
    (left, right) => left.chainId - right.chainId,
  );
  const observedChains = [...candidate.verifiedForks].sort(
    (left, right) => left.chainId - right.chainId,
  );
  if (
    observedChains.length !== expectedChains.length ||
    new Set(observedChains.map((fork) => fork.chainId)).size !== observedChains.length
  )
    problems.push('forks:incomplete');
  for (const expected of expectedChains) {
    const observed = observedChains.find((fork) => fork.chainId === expected.chainId);
    if (
      !observed ||
      observed.blockNumber !== expected.blockNumber ||
      observed.blockHash.toLowerCase() !== expected.blockHash.toLowerCase() ||
      expected.contracts.some((contract) => {
        const actual = observed.contracts.find(
          (entry) => entry.address.toLowerCase() === contract.address.toLowerCase(),
        );
        return !actual || actual.codehash.toLowerCase() !== contract.codehash.toLowerCase();
      })
    )
      problems.push(`forks:fingerprint:${String(expected.chainId)}`);
  }

  const required = requiredReceiptCount(scenario);
  const userReceipts = candidate.transactions.filter((transaction) => transaction.role !== 'SETUP');
  if (candidate.requiredReceiptCount !== required) problems.push('receipts:requirement-mismatch');
  if (userReceipts.length !== required) problems.push('receipts:count');
  if (candidate.transactions.some((transaction) => transaction.status !== 'success'))
    problems.push('receipts:unsuccessful');
  if (!candidate.pre.length || !candidate.post.length) problems.push('observations:incomplete');
  if (candidate.oracle.missing.length) problems.push('oracle:missing');
  if (candidate.oracle.disagreements.length) problems.push('oracle:unexpected-disagreement');
  if (
    (candidate.oracle.status === 'PASS' && candidate.oracle.violations.length !== 0) ||
    (candidate.oracle.status === 'VIOLATION' && candidate.oracle.violations.length === 0)
  )
    problems.push('oracle:inconsistent');
  if (candidate.oracle.status !== 'PASS' && candidate.oracle.status !== 'VIOLATION')
    problems.push('oracle:nonterminal');
  return [...new Set(problems)];
}

export function classifyExecutionEvidence(input: {
  baseCount: number;
  completedExecutionCount: number;
  strictAuthoredFixtureExecutionCount: number;
  cleanCommittedExecutedBaseCount: number;
}):
  | 'CLEAN_COMMITTED_CANDIDATE'
  | 'CLEAN_COMMITTED_WITH_FIXTURE_CORRECTIONS'
  | 'DIAGNOSTIC_DIRTY'
  | 'NOT_COLLECTED' {
  if (
    input.completedExecutionCount === input.baseCount &&
    input.cleanCommittedExecutedBaseCount === input.baseCount
  )
    return input.strictAuthoredFixtureExecutionCount === input.baseCount
      ? 'CLEAN_COMMITTED_CANDIDATE'
      : 'CLEAN_COMMITTED_WITH_FIXTURE_CORRECTIONS';
  return input.completedExecutionCount > 0 ? 'DIAGNOSTIC_DIRTY' : 'NOT_COLLECTED';
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameLatest(
  latest: z.infer<typeof M2PublishedLatestSchema>,
  attempt: PublishedM2Attempt,
  executionComplete: boolean,
): boolean {
  return (
    latest.scenarioId === attempt.scenarioId &&
    latest.run === attempt.run &&
    latest.rawFilePath === attempt.rawFilePath &&
    latest.rawFileSha256 === attempt.rawFileSha256 &&
    latest.executionComplete === executionComplete &&
    latest.fixtureCorrected === attempt.fixtureCorrected &&
    latest.oracleStatus === attempt.oracle.status
  );
}

export interface PublishedM2ValidationOptions {
  scenarios: readonly BenchmarkScenario[];
  currentCollectorSha256: string;
  /** Independently rebuilt collector identities at original source commits, never copied from evidence. */
  sourceCollectorSha256?: ReadonlyMap<string, string>;
  sourceCommitResolves: (commit: string) => boolean;
  sourceCommitIsAncestor: (commit: string) => boolean;
  /** Must return the exact bytes at `HEAD:path` for GIT_HEAD_TRACKED validation. */
  readRawEvidenceBytes: (path: string) => Uint8Array;
  rawEvidenceSource: 'GIT_HEAD_TRACKED' | 'WORKTREE_PUBLISH';
}

/**
 * Revalidates every published attempt from its content-addressed raw collector bytes. Stored
 * receipts, oracle payloads, completion booleans and aggregates are assertions, never trust roots.
 */
export function validatePublishedM2Evidence(
  input: unknown,
  options: PublishedM2ValidationOptions,
): {
  evidence: PublishedM2Evidence;
  latestExecution: Map<string, z.infer<typeof M2PublishedLatestSchema>>;
  selectedAttempt: Map<string, PublishedM2Attempt>;
  cleanCommittedExecutedBaseCount: number;
  executionEvidenceStatus: ReturnType<typeof classifyExecutionEvidence>;
} {
  const evidence = M2PublishedEvidenceSchema.parse(input);
  const scenarios = new Map(options.scenarios.map((scenario) => [scenario.id, scenario]));
  if (scenarios.size !== options.scenarios.length)
    throw new Error('base scenario IDs are not unique');
  if (evidence.baseCount !== scenarios.size) {
    throw new Error('current execution evidence does not match the current dataset count');
  }
  Sha256Schema.parse(options.currentCollectorSha256);
  const expectedCollectorFor = (commit: string): string => {
    if (!options.sourceCollectorSha256) return options.currentCollectorSha256;
    const expected = options.sourceCollectorSha256.get(commit);
    if (expected === undefined)
      throw new Error(`missing independently rebuilt collector: ${commit}`);
    return Sha256Schema.parse(expected);
  };

  const computedProblems = new Map<PublishedM2Attempt, string[]>();
  const independentlyEvaluated = new Map<
    PublishedM2Attempt,
    ReturnType<typeof independentlyEvaluateRaw>
  >();
  const attemptIdentities = new Set<string>();
  for (const attempt of evidence.attempts) {
    const scenario = scenarios.get(attempt.scenarioId);
    if (!scenario) throw new Error(`published attempt has unknown scenario: ${attempt.scenarioId}`);
    const identity = `${attempt.run}:${attempt.rawFilePath}`;
    if (attemptIdentities.has(identity))
      throw new Error(`duplicate published attempt: ${identity}`);
    attemptIdentities.add(identity);

    const expectedRawPath = canonicalM2RawEvidencePath(attempt.rawFileSha256);
    if (attempt.rawFilePath !== expectedRawPath) {
      throw new Error(`raw evidence path/hash mismatch: ${attempt.scenarioId}`);
    }
    let rawBytes: Uint8Array;
    try {
      rawBytes = options.readRawEvidenceBytes(attempt.rawFilePath);
    } catch (cause) {
      throw new Error(`missing tracked raw evidence: ${attempt.rawFilePath}`, { cause });
    }
    if (sha256(rawBytes) !== attempt.rawFileSha256) {
      throw new Error(`raw evidence byte hash mismatch: ${attempt.scenarioId}`);
    }
    let rawJson: unknown;
    try {
      rawJson = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBytes)) as unknown;
    } catch (cause) {
      throw new Error(`raw evidence is not strict UTF-8 JSON: ${attempt.scenarioId}`, { cause });
    }
    const raw = M2RawExecutionEvidenceSchema.parse(rawJson);
    if (raw.scenarioId !== attempt.scenarioId) {
      throw new Error(`raw evidence scenario mismatch: ${attempt.scenarioId}`);
    }
    const scenarioSha256 = createHash('sha256').update(JSON.stringify(scenario)).digest('hex');
    if (
      raw.sourceScenarioSha256 !== scenarioSha256 ||
      attempt.sourceScenarioSha256 !== scenarioSha256
    ) {
      throw new Error(`stale published execution evidence: ${attempt.scenarioId}`);
    }
    if (raw.collectorSha256 !== expectedCollectorFor(raw.sourceCommit)) {
      throw new Error(`stale raw execution collector: ${attempt.scenarioId}`);
    }
    if (
      !options.sourceCommitResolves(raw.sourceCommit) ||
      !options.sourceCommitIsAncestor(raw.sourceCommit)
    ) {
      throw new Error(
        `raw source commit is not in the current HEAD lineage: ${attempt.scenarioId}`,
      );
    }
    if (!sameValue(raw.fixture ?? null, scenario.fixture ?? null)) {
      throw new Error(`raw execution fixture mismatch: ${attempt.scenarioId}`);
    }
    const evaluated = independentlyEvaluateRaw(raw, scenario);
    independentlyEvaluated.set(attempt, evaluated);
    if (!sameValue(raw.oracle, evaluated.oracle)) {
      throw new Error(`stored raw oracle does not reproduce: ${attempt.scenarioId}`);
    }
    if (!sameValue(raw.referenceReconciliation, evaluated.referenceReconciliation)) {
      throw new Error(
        `stored raw reference reconciliation does not reproduce: ${attempt.scenarioId}`,
      );
    }
    const independentlyPublished = compactRawAttempt(raw, attempt, evaluated);
    if (!sameValue(attempt, independentlyPublished)) {
      throw new Error(
        `published attempt does not match tracked raw evidence: ${attempt.scenarioId}`,
      );
    }
    const problems = evaluated.problems;
    computedProblems.set(attempt, problems);
  }

  const selectedAttempt = selectFirstCompleteOrLatest(
    evidence.attempts,
    (attempt) => attempt.scenarioId,
    (attempt) => (computedProblems.get(attempt) ?? []).length === 0,
  );
  const latestExecution = new Map(evidence.latest.map((row) => [row.scenarioId, row]));
  if (
    latestExecution.size !== evidence.latest.length ||
    latestExecution.size !== evidence.attemptedCount ||
    selectedAttempt.size !== evidence.attemptedCount
  ) {
    throw new Error('published execution evidence has duplicate or inconsistent latest rows');
  }
  for (const [scenarioId, attempt] of selectedAttempt) {
    const latest = latestExecution.get(scenarioId);
    const executionComplete = (computedProblems.get(attempt) ?? []).length === 0;
    if (!latest || !sameLatest(latest, attempt, executionComplete)) {
      throw new Error(`latest row does not match selected attempt: ${scenarioId}`);
    }
  }
  if ([...latestExecution.keys()].some((scenarioId) => !scenarios.has(scenarioId))) {
    throw new Error('latest execution evidence contains an unknown scenario');
  }

  const expectedMissing = [...scenarios.keys()].filter((id) => !selectedAttempt.has(id)).sort();
  const publishedMissing = [...evidence.missing].sort();
  if (
    new Set(evidence.missing).size !== evidence.missing.length ||
    !sameArray(publishedMissing, expectedMissing)
  ) {
    throw new Error('published missing-scenario set is inconsistent');
  }

  const selected = [...selectedAttempt.values()];
  const completed = selected.filter(
    (attempt) => (computedProblems.get(attempt) ?? []).length === 0,
  );
  const strict = completed.filter((attempt) => !attempt.fixtureCorrected);
  const aggregates = {
    completedExecutionCount: completed.length,
    strictAuthoredFixtureExecutionCount: strict.length,
    finalGoalPassCount: completed.filter(
      (attempt) => independentlyEvaluated.get(attempt)?.oracle.status === 'PASS',
    ).length,
    strictAuthoredFixtureFinalGoalPassCount: strict.filter(
      (attempt) => independentlyEvaluated.get(attempt)?.oracle.status === 'PASS',
    ).length,
    syntheticReferenceCheckedCount: selected.filter((attempt) => {
      const reconciliation = independentlyEvaluated.get(attempt)?.referenceReconciliation;
      return reconciliation !== null && reconciliation !== undefined;
    }).length,
    syntheticReferenceDisagreementCount: selected.filter(
      (attempt) =>
        independentlyEvaluated.get(attempt)?.referenceReconciliation?.status === 'DISAGREEMENT',
    ).length,
  };
  if (
    aggregates.completedExecutionCount !== evidence.completedExecutionCount ||
    aggregates.strictAuthoredFixtureExecutionCount !==
      evidence.strictAuthoredFixtureExecutionCount ||
    aggregates.finalGoalPassCount !== evidence.finalGoalPassCount ||
    aggregates.strictAuthoredFixtureFinalGoalPassCount !==
      evidence.strictAuthoredFixtureFinalGoalPassCount ||
    aggregates.syntheticReferenceCheckedCount !== evidence.syntheticReferenceCheckedCount ||
    aggregates.syntheticReferenceDisagreementCount !== evidence.syntheticReferenceDisagreementCount
  ) {
    throw new Error('published execution aggregate does not match revalidated attempts');
  }

  const cleanCommittedExecutedBaseCount = completed.filter(
    (attempt) =>
      options.rawEvidenceSource === 'GIT_HEAD_TRACKED' &&
      !attempt.workingTreeDirty &&
      attempt.collectorSha256 === expectedCollectorFor(attempt.sourceCommit) &&
      options.sourceCommitResolves(attempt.sourceCommit) &&
      options.sourceCommitIsAncestor(attempt.sourceCommit),
  ).length;
  const executionEvidenceStatus = classifyExecutionEvidence({
    baseCount: evidence.baseCount,
    completedExecutionCount: aggregates.completedExecutionCount,
    strictAuthoredFixtureExecutionCount: aggregates.strictAuthoredFixtureExecutionCount,
    cleanCommittedExecutedBaseCount,
  });
  return {
    evidence,
    latestExecution,
    selectedAttempt,
    cleanCommittedExecutedBaseCount,
    executionEvidenceStatus,
  };
}
