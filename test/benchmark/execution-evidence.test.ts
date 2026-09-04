import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BenchmarkScenarioSchema } from '../../src/benchmark/scenario.js';
import {
  classifyExecutionEvidence,
  canonicalM2RawEvidencePath,
  executionProblems,
  M2PublishedEvidenceSchema,
  M2RawExecutionEvidenceSchema,
  validatePublishedM2Evidence,
  type ExecutionEvidenceCandidate,
  type M2RawExecutionEvidence,
  type PublishedM2Attempt,
} from '../../scripts/m2-execution/evidence-validation.js';
import { M2_ATTEMPT_SELECTION_POLICY } from '../../scripts/m2-execution/attempt-selection.js';
import { requiredReceiptCount } from '../../scripts/m2-execution/receipt-requirements.js';
import { persistM2RawEvidenceBundles } from '../../scripts/m2-execution/raw-bundle.js';
import { evaluatePostState, observationKey } from '../../src/oracle/post-state-oracle.js';

const scenario = BenchmarkScenarioSchema.parse(
  JSON.parse(await readFile('benchmark/scenarios/base/transfer/tr-01.json', 'utf8')),
);
const fixture = scenario.fixture;
if (!fixture) throw new Error('fixture required for execution evidence test');
const fixtureChains = fixture.chains;
function validCandidate(): ExecutionEvidenceCandidate {
  return {
    error: null,
    verifiedForks: fixtureChains.map((chain) => ({
      chainId: chain.chainId,
      blockNumber: chain.blockNumber,
      blockHash: chain.blockHash,
      contracts: chain.contracts,
    })),
    requiredReceiptCount: requiredReceiptCount(scenario),
    transactions: [{ role: 'USER' as const, status: 'success' as const }],
    pre: [{}],
    post: [{}],
    oracle: {
      status: 'PASS' as const,
      violations: [],
      missing: [],
      disagreements: [],
    },
  };
}

const collectorSha256 = 'b'.repeat(64);
function validRawEvidence(): M2RawExecutionEvidence {
  const pre = scenario.oracle.preState.map((row) => ({ ...row, source: 'FIXED_FORK' as const }));
  const post = pre.map((row) => ({
    ...row,
    source: 'POST_STATE' as const,
    value:
      row.subject.toLowerCase() === scenario.intent.account.toLowerCase() ? '999000000' : '1000000',
  }));
  const observedEffects = scenario.trace.expectedEffects.map((effect) => ({
    ...effect,
    phase: 'OBSERVED' as const,
    provenance: { ...effect.provenance, source: 'RECEIPT' as const },
  }));
  const transactionHash = `0x${'1'.repeat(64)}`;
  const blockHash = `0x${'2'.repeat(64)}`;
  const action = scenario.trace.actions[0];
  if (!action) throw new Error('TR-01 action missing');
  const transaction = {
    sequence: 0,
    role: 'USER' as const,
    chainId: 1,
    from: scenario.intent.account,
    to: action.target,
    calldata: action.calldata,
    valueWei: action.valueWei,
    transactionHash,
    status: 'success' as const,
    gasCostWei: '1',
    receipt: {
      type: 'eip1559',
      status: 'success' as const,
      cumulativeGasUsed: '1',
      logs: [],
      logsBloom: '0x',
      transactionHash,
      transactionIndex: 0,
      blockHash,
      blockNumber: '1',
      gasUsed: '1',
      effectiveGasPrice: '1',
      from: scenario.intent.account,
      to: action.target,
      contractAddress: null,
      blockTimestamp: 1,
    },
  };
  const receiptInput = [
    {
      chainId: transaction.chainId,
      transactionHash,
      status: transaction.status,
      gasCostWei: transaction.gasCostWei,
    },
  ];
  const oracle = evaluatePostState({
    contract: scenario.intent,
    preState: pre,
    postState: post,
    evidenceLevel: 'EXECUTED_FORK',
    executionComplete: true,
    observedEffects,
    receipts: receiptInput,
    requiredReceiptCount: requiredReceiptCount(scenario),
  });
  const deltaKeys = new Set(
    scenario.oracle.expectedDeltas.map((delta) =>
      observationKey({
        chainId: delta.chainId,
        subject: delta.subject,
        field: delta.field,
        asset: delta.asset,
        ...(delta.counterparty ? { counterparty: delta.counterparty } : {}),
        value: '0',
        source: 'EXPECTED_FIXTURE',
      }),
    ),
  );
  const referenceReconciliation = evaluatePostState({
    contract: scenario.intent,
    preState: pre,
    postState: post,
    expectedPostState: scenario.oracle.postState.filter(
      (row) => !deltaKeys.has(observationKey(row)),
    ),
    expectedDeltas: scenario.oracle.expectedDeltas,
    evidenceLevel: 'EXECUTED_FORK',
    executionComplete: true,
    observedEffects,
    receipts: receiptInput,
    requiredReceiptCount: requiredReceiptCount(scenario),
  });
  return M2RawExecutionEvidenceSchema.parse({
    datasetVersion: '0.4.0',
    scenarioId: scenario.id,
    sourceCommit: 'a'.repeat(40),
    workingTreeDirty: false,
    collectorSha256,
    sourceScenarioSha256: createHash('sha256').update(JSON.stringify(scenario)).digest('hex'),
    fixture: scenario.fixture,
    verifiedForks: fixtureChains.map((chain) => ({
      chainId: chain.chainId,
      blockNumber: chain.blockNumber,
      blockHash: chain.blockHash,
      digest: `0x${'3'.repeat(64)}`,
      contracts: chain.contracts.map((contract, index) => ({
        key: `contract-${String(index)}`,
        ...contract,
      })),
    })),
    setupNotes: [],
    fixtureCorrections: [],
    quotes: [],
    resolvedActions: scenario.trace.actions,
    requiredReceiptCount: requiredReceiptCount(scenario),
    transactions: [transaction],
    pre,
    post,
    observedEffects,
    positionTokenEvents: [],
    oracle,
    referenceReconciliation,
    error: null,
  });
}

