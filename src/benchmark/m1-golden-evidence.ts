import { createHash } from 'node:crypto';

import { keccak256, type Hex } from 'viem';
import { z } from 'zod';

const AddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const Bytes32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const HexSchema = z.string().regex(/^0x[0-9a-fA-F]*$/);
const DecisionSchema = z.enum(['ALLOW', 'DENY', 'ESCALATE']);

export const M1GoldenFixtureSchema = z
  .object({
    schemaVersion: z.literal('0.1'),
    fork: z
      .object({
        chainId: z.literal(1),
        blockNumber: z.number().int().positive(),
        blockHash: Bytes32Schema,
      })
      .strict(),
    addresses: z
      .object({
        account: AddressSchema,
        recipient: AddressSchema,
        attacker: AddressSchema,
        usdc: AddressSchema,
        weth: AddressSchema,
        swapRouter02: AddressSchema,
        quoterV2: AddressSchema,
        poolUsdcWeth500: AddressSchema,
      })
      .strict(),
    codehashes: z
      .object({
        usdc: Bytes32Schema,
        swapRouter02: Bytes32Schema,
        quoterV2: Bytes32Schema,
        poolUsdcWeth500: Bytes32Schema,
      })
      .strict(),
    scenarios: z
      .array(
        z
          .object({
            id: z.string().regex(/^G\d{2}-/),
            class: z.enum(['NORMAL', 'ATTACK', 'DRIFT']),
            target: z.enum(['usdc', 'swapRouter02']),
            data: HexSchema,
            quotedAmountOut: z.string().regex(/^\d+$/).optional(),
            codehashDrift: z.boolean().optional(),
            expectedDecision: DecisionSchema,
            expectedCode: z.string().optional(),
          })
          .strict(),
      )
      .length(10),
  })
  .strict();

export type M1GoldenFixture = z.infer<typeof M1GoldenFixtureSchema>;
export type M1GoldenScenario = M1GoldenFixture['scenarios'][number];

const StateAssertionSchema = z
  .object({
    name: z.string().min(1),
    before: z.string(),
    after: z.string(),
    expected: z.string(),
    passed: z.boolean(),
  })
  .strict();

const TransactionEvidenceSchema = z
  .object({
    hash: Bytes32Schema,
    status: z.literal('SUCCESS'),
    blockNumber: z.number().int().positive(),
    blockHash: Bytes32Schema,
    gasUsedWei: z.string().regex(/^\d+$/),
  })
  .strict();

const TokenFlowSchema = z
  .object({
    token: AddressSchema,
    from: AddressSchema,
    to: AddressSchema,
    amount: z.string().regex(/^\d+$/),
    logIndex: z.number().int().nonnegative(),
  })
  .strict();

const SwapProofSchema = z
  .object({
    quoter: AddressSchema,
    quoterCodehash: Bytes32Schema,
    pool: AddressSchema,
    poolCodehash: Bytes32Schema,
    sourceCalldataHash: Bytes32Schema,
    quotedAmountOut: z.string().regex(/^\d+$/),
    authoredMinimum: z.string().regex(/^\d+$/),
    actualAmountOut: z.string().regex(/^\d+$/),
    inputFlowLogIndex: z.number().int().nonnegative(),
    outputFlowLogIndex: z.number().int().nonnegative(),
    unexpectedAccountTokenFlowCount: z.number().int().nonnegative(),
  })
  .strict();

const ScenarioEvidenceSchema = z
  .object({
    scenarioId: z.string().regex(/^G\d{2}-/),
    class: z.enum(['NORMAL', 'ATTACK', 'DRIFT']),
    expectedDecision: DecisionSchema,
    observedDecision: DecisionSchema,
    expectedCode: z.string().nullable(),
    observedCode: z.string().nullable(),
    adapterStatus: z.enum(['BLOCKED', 'EXECUTED_VERIFIED']),
    signerInvoked: z.boolean(),
    signerCallCount: z.number().int().nonnegative(),
    setupTransactionHashes: z.array(Bytes32Schema),
    transaction: TransactionEvidenceSchema.nullable(),
    intentHash: Bytes32Schema,
    auditLogId: Bytes32Schema,
    reservationId: z.string().nullable(),
    effectMismatchCount: z.number().int().nonnegative(),
    rawTokenFlows: z.array(TokenFlowSchema),
    swapProof: SwapProofSchema.nullable(),
    stateAssertions: z.array(StateAssertionSchema).min(1),
    normalizationBasis: z.enum(['REAL_RECEIPT_AND_POST_STATE', 'PINNED_FORK_SIGNER_BOUNDARY']),
    runtimeCodehash: Bytes32Schema,
    fixtureMutation: z
      .object({
        kind: z.literal('ANVIL_SET_CODE'),
        target: AddressSchema,
        originalCodehash: Bytes32Schema,
        mutatedCodehash: Bytes32Schema,
      })
      .strict()
      .nullable(),
  })
  .strict();

