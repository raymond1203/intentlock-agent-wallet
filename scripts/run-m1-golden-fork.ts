import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { decodeEventLog, keccak256, parseAbi, type Address, type Hex } from 'viem';

import {
  IntentLockMetaMaskAdapter,
  type MetaMaskExecutionReceipt,
  type MetaMaskWalletExecutor,
} from '../src/adapters/metamask/adapter.js';
import {
  computeM1StableDecisionDigest,
  M1GoldenEvidenceSchema,
  M1GoldenFixtureSchema,
  type M1GoldenEvidence,
  type M1GoldenFixture,
  type M1GoldenScenario,
  validateM1GoldenEvidence,
} from '../src/benchmark/m1-golden-evidence.js';
import type { EconomicEffect } from '../src/domain/action-ir.js';
import type { IntentContract } from '../src/domain/intent-contract.js';
import {
  AnvilFork,
  loadForkConfig,
  sanitizeExecutionFailure,
  type Fingerprint,
} from './anvil-harness.js';
import { decodeBatchCalldata, type BatchDecoderOptions } from '../src/effects/batch-decoder.js';
import { readPinnedQuote } from './m2-execution/quotes.js';
import { ForkRuntime, json, owner, resetExecutionSequence } from './m2-execution/runtime.js';
import {
  assertCleanSourceAtStart,
  assertCleanSourceUnchanged,
  readGitSourceState,
} from './source-integrity.js';

const MODULE_PARENT = resolve(import.meta.dirname, '..');
const ROOT = existsSync(resolve(MODULE_PARENT, 'package.json'))
  ? MODULE_PARENT
  : resolve(MODULE_PARENT, '..');
const FIXTURE_PATH = resolve(ROOT, 'benchmark/scenarios/golden/scenarios.json');
const DEFAULT_OUTPUT = resolve(ROOT, 'experiments/results/m1-golden-evidence.json');
const HUNDRED_ETH = 100n * 10n ** 18n;
const USDC_UNIT = 1_000_000n;
const TRANSFER_EVENT_ABI = parseAbi([
  'event Transfer(address indexed from,address indexed to,uint256 value)',
]);

type ScenarioEvidence = M1GoldenEvidence['scenarios'][number];
type StateAssertion = ScenarioEvidence['stateAssertions'][number];
type TokenFlow = ScenarioEvidence['rawTokenFlows'][number];

let activeRunStage = 'startup';

function setRunStage(stage: string): void {
  activeRunStage = stage;
}

function scenarioStage(scenario: M1GoldenScenario, phase: string): string {
  const safeId = /^[A-Za-z0-9_-]{1,64}$/.test(scenario.id) ? scenario.id : 'invalid-scenario-id';
  return `scenario:${safeId}:${phase}`;
}

interface StateSnapshot {
  ownerUsdc: bigint;
  recipientUsdc: bigint;
  recipientWeth: bigint;
  routerAllowance: bigint;
  accountNonce: number;
}