function compactOracle(oracle: M2RawExecutionEvidence['oracle']) {
  return {
    status: oracle.status,
    violations: oracle.violations,
    missing: oracle.missing,
    disagreements: oracle.disagreements,
  };
}

function validBundle(mutateRaw?: (raw: M2RawExecutionEvidence) => void) {
  const raw = validRawEvidence();
  mutateRaw?.(raw);
  const bytes = Buffer.from(`${JSON.stringify(raw)}\n`);
  const rawFileSha256 = createHash('sha256').update(bytes).digest('hex');
  const rawFilePath = canonicalM2RawEvidencePath(rawFileSha256);
  const attempt: PublishedM2Attempt = {
    datasetVersion: raw.datasetVersion,
    scenarioId: raw.scenarioId,
    run: 'm2-test-run',
    rawFilePath,
    rawFileSha256,
    sourceCommit: raw.sourceCommit,
    workingTreeDirty: raw.workingTreeDirty,
    collectorSha256: raw.collectorSha256,
    sourceScenarioSha256: raw.sourceScenarioSha256,
    verifiedForks: raw.verifiedForks,
    setupNotes: raw.setupNotes,
    fixtureCorrections: raw.fixtureCorrections,
    fixtureCorrected: false,
    requiredReceiptCount: raw.requiredReceiptCount,
    receipts: raw.transactions.map((tx) => ({
      sequence: tx.sequence,
      role: tx.role,
      chainId: tx.chainId,
      from: tx.from,
      to: tx.to,
      transactionHash: tx.transactionHash,
      status: tx.status,
      gasCostWei: tx.gasCostWei,
      blockNumber: tx.receipt.blockNumber,
      blockHash: tx.receipt.blockHash,
      gasUsed: tx.receipt.gasUsed,
    })),
    pre: raw.pre,
    post: raw.post,
    quotes: [],
    oracle: compactOracle(raw.oracle),
    referenceReconciliation: raw.referenceReconciliation
      ? compactOracle(raw.referenceReconciliation)
      : null,
    executionComplete: true,
    incompletenessReasons: [],
    failure: null,
  };
  const evidence = {
    datasetVersion: '0.4.0',
    purpose: 'Diagnostic evidence, not a frozen performance result',
    selection: M2_ATTEMPT_SELECTION_POLICY,
    baseCount: 1,
    attemptedCount: 1,
    missing: [],
    completedExecutionCount: 1,
    strictAuthoredFixtureExecutionCount: 1,
    finalGoalPassCount: 1,
    strictAuthoredFixtureFinalGoalPassCount: 1,
    syntheticReferenceCheckedCount: 1,
    syntheticReferenceDisagreementCount: 0,
    humanReview: 'PENDING',
    m2Complete: false,
    latest: [
      {
        datasetVersion: '0.4.0',
        scenarioId: attempt.scenarioId,
        run: attempt.run,
        rawFilePath: attempt.rawFilePath,
        rawFileSha256: attempt.rawFileSha256,
        executionComplete: true,
        fixtureCorrected: false,
        oracleStatus: 'PASS',
      },
    ],
    attempts: [attempt],
  };
  return { raw, bytes, attempt, evidence };
}