export const M1GoldenEvidenceSchema = z
  .object({
    schemaVersion: z.literal('m1-golden-evidence-v1'),
    generatedAt: z.iso.datetime({ offset: true }),
    source: z
      .object({
        commitSha: z.string().regex(/^[0-9a-f]{40}$/),
        workingTreeDirty: z.boolean(),
        runnerSha256: z.string().regex(/^[0-9a-f]{64}$/),
        fixtureSha256: z.string().regex(/^[0-9a-f]{64}$/),
        toolchain: z
          .object({
            node: z.string().min(1),
            pnpm: z.string().min(1),
            anvil: z.string().min(1),
          })
          .strict(),
      })
      .strict(),
    fork: z
      .object({
        chainId: z.literal(1),
        blockNumber: z.number().int().positive(),
        blockHash: Bytes32Schema,
        fingerprintDigest: Bytes32Schema,
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
      .strict(),
    summary: z
      .object({
        scenarioCount: z.literal(10),
        allowCount: z.literal(5),
        blockedCount: z.literal(5),
        realTransactionCount: z.literal(5),
        signerInvocationCount: z.literal(5),
        allMatched: z.boolean(),
        stableDecisionDigest: Bytes32Schema,
      })
      .strict(),
    scenarios: z.array(ScenarioEvidenceSchema).length(10),
  })
  .strict();

export type M1GoldenEvidence = z.infer<typeof M1GoldenEvidenceSchema>;

export function computeM1StableDecisionDigest(
  evidence: Omit<M1GoldenEvidence, 'summary'> & {
    summary: Omit<M1GoldenEvidence['summary'], 'stableDecisionDigest'> & {
      stableDecisionDigest?: string;
    };
  },
): `0x${string}` {
  const stable = {
    commitSha: evidence.source.commitSha,
    runnerSha256: evidence.source.runnerSha256,
    fixtureSha256: evidence.source.fixtureSha256,
    fingerprintDigest: evidence.fork.fingerprintDigest.toLowerCase(),
    scenarios: [...evidence.scenarios]
      .sort((left, right) => left.scenarioId.localeCompare(right.scenarioId))
      .map((entry) => ({
        scenarioId: entry.scenarioId,
        observedDecision: entry.observedDecision,
        observedCode: entry.observedCode,
        signerCallCount: entry.signerCallCount,
        transactionStatus: entry.transaction?.status ?? null,
        normalizationBasis: entry.normalizationBasis,
        runtimeCodehash: entry.runtimeCodehash.toLowerCase(),
        rawTokenFlows: [...entry.rawTokenFlows]
          .sort((left, right) => left.logIndex - right.logIndex)
          .map((flow) => ({
            token: flow.token.toLowerCase(),
            from: flow.from.toLowerCase(),
            to: flow.to.toLowerCase(),
            amount: flow.amount,
            logIndex: flow.logIndex,
          })),
        swapProof: entry.swapProof
          ? {
              quoter: entry.swapProof.quoter.toLowerCase(),
              quoterCodehash: entry.swapProof.quoterCodehash.toLowerCase(),
              pool: entry.swapProof.pool.toLowerCase(),
              poolCodehash: entry.swapProof.poolCodehash.toLowerCase(),
              sourceCalldataHash: entry.swapProof.sourceCalldataHash.toLowerCase(),
              quotedAmountOut: entry.swapProof.quotedAmountOut,
              authoredMinimum: entry.swapProof.authoredMinimum,
              actualAmountOut: entry.swapProof.actualAmountOut,
              inputFlowLogIndex: entry.swapProof.inputFlowLogIndex,
              outputFlowLogIndex: entry.swapProof.outputFlowLogIndex,
              unexpectedAccountTokenFlowCount: entry.swapProof.unexpectedAccountTokenFlowCount,
            }
          : null,
        fixtureMutation: entry.fixtureMutation
          ? {
              kind: entry.fixtureMutation.kind,
              target: entry.fixtureMutation.target.toLowerCase(),
              originalCodehash: entry.fixtureMutation.originalCodehash.toLowerCase(),
              mutatedCodehash: entry.fixtureMutation.mutatedCodehash.toLowerCase(),
            }
          : null,
        assertions: entry.stateAssertions.map((assertion) => ({
          name: assertion.name,
          before: assertion.before,
          after: assertion.after,
          expected: assertion.expected,
          passed: assertion.passed,
        })),
      })),
  };
  return `0x${createHash('sha256').update(JSON.stringify(stable)).digest('hex')}`;
}

export interface M1GoldenValidationOptions {
  fixtureSha256: string;
  requireClean?: boolean;
  expectedCommitSha?: string;
}

function sameCaseSet(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

export function validateM1GoldenEvidence(
  value: unknown,
  fixtureValue: unknown,
  options: M1GoldenValidationOptions,
): M1GoldenEvidence {
  const evidence = M1GoldenEvidenceSchema.parse(value);
  const fixture = M1GoldenFixtureSchema.parse(fixtureValue);
  if (evidence.source.fixtureSha256 !== options.fixtureSha256) {
    throw new Error('M1 Golden evidence was produced from a different fixture');
  }
  if (computeM1StableDecisionDigest(evidence) !== evidence.summary.stableDecisionDigest) {
    throw new Error('M1 Golden stable decision digest does not match the evidence records');
  }
  if (options.requireClean && evidence.source.workingTreeDirty) {
    throw new Error('M1 Golden closeout evidence must come from a clean worktree');
  }
  if (options.expectedCommitSha && evidence.source.commitSha !== options.expectedCommitSha) {
    throw new Error('M1 Golden evidence commit does not match the requested commit');
  }
  if (
    evidence.fork.blockNumber !== fixture.fork.blockNumber ||
    evidence.fork.blockHash.toLowerCase() !== fixture.fork.blockHash.toLowerCase()
  ) {
    throw new Error('M1 Golden evidence fork identity does not match the frozen fixture');
  }
  const usdc = evidence.fork.contracts.find((entry) => entry.key === 'usdc');
  const router = evidence.fork.contracts.find((entry) => entry.key === 'swapRouter02');
  if (usdc?.codehash.toLowerCase() !== fixture.codehashes.usdc.toLowerCase()) {
    throw new Error('M1 Golden evidence has the wrong pinned USDC codehash');
  }
  if (router?.codehash.toLowerCase() !== fixture.codehashes.swapRouter02.toLowerCase()) {
    throw new Error('M1 Golden evidence has the wrong pinned SwapRouter02 codehash');
  }
  if (
    !sameCaseSet(
      evidence.scenarios.map((entry) => entry.scenarioId),
      fixture.scenarios.map((entry) => entry.id),
    )
  ) {
    throw new Error('M1 Golden evidence does not cover the exact fixture case set');
  }

  const fixtureById = new Map(fixture.scenarios.map((entry) => [entry.id, entry]));
  for (const entry of evidence.scenarios) {
    const scenario = fixtureById.get(entry.scenarioId);
    if (!scenario) throw new Error(`unknown M1 Golden scenario: ${entry.scenarioId}`);
    const expectedCode = scenario.expectedCode ?? null;
    if (
      entry.class !== scenario.class ||
      entry.expectedDecision !== scenario.expectedDecision ||
      entry.expectedCode !== expectedCode
    ) {
      throw new Error(`M1 Golden evidence rewrites fixture expectations for ${entry.scenarioId}`);
    }
    if (
      entry.observedDecision !== scenario.expectedDecision ||
      entry.observedCode !== expectedCode ||
      entry.stateAssertions.some((assertion) => !assertion.passed)
    ) {
      throw new Error(`M1 Golden scenario did not match its expectation: ${entry.scenarioId}`);
    }
    if (scenario.expectedDecision === 'ALLOW') {
      if (
        entry.adapterStatus !== 'EXECUTED_VERIFIED' ||
        !entry.signerInvoked ||
        entry.signerCallCount !== 1 ||
        entry.transaction === null ||
        entry.reservationId === null ||
        entry.effectMismatchCount !== 0 ||
        entry.normalizationBasis !== 'REAL_RECEIPT_AND_POST_STATE'
      ) {
        throw new Error(
          `ALLOW scenario lacks real receipt/post-state evidence: ${entry.scenarioId}`,
        );
      }
    } else if (
      entry.adapterStatus !== 'BLOCKED' ||
      entry.signerInvoked ||
      entry.signerCallCount !== 0 ||
      entry.transaction !== null ||
      entry.reservationId !== null ||
      entry.effectMismatchCount !== 0 ||
      entry.rawTokenFlows.length !== 0 ||
      entry.swapProof !== null ||
      entry.normalizationBasis !== 'PINNED_FORK_SIGNER_BOUNDARY'
    ) {
      throw new Error(
        `blocked scenario reached or failed to prove the signer gate: ${entry.scenarioId}`,
      );
    }
    if (scenario.codehashDrift) {
      if (
        entry.fixtureMutation?.kind !== 'ANVIL_SET_CODE' ||
        entry.fixtureMutation.target.toLowerCase() !== fixture.addresses.usdc.toLowerCase() ||
        entry.fixtureMutation.originalCodehash.toLowerCase() !==
          fixture.codehashes.usdc.toLowerCase() ||
        entry.fixtureMutation.originalCodehash.toLowerCase() ===
          entry.fixtureMutation.mutatedCodehash.toLowerCase() ||
        entry.runtimeCodehash.toLowerCase() !== entry.fixtureMutation.mutatedCodehash.toLowerCase()
      ) {
        throw new Error(`codehash drift was not induced on the fork for ${entry.scenarioId}`);
      }
    } else if (entry.fixtureMutation !== null) {
      throw new Error(`unexpected fixture mutation in ${entry.scenarioId}`);
    }
    if (entry.scenarioId === 'G05-bounded-swap') {
      const proof = entry.swapProof;
      if (!proof) throw new Error('G05 lacks a route-aware swap proof');
      const pinnedPool = evidence.fork.contracts.find(
        (contract) => contract.key === 'poolUsdcWeth500',
      );
      const exactMinimum = (BigInt(proof.quotedAmountOut) * 9_900n) / 10_000n;
      if (
        proof.quotedAmountOut !== scenario.quotedAmountOut ||
        proof.authoredMinimum !== exactMinimum.toString() ||
        proof.sourceCalldataHash.toLowerCase() !== keccak256(scenario.data as Hex).toLowerCase() ||
        proof.quoter.toLowerCase() !== fixture.addresses.quoterV2.toLowerCase() ||
        proof.quoterCodehash.toLowerCase() !== fixture.codehashes.quoterV2.toLowerCase() ||
        BigInt(proof.actualAmountOut) < BigInt(proof.authoredMinimum) ||
        proof.unexpectedAccountTokenFlowCount !== 0 ||
        pinnedPool?.address.toLowerCase() !== fixture.addresses.poolUsdcWeth500.toLowerCase() ||
        pinnedPool.codehash.toLowerCase() !== fixture.codehashes.poolUsdcWeth500.toLowerCase() ||
        pinnedPool.address.toLowerCase() !== proof.pool.toLowerCase() ||
        pinnedPool.codehash.toLowerCase() !== proof.poolCodehash.toLowerCase()
      ) {
        throw new Error('G05 swap proof does not match the pinned route and authored minimum');
      }
      const input = entry.rawTokenFlows.find((flow) => flow.logIndex === proof.inputFlowLogIndex);
      const output = entry.rawTokenFlows.find((flow) => flow.logIndex === proof.outputFlowLogIndex);
      if (
        !input ||
        !output ||
        input.token.toLowerCase() !== fixture.addresses.usdc.toLowerCase() ||
        input.from.toLowerCase() !== fixture.addresses.account.toLowerCase() ||
        input.to.toLowerCase() !== proof.pool.toLowerCase() ||
        input.amount !== '1000000' ||
        output.token.toLowerCase() !== fixture.addresses.weth.toLowerCase() ||
        output.from.toLowerCase() !== proof.pool.toLowerCase() ||
        output.to.toLowerCase() !== fixture.addresses.recipient.toLowerCase() ||
        output.amount !== proof.actualAmountOut
      ) {
        throw new Error('G05 raw receipt flows do not prove the normalized swap route');
      }
    } else if (entry.swapProof !== null) {
      throw new Error(`unexpected swap proof in ${entry.scenarioId}`);
    }
  }

  const allowCount = evidence.scenarios.filter(
    (entry) => entry.expectedDecision === 'ALLOW',
  ).length;
  const blockedCount = evidence.scenarios.length - allowCount;
  const realTransactionCount = evidence.scenarios.filter(
    (entry) => entry.transaction !== null,
  ).length;
  const signerInvocationCount = evidence.scenarios.reduce(
    (total, entry) => total + entry.signerCallCount,
    0,
  );
  const allMatched = evidence.scenarios.every(
    (entry) =>
      entry.expectedDecision === entry.observedDecision &&
      entry.expectedCode === entry.observedCode &&
      entry.stateAssertions.every((assertion) => assertion.passed),
  );
  if (
    allowCount !== evidence.summary.allowCount ||
    blockedCount !== evidence.summary.blockedCount ||
    realTransactionCount !== evidence.summary.realTransactionCount ||
    signerInvocationCount !== evidence.summary.signerInvocationCount ||
    allMatched !== evidence.summary.allMatched
  ) {
    throw new Error('M1 Golden evidence summary does not match its scenario records');
  }
  return evidence;
}