function parseOutputArgument(): string {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf('--output');
  if (outputIndex === -1) return DEFAULT_OUTPUT;
  const value = args[outputIndex + 1];
  if (!value) throw new Error('--output requires a path');
  return resolve(ROOT, value);
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function fileSha256(path: string): string {
  return sha256(readFileSync(path));
}

function commandOutput(command: string, args: readonly string[]): string {
  return execFileSync(command, [...args], { cwd: ROOT, encoding: 'utf8' }).trim();
}

function toolVersion(command: string, args: readonly string[] = ['--version']): string {
  try {
    return commandOutput(command, args).split(/\r?\n/, 1)[0] ?? 'unknown';
  } catch {
    return 'unavailable';
  }
}

function runnerSha256(): string {
  const paths = [
    'scripts/run-m1-golden-fork.ts',
    'src/benchmark/m1-golden-evidence.ts',
    'src/adapters/metamask/adapter.ts',
    'src/effects/batch-decoder.ts',
    'src/effects/erc20-decoder.ts',
    'src/effects/swap-decoder.ts',
    'src/monitor/monitor.ts',
    'scripts/anvil-harness.ts',
    'scripts/m2-execution/runtime.ts',
    'scripts/m2-execution/quotes.ts',
    'scripts/source-integrity.ts',
  ];
  return sha256(
    paths
      .sort()
      .map((path) => `${path}:${fileSha256(resolve(ROOT, path))}`)
      .join('\n'),
  );
}

function observed(effects: readonly EconomicEffect[]): EconomicEffect[] {
  return effects.map((effect) => ({
    ...effect,
    phase: 'OBSERVED',
    provenance: { ...effect.provenance, source: 'RECEIPT' },
  }));
}

function fingerprintContract(fingerprint: Fingerprint, key: string) {
  const entry = fingerprint.contracts.find((candidate) => candidate.key === key);
  if (!entry) throw new Error(`pinned fingerprint is missing ${key}`);
  return entry;
}

async function runtimeCodehash(runtime: ForkRuntime, address: Address): Promise<Hex> {
  const code = await runtime.client.getCode({ address });
  if (!code || code === '0x') return keccak256('0x');
  return keccak256(code);
}

function decoderFor(
  fixture: M1GoldenFixture,
  scenario: M1GoldenScenario,
  observedUsdcCodehash: Hex,
): BatchDecoderOptions {
  return {
    contracts: {
      [fixture.addresses.usdc]: {
        kind: 'ERC20',
        codehash: fixture.codehashes.usdc as Hex,
      },
      [fixture.addresses.swapRouter02]: {
        kind: 'SWAP_ROUTER_02',
        codehash: fixture.codehashes.swapRouter02 as Hex,
      },
    },
    observedCodehashes: {
      [fixture.addresses.usdc]: observedUsdcCodehash,
      [fixture.addresses.swapRouter02]: fixture.codehashes.swapRouter02 as Hex,
    },
    requireCodehash: true,
    ...(scenario.quotedAmountOut ? { quotedAmountOut: scenario.quotedAmountOut } : {}),
  };
}

async function snapshotState(
  runtime: ForkRuntime,
  fixture: M1GoldenFixture,
): Promise<StateSnapshot> {
  return {
    ownerUsdc: await runtime.balance(fixture.addresses.usdc as Address, owner.address),
    recipientUsdc: await runtime.balance(
      fixture.addresses.usdc as Address,
      fixture.addresses.recipient as Address,
    ),
    recipientWeth: await runtime.balance(
      fixture.addresses.weth as Address,
      fixture.addresses.recipient as Address,
    ),
    routerAllowance: await runtime.allowance(
      fixture.addresses.usdc as Address,
      owner.address,
      fixture.addresses.swapRouter02 as Address,
    ),
    accountNonce: await runtime.client.getTransactionCount({ address: owner.address }),
  };
}

function assertion(
  name: string,
  before: bigint | number | string,
  after: bigint | number | string,
  expected: bigint | number | string,
  passed: boolean,
): StateAssertion {
  return {
    name,
    before: String(before),
    after: String(after),
    expected: String(expected),
    passed,
  };
}

function contractFor(
  fixture: M1GoldenFixture,
  scenario: M1GoldenScenario,
  pre: StateSnapshot,
): IntentContract {
  const goal = (() => {
    switch (scenario.id) {
      case 'G01-bounded-transfer':
        return {
          kind: 'MIN_ASSET_BALANCE' as const,
          chainId: 1,
          asset: fixture.addresses.usdc,
          account: fixture.addresses.recipient,
          minAmount: (pre.recipientUsdc + USDC_UNIT).toString(),
        };
      case 'G02-transfer-at-limit':
        return {
          kind: 'MIN_ASSET_BALANCE' as const,
          chainId: 1,
          asset: fixture.addresses.usdc,
          account: fixture.addresses.recipient,
          minAmount: (pre.recipientUsdc + 2n * USDC_UNIT).toString(),
        };
      case 'G04-revoke-approval':
        return {
          kind: 'NO_RESIDUAL_ALLOWANCE' as const,
          chainId: 1,
          asset: fixture.addresses.usdc,
          owner: owner.address,
          spender: fixture.addresses.swapRouter02,
        };
      case 'G05-bounded-swap':
        return {
          kind: 'MIN_ASSET_BALANCE' as const,
          chainId: 1,
          asset: fixture.addresses.weth,
          account: fixture.addresses.recipient,
          minAmount: (pre.recipientWeth + 521_038_266_663_319n).toString(),
        };
      default:
        return {
          kind: 'MIN_ASSET_BALANCE' as const,
          chainId: 1,
          asset: fixture.addresses.usdc,
          account: owner.address,
          minAmount: pre.ownerUsdc.toString(),
        };
    }
  })();
  return {
    version: '0.1',
    account: owner.address,
    nonce: '1',
    idempotencyKey: scenario.id,
    safety: {
      chainScopes: [
        {
          chainId: 1,
          allowedTargets: [
            { target: fixture.addresses.usdc, selectors: ['0xa9059cbb', '0x095ea7b3'] },
            { target: fixture.addresses.swapRouter02, selectors: ['0x04e45aaf'] },
          ],
          allowedRecipients: [owner.address, fixture.addresses.recipient],
        },
      ],
      assetBudgets: [
        {
          chainId: 1,
          asset: fixture.addresses.usdc,
          maxGrossOutflow: (2n * USDC_UNIT).toString(),
          maxAllowanceExposure: USDC_UNIT.toString(),
        },
      ],
      maxGasWei: '10000000000000000',
      maxSlippageBps: 100,
      expiresAt: '2026-09-05T00:00:00+09:00',
    },
    finalStateGoals: [goal],
  };
}

async function prepareScenario(
  runtime: ForkRuntime,
  fixture: M1GoldenFixture,
  scenario: M1GoldenScenario,
): Promise<Hex[]> {
  const setupHashes: Hex[] = [];
  const usdc = fixture.addresses.usdc as Address;
  const router = fixture.addresses.swapRouter02 as Address;
  if (scenario.expectedDecision === 'ALLOW') {
    const amount = scenario.id === 'G02-transfer-at-limit' ? 2n * USDC_UNIT : USDC_UNIT;
    await runtime.fork.dealErc20(usdc, owner.address, amount);
  }
  if (scenario.id === 'G03-bounded-approval') {
    const current = await runtime.allowance(usdc, owner.address, router);
    if (current !== 0n) setupHashes.push((await runtime.approve(usdc, router, 0n)).transactionHash);
  }
  if (scenario.id === 'G04-revoke-approval' || scenario.id === 'G05-bounded-swap') {
    setupHashes.push((await runtime.approve(usdc, router, USDC_UNIT)).transactionHash);
  }
  return setupHashes;
}

function extractTokenFlows(
  fixture: M1GoldenFixture,
  receipt: Awaited<ReturnType<ForkRuntime['send']>>['receipt'],
): TokenFlow[] {
  const tracked = new Set([
    fixture.addresses.usdc.toLowerCase(),
    fixture.addresses.weth.toLowerCase(),
  ]);
  return receipt.logs.flatMap((log): TokenFlow[] => {
    if (!tracked.has(log.address.toLowerCase())) return [];
    try {
      const decoded = decodeEventLog({
        abi: TRANSFER_EVENT_ABI,
        eventName: 'Transfer',
        topics: log.topics,
        data: log.data,
        strict: true,
      });
      return [
        {
          token: log.address,
          from: decoded.args.from,
          to: decoded.args.to,
          amount: decoded.args.value.toString(),
          logIndex: log.logIndex,
        },
      ];
    } catch {
      return [];
    }
  });
}

async function realScenarioEvidence(
  runtime: ForkRuntime,
  fingerprint: Fingerprint,
  fixture: M1GoldenFixture,
  scenario: M1GoldenScenario,
  decoder: BatchDecoderOptions,
  runtimeHash: Hex,
  setupTransactionHashes: Hex[],
  pre: StateSnapshot,
): Promise<ScenarioEvidence> {
  let signerCallCount = 0;
  let userTransaction: Awaited<ReturnType<ForkRuntime['send']>> | undefined;
  let rawTokenFlows: TokenFlow[] = [];
  let stateAssertions: StateAssertion[] = [];
  let swapProof: ScenarioEvidence['swapProof'] = null;
  const decoded = decodeBatchCalldata(
    {
      chainId: 1,
      target: fixture.addresses[scenario.target] as Address,
      caller: owner.address,
      data: scenario.data as Hex,
    },
    decoder,
  );
  if (decoded.status !== 'COMPLETE') throw new Error(`${scenario.id} did not decode completely`);
  const quotePreflight =
    scenario.id === 'G05-bounded-swap'
      ? await readPinnedQuote(runtime, scenario.data as Hex)
      : undefined;
  if (quotePreflight) {
    const requiredMinimum = (BigInt(quotePreflight.quotedAmountOut) * 9_900n) / 10_000n;
    if (
      quotePreflight.quotedAmountOut !== scenario.quotedAmountOut ||
      BigInt(quotePreflight.authoredMinimum) !== requiredMinimum
    ) {
      throw new Error('G05 fixture does not encode the frozen quote and exact 100bps minimum');
    }
  }

  const executor: MetaMaskWalletExecutor = {
    async sendTransaction(request): Promise<MetaMaskExecutionReceipt> {
      signerCallCount += 1;
      userTransaction = await runtime.send(
        request.to,
        request.data,
        'USER',
        request.from,
        BigInt(request.valueWei),
      );
      rawTokenFlows = extractTokenFlows(fixture, userTransaction.receipt);
      const post = await snapshotState(runtime, fixture);
      switch (scenario.id) {
        case 'G01-bounded-transfer':
        case 'G02-transfer-at-limit': {
          const amount = scenario.id === 'G01-bounded-transfer' ? USDC_UNIT : 2n * USDC_UNIT;
          stateAssertions = [
            assertion(
              'recipient USDC delta',
              pre.recipientUsdc,
              post.recipientUsdc,
              pre.recipientUsdc + amount,
              post.recipientUsdc === pre.recipientUsdc + amount,
            ),
            assertion(
              'owner USDC delta',
              pre.ownerUsdc,
              post.ownerUsdc,
              pre.ownerUsdc - amount,
              post.ownerUsdc === pre.ownerUsdc - amount,
            ),
          ];
          break;
        }
        case 'G03-bounded-approval':
          stateAssertions = [
            assertion(
              'router allowance',
              pre.routerAllowance,
              post.routerAllowance,
              USDC_UNIT,
              post.routerAllowance === USDC_UNIT,
            ),
            assertion(
              'approval keeps owner balance',
              pre.ownerUsdc,
              post.ownerUsdc,
              pre.ownerUsdc,
              post.ownerUsdc === pre.ownerUsdc,
            ),
          ];
          break;
        case 'G04-revoke-approval':
          stateAssertions = [
            assertion(
              'router allowance revoked',
              pre.routerAllowance,
              post.routerAllowance,
              0,
              post.routerAllowance === 0n,
            ),
          ];
          break;
        case 'G05-bounded-swap': {
          const quote = quotePreflight;
          if (!quote) throw new Error('G05 quote preflight is missing');
          const pool = quote.pools[0];
          if (!pool) throw new Error('G05 quote has no route pool');
          const pinnedPool = fingerprintContract(fingerprint, 'poolUsdcWeth500');
          if (
            quote.quoter.address.toLowerCase() !== fixture.addresses.quoterV2.toLowerCase() ||
            quote.quoter.codehash.toLowerCase() !== fixture.codehashes.quoterV2.toLowerCase() ||
            pinnedPool.address.toLowerCase() !== fixture.addresses.poolUsdcWeth500.toLowerCase() ||
            pinnedPool.codehash.toLowerCase() !==
              fixture.codehashes.poolUsdcWeth500.toLowerCase() ||
            pool.address.toLowerCase() !== pinnedPool.address.toLowerCase() ||
            pool.codehash.toLowerCase() !== pinnedPool.codehash.toLowerCase()
          ) {
            throw new Error('G05 route is not the pinned USDC/WETH fee-500 pool');
          }
          const input = rawTokenFlows.find(
            (flow) =>
              flow.token.toLowerCase() === fixture.addresses.usdc.toLowerCase() &&
              flow.from.toLowerCase() === owner.address.toLowerCase() &&
              flow.to.toLowerCase() === pool.address.toLowerCase() &&
              flow.amount === USDC_UNIT.toString(),
          );
          const output = rawTokenFlows.find(
            (flow) =>
              flow.token.toLowerCase() === fixture.addresses.weth.toLowerCase() &&
              flow.from.toLowerCase() === pool.address.toLowerCase() &&
              flow.to.toLowerCase() === fixture.addresses.recipient.toLowerCase(),
          );
          if (!input || !output) throw new Error('G05 receipt lacks the pinned input/output route');
          const actualAmountOut = post.recipientWeth - pre.recipientWeth;
          const authoredMinimum = BigInt(quote.authoredMinimum);
          const expectedFlows = new Set([input.logIndex, output.logIndex]);
          const unexpectedAccountTokenFlowCount = rawTokenFlows.filter(
            (flow) =>
              !expectedFlows.has(flow.logIndex) &&
              [flow.from, flow.to].some(
                (address) =>
                  address.toLowerCase() === owner.address.toLowerCase() ||
                  address.toLowerCase() === fixture.addresses.recipient.toLowerCase(),
              ),
          ).length;
          stateAssertions = [
            assertion(
              'owner USDC spent',
              pre.ownerUsdc,
              post.ownerUsdc,
              pre.ownerUsdc - USDC_UNIT,
              post.ownerUsdc === pre.ownerUsdc - USDC_UNIT,
            ),
            assertion(
              'recipient WETH delta matches receipt',
              pre.recipientWeth,
              post.recipientWeth,
              output.amount,
              actualAmountOut === BigInt(output.amount),
            ),
            assertion(
              'actual output meets authored minimum',
              0,
              actualAmountOut,
              authoredMinimum,
              actualAmountOut >= authoredMinimum,
            ),
            assertion(
              'no unexpected account token flow',
              0,
              unexpectedAccountTokenFlowCount,
              0,
              unexpectedAccountTokenFlowCount === 0,
            ),
          ];
          swapProof = {
            quoter: quote.quoter.address,
            quoterCodehash: quote.quoter.codehash,
            pool: pool.address,
            poolCodehash: pool.codehash,
            sourceCalldataHash: quote.sourceCalldataHash,
            quotedAmountOut: quote.quotedAmountOut,
            authoredMinimum: quote.authoredMinimum,
            actualAmountOut: actualAmountOut.toString(),
            inputFlowLogIndex: input.logIndex,
            outputFlowLogIndex: output.logIndex,
            unexpectedAccountTokenFlowCount,
          };
          break;
        }
        default:
          throw new Error(`unexpected ALLOW scenario: ${scenario.id}`);
      }
      if (stateAssertions.some((entry) => !entry.passed)) {
        throw new Error(`${scenario.id} failed a real post-state assertion`);
      }
      return {
        status: 'SUCCESS',
        transactionHash: userTransaction.transactionHash,
        gasUsedWei: userTransaction.gasCostWei,
        // The normalized effects are admitted only after the raw receipt and post-state assertions
        // above prove the authorized economic route. Raw flows and the route proof remain in evidence.
        observedEffects: observed(decoded.effects),
        finalGoalChecks: [
          {
            goalIndex: 0,
            satisfied: true,
            evidence: stateAssertions.map((entry) => `${entry.name}:${entry.after}`).join(';'),
          },
        ],
      };
    },
  };
  const audit = await new IntentLockMetaMaskAdapter(executor).execute({
    contract: contractFor(fixture, scenario, pre),
    action: {
      chainId: 1,
      target: fixture.addresses[scenario.target] as Address,
      data: scenario.data as Hex,
    },
    decoder,
    evaluatedAt: '2026-08-29T00:00:00Z',
    simulationStatus: 'SUCCESS',
  });
  if (!userTransaction) throw new Error(`${scenario.id} produced no real user transaction`);
  if (audit.status !== 'EXECUTED_VERIFIED' || audit.postDecision?.kind !== 'ALLOW') {
    throw new Error(`${scenario.id} was not verified after its real receipt`);
  }
  return {
    scenarioId: scenario.id,
    class: scenario.class,
    expectedDecision: scenario.expectedDecision,
    observedDecision: audit.preDecision.kind,
    expectedCode: scenario.expectedCode ?? null,
    observedCode: audit.preDecision.kind === 'ALLOW' ? null : audit.preDecision.code,
    adapterStatus: audit.status,
    signerInvoked: audit.signerInvoked,
    signerCallCount,
    setupTransactionHashes,
    transaction: {
      hash: userTransaction.transactionHash,
      status: 'SUCCESS',
      blockNumber: Number(userTransaction.receipt.blockNumber),
      blockHash: userTransaction.receipt.blockHash,
      gasUsedWei: userTransaction.gasCostWei,
    },
    intentHash: audit.intentHash,
    auditLogId: audit.logId,
    reservationId: audit.reservationId ?? null,
    effectMismatchCount: audit.effectMismatches.length,
    rawTokenFlows,
    swapProof,
    stateAssertions,
    normalizationBasis: 'REAL_RECEIPT_AND_POST_STATE',
    runtimeCodehash: runtimeHash,
    fixtureMutation: null,
  };
}

async function blockedScenarioEvidence(
  runtime: ForkRuntime,
  fixture: M1GoldenFixture,
  scenario: M1GoldenScenario,
): Promise<ScenarioEvidence> {
  const usdc = fixture.addresses.usdc as Address;
  let mutation: ScenarioEvidence['fixtureMutation'] = null;
  setRunStage(scenarioStage(scenario, 'blocked-pre-state'));
  const pre = await snapshotState(runtime, fixture);
  setRunStage(scenarioStage(scenario, 'blocked-original-codehash'));
  const originalHash = await runtimeCodehash(runtime, usdc);
  if (scenario.codehashDrift) {
    setRunStage(scenarioStage(scenario, 'blocked-code-mutation'));
    await runtime.test.setCode({ address: usdc, bytecode: '0x00' });
    setRunStage(scenarioStage(scenario, 'blocked-mutated-codehash'));
    const mutatedHash = await runtimeCodehash(runtime, usdc);
    mutation = {
      kind: 'ANVIL_SET_CODE',
      target: usdc,
      originalCodehash: originalHash,
      mutatedCodehash: mutatedHash,
    };
  }
  setRunStage(scenarioStage(scenario, 'blocked-current-codehash'));
  const currentHash = await runtimeCodehash(runtime, usdc);
  const decoder = decoderFor(fixture, scenario, currentHash);
  let signerCallCount = 0;
  const trapExecutor: MetaMaskWalletExecutor = {
    sendTransaction(): Promise<MetaMaskExecutionReceipt> {
      signerCallCount += 1;
      return Promise.reject(new Error('blocked M1 Golden scenario reached the signer boundary'));
    },
  };
  setRunStage(scenarioStage(scenario, 'blocked-policy-evaluation'));
  const audit = await new IntentLockMetaMaskAdapter(trapExecutor).execute({
    contract: contractFor(fixture, scenario, pre),
    action: {
      chainId: 1,
      target: fixture.addresses[scenario.target] as Address,
      data: scenario.data as Hex,
    },
    decoder,
    evaluatedAt: '2026-08-29T00:00:00Z',
    simulationStatus: 'SUCCESS',
  });
  setRunStage(scenarioStage(scenario, 'blocked-post-nonce'));
  const postNonce = await runtime.client.getTransactionCount({ address: owner.address });
  const assertions = [
    assertion('signer boundary call count', 0, signerCallCount, 0, signerCallCount === 0),
    assertion(
      'account transaction nonce unchanged',
      pre.accountNonce,
      postNonce,
      pre.accountNonce,
      postNonce === pre.accountNonce,
    ),
  ];
  const observedCode = audit.preDecision.kind === 'ALLOW' ? null : audit.preDecision.code;
  if (
    audit.status !== 'BLOCKED' ||
    audit.signerInvoked ||
    signerCallCount !== 0 ||
    audit.preDecision.kind !== scenario.expectedDecision ||
    observedCode !== (scenario.expectedCode ?? null)
  ) {
    throw new Error(`${scenario.id} did not stop at the signer boundary as expected`);
  }
  if (scenario.codehashDrift && mutation === null) {
    throw new Error('G10 did not induce a real local bytecode drift');
  }
  return {
    scenarioId: scenario.id,
    class: scenario.class,
    expectedDecision: scenario.expectedDecision,
    observedDecision: audit.preDecision.kind,
    expectedCode: scenario.expectedCode ?? null,
    observedCode,
    adapterStatus: 'BLOCKED',
    signerInvoked: false,
    signerCallCount,
    setupTransactionHashes: [],
    transaction: null,
    intentHash: audit.intentHash,
    auditLogId: audit.logId,
    reservationId: null,
    effectMismatchCount: 0,
    rawTokenFlows: [],
    swapProof: null,
    stateAssertions: assertions,
    normalizationBasis: 'PINNED_FORK_SIGNER_BOUNDARY',
    runtimeCodehash: currentHash,
    fixtureMutation: mutation,
  };
}

async function runScenario(
  fork: AnvilFork,
  fingerprint: Fingerprint,
  fixture: M1GoldenFixture,
  scenario: M1GoldenScenario,
): Promise<ScenarioEvidence> {
  setRunStage(scenarioStage(scenario, 'snapshot'));
  const snapshot = await fork.snapshot();
  let result: ScenarioEvidence;
  let failedStage: string | undefined;
  try {
    resetExecutionSequence();
    const runtime = new ForkRuntime(fork, fingerprint);
    setRunStage(scenarioStage(scenario, 'prepare'));
    const setupTransactionHashes = await prepareScenario(runtime, fixture, scenario);
    if (scenario.expectedDecision !== 'ALLOW') {
      setRunStage(scenarioStage(scenario, 'blocked-evaluation'));
      result = await blockedScenarioEvidence(runtime, fixture, scenario);
    } else {
      setRunStage(scenarioStage(scenario, 'runtime-codehash'));
      const currentHash = await runtimeCodehash(runtime, fixture.addresses.usdc as Address);
      setRunStage(scenarioStage(scenario, 'pre-state'));
      const pre = await snapshotState(runtime, fixture);
      const decoder = decoderFor(fixture, scenario, currentHash);
      setRunStage(scenarioStage(scenario, 'allow-execution'));
      result = await realScenarioEvidence(
        runtime,
        fingerprint,
        fixture,
        scenario,
        decoder,
        currentHash,
        setupTransactionHashes,
        pre,
      );
    }
  } catch (error) {
    failedStage = activeRunStage;
    throw error;
  } finally {
    setRunStage(scenarioStage(scenario, 'revert'));
    await fork.revert(snapshot);
    if (failedStage !== undefined) setRunStage(failedStage);
  }
  setRunStage(scenarioStage(scenario, 'restore-healthcheck'));
  const restored = await fork.healthcheck();
  if (restored.digest.toLowerCase() !== fingerprint.digest.toLowerCase()) {
    throw new Error(`fork fingerprint did not restore after ${scenario.id}`);
  }
  return result;
}

async function main(): Promise<void> {
  setRunStage('source-check-start');
  const requireCleanSource = process.argv.includes('--require-clean-source');
  const sourceAtStart = readGitSourceState(ROOT);
  if (requireCleanSource) assertCleanSourceAtStart(sourceAtStart, 'M1 Golden evidence');
  setRunStage('arguments');
  const output = parseOutputArgument();
  if (existsSync(output)) throw new Error(`refusing to overwrite existing evidence: ${output}`);
  setRunStage('fixture-load');
  const fixtureRaw = readFileSync(FIXTURE_PATH, 'utf8');
  const fixture = M1GoldenFixtureSchema.parse(JSON.parse(fixtureRaw));
  if (fixture.addresses.account.toLowerCase() !== owner.address.toLowerCase()) {
    throw new Error('M1 Golden fixture account is not the public Anvil test owner');
  }
  setRunStage('fork-start');
  const baseConfig = loadForkConfig('experiments/configs/forks/ethereum-25773000.json');
  const fork = await AnvilFork.start({ ...baseConfig, port: baseConfig.port + 20 });
  try {
    setRunStage('fork-owner-funding');
    await fork.setBalance(owner.address, HUNDRED_ETH);
    setRunStage('fork-healthcheck');
    const fingerprint = await fork.healthcheck();
    const scenarios: ScenarioEvidence[] = [];
    for (const scenario of fixture.scenarios) {
      scenarios.push(await runScenario(fork, fingerprint, fixture, scenario));
    }
    setRunStage('source-check-end');
    const sourceAtEnd = readGitSourceState(ROOT);
    if (requireCleanSource)
      assertCleanSourceUnchanged(sourceAtStart, sourceAtEnd, 'M1 Golden evidence');
    const source = {
      commitSha: sourceAtEnd.commitSha,
      workingTreeDirty: sourceAtEnd.workingTreeDirty,
      runnerSha256: runnerSha256(),
      fixtureSha256: sha256(fixtureRaw),
      toolchain: {
        node: process.version,
        pnpm: toolVersion(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'),
        anvil: toolVersion('anvil'),
      },
    };
    setRunStage('evidence-build');
    const draft = M1GoldenEvidenceSchema.parse({
      schemaVersion: 'm1-golden-evidence-v1',
      generatedAt: new Date().toISOString(),
      source,
      fork: {
        chainId: 1,
        blockNumber: fingerprint.blockNumber,
        blockHash: fingerprint.blockHash,
        fingerprintDigest: fingerprint.digest,
        contracts: fingerprint.contracts,
      },
      summary: {
        scenarioCount: 10,
        allowCount: 5,
        blockedCount: 5,
        realTransactionCount: 5,
        signerInvocationCount: 5,
        allMatched: true,
        stableDecisionDigest: `0x${'00'.repeat(32)}`,
      },
      scenarios,
    });
    setRunStage('evidence-finalize');
    const evidence = M1GoldenEvidenceSchema.parse({
      ...draft,
      summary: {
        ...draft.summary,
        stableDecisionDigest: computeM1StableDecisionDigest(draft),
      },
    });
    setRunStage('evidence-validate');
    validateM1GoldenEvidence(evidence, fixture, {
      fixtureSha256: source.fixtureSha256,
    });
    setRunStage('evidence-write');
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, json(evidence), { flag: 'wx' });
    process.stdout.write(
      `M1 Golden complete: 5 real ALLOW receipts, 5 pre-sign blocks; digest ${evidence.summary.stableDecisionDigest}; evidence ${output}\n`,
    );
  } finally {
    await fork.stop();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `M1 Golden failed at ${activeRunStage}: ${sanitizeExecutionFailure(message)}\n`,
  );
  process.exitCode = 1;
});