function validatePublished(
  input: unknown,
  bytesByPath: ReadonlyMap<string, Uint8Array>,
  overrides: {
    currentCollectorSha256?: string;
    sourceCommitResolves?: (commit: string) => boolean;
    sourceCommitIsAncestor?: (commit: string) => boolean;
  } = {},
) {
  return validatePublishedM2Evidence(input, {
    scenarios: [scenario],
    currentCollectorSha256: overrides.currentCollectorSha256 ?? collectorSha256,
    sourceCommitResolves: overrides.sourceCommitResolves ?? (() => true),
    sourceCommitIsAncestor: overrides.sourceCommitIsAncestor ?? (() => true),
    readRawEvidenceBytes: (path) => {
      const bytes = bytesByPath.get(path);
      if (!bytes) throw new Error('missing test raw evidence');
      return bytes;
    },
    rawEvidenceSource: 'GIT_HEAD_TRACKED',
  });
}

describe('published execution evidence validation', () => {
  it('accepts internally consistent evidence tied to the scenario fixture', () => {
    expect(executionProblems(validCandidate(), scenario)).toEqual([]);
  });

  it('recomputes receipt requirements instead of trusting the raw count', () => {
    const candidate = validCandidate();
    candidate.requiredReceiptCount = 0;
    expect(executionProblems(candidate, scenario)).toContain('receipts:requirement-mismatch');
  });

  it('rejects inconsistent PASS and a wrong pinned fork fingerprint', () => {
    const candidate = validCandidate();
    candidate.oracle.violations.push({ code: 'IMPOSSIBLE' });
    const firstFork = candidate.verifiedForks[0];
    if (!firstFork) throw new Error('expected fixture fork');
    candidate.verifiedForks[0] = {
      ...firstFork,
      blockHash: `0x${'0'.repeat(64)}`,
    };
    expect(executionProblems(candidate, scenario)).toEqual(
      expect.arrayContaining(['oracle:inconsistent', 'forks:fingerprint:1']),
    );
  });

  it('does not call a clean corrected-fixture run a clean candidate', () => {
    expect(
      classifyExecutionEvidence({
        baseCount: 80,
        completedExecutionCount: 80,
        strictAuthoredFixtureExecutionCount: 77,
        cleanCommittedExecutedBaseCount: 80,
      }),
    ).toBe('CLEAN_COMMITTED_WITH_FIXTURE_CORRECTIONS');
    expect(
      classifyExecutionEvidence({
        baseCount: 80,
        completedExecutionCount: 80,
        strictAuthoredFixtureExecutionCount: 80,
        cleanCommittedExecutedBaseCount: 80,
      }),
    ).toBe('CLEAN_COMMITTED_CANDIDATE');
  });

  it('requires datasetVersion on each selected latest row', () => {
    const { evidence } = validBundle();
    const [latest] = evidence.latest;
    expect(latest).toBeDefined();
    if (!latest) throw new Error('latest row missing');
    const withoutDatasetVersion: Record<string, unknown> = { ...latest };
    delete withoutDatasetVersion.datasetVersion;
    expect(
      M2PublishedEvidenceSchema.safeParse({ ...evidence, latest: [withoutDatasetVersion] }).success,
    ).toBe(false);
  });

  it('requires and independently recomputes the synthetic reference checked denominator', () => {
    const bundle = validBundle();
    const withoutCheckedCount: Record<string, unknown> = { ...bundle.evidence };
    delete withoutCheckedCount.syntheticReferenceCheckedCount;
    expect(M2PublishedEvidenceSchema.safeParse(withoutCheckedCount).success).toBe(false);

    const understated = structuredClone(bundle.evidence);
    understated.syntheticReferenceCheckedCount = 0;
    expect(() =>
      validatePublished(understated, new Map([[bundle.attempt.rawFilePath, bundle.bytes]])),
    ).toThrow('published execution aggregate does not match revalidated attempts');

    const uncollected = {
      ...structuredClone(bundle.evidence),
      attemptedCount: 0,
      missing: [scenario.id],
      completedExecutionCount: 0,
      strictAuthoredFixtureExecutionCount: 0,
      finalGoalPassCount: 0,
      strictAuthoredFixtureFinalGoalPassCount: 0,
      syntheticReferenceCheckedCount: 0,
      latest: [],
      attempts: [],
    };
    expect(validatePublished(uncollected, new Map()).evidence.syntheticReferenceCheckedCount).toBe(
      0,
    );
  });

  it('recomputes completion from full receipts and observations instead of trusting flags', () => {
    const bundle = validBundle();
    const attempt = bundle.evidence.attempts[0];
    if (!attempt) throw new Error('attempt missing');
    attempt.receipts = [];
    expect(() =>
      validatePublished(bundle.evidence, new Map([[bundle.attempt.rawFilePath, bundle.bytes]])),
    ).toThrow('published attempt does not match tracked raw evidence');
  });

  it('binds the latest hash and clean status to selected full evidence provenance', () => {
    const bundle = validBundle();
    const bytesByPath = new Map([[bundle.attempt.rawFilePath, bundle.bytes]]);
    expect(validatePublished(bundle.evidence, bytesByPath)).toMatchObject({
      cleanCommittedExecutedBaseCount: 1,
      executionEvidenceStatus: 'CLEAN_COMMITTED_CANDIDATE',
    });
    const badLatest = structuredClone(bundle.evidence);
    const latest = badLatest.latest[0];
    if (!latest) throw new Error('latest row missing');
    latest.rawFileSha256 = 'd'.repeat(64);
    expect(() => validatePublished(badLatest, bytesByPath)).toThrow(
      'latest row does not match selected attempt',
    );

    const dirtyBundle = validBundle((raw) => {
      raw.workingTreeDirty = true;
    });
    expect(
      validatePublished(
        dirtyBundle.evidence,
        new Map([[dirtyBundle.attempt.rawFilePath, dirtyBundle.bytes]]),
      ),
    ).toMatchObject({
      cleanCommittedExecutedBaseCount: 0,
      executionEvidenceStatus: 'DIAGNOSTIC_DIRTY',
    });
  });

  it('rejects a missing or byte-tampered tracked raw bundle', () => {
    const bundle = validBundle();
    expect(() => validatePublished(bundle.evidence, new Map())).toThrow(
      'missing tracked raw evidence',
    );
    expect(() =>
      validatePublished(
        bundle.evidence,
        new Map([[bundle.attempt.rawFilePath, Buffer.from('{}\n')]]),
      ),
    ).toThrow('raw evidence byte hash mismatch');
  });

  it('persists exact content-addressed raw bytes immutably', async () => {
    const bundle = validBundle();
    const root = await mkdtemp(join(tmpdir(), 'intentlock-m2-raw-'));
    if (!resolve(root).startsWith(resolve(tmpdir(), 'intentlock-m2-raw-'))) {
      throw new Error('unexpected raw-bundle test directory');
    }
    try {
      const entries = new Map([[bundle.attempt.rawFilePath, bundle.bytes]]);
      await persistM2RawEvidenceBundles(entries, root);
      await persistM2RawEvidenceBundles(entries, root);
      expect(await readFile(join(root, bundle.attempt.rawFilePath))).toEqual(bundle.bytes);
      await expect(
        persistM2RawEvidenceBundles(
          new Map([[bundle.attempt.rawFilePath, Buffer.from('different bytes')]]),
          root,
        ),
      ).rejects.toThrow('raw evidence bytes do not match content-addressed path');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a stale collector or a source commit outside current HEAD lineage', () => {
    const bundle = validBundle();
    const bytesByPath = new Map([[bundle.attempt.rawFilePath, bundle.bytes]]);
    expect(() =>
      validatePublished(bundle.evidence, bytesByPath, {
        currentCollectorSha256: 'd'.repeat(64),
      }),
    ).toThrow('stale raw execution collector');
    expect(() =>
      validatePublished(bundle.evidence, bytesByPath, {
        sourceCommitIsAncestor: () => false,
      }),
    ).toThrow('raw source commit is not in the current HEAD lineage');
  });

  it('rejects a self-consistent published PASS when raw effects prove a violation', () => {
    const bundle = validBundle((raw) => {
      const transfer = raw.observedEffects.find((effect) => effect.kind === 'TRANSFER');
      if (!transfer) throw new Error('transfer effect missing');
      transfer.amount = '2000000';
      // The attacker leaves both raw.oracle and every published summary at PASS.
    });
    expect(() =>
      validatePublished(bundle.evidence, new Map([[bundle.attempt.rawFilePath, bundle.bytes]])),
    ).toThrow('stored raw oracle does not reproduce');
  });
});
