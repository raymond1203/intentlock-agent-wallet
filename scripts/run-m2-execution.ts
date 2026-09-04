import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { decodeFunctionData, keccak256, type Address, type Hex } from 'viem';
import { z } from 'zod';
import { BenchmarkScenarioSchema, type BenchmarkScenario } from '../src/benchmark/scenario.js';
import { BENCHMARK_DATASET_VERSION } from '../src/benchmark/version.js';
import { decodeErc20Log } from '../src/effects/erc20-decoder.js';
import { SWAP_ROUTER_02_ABI } from '../src/effects/swap-decoder.js';
import {
  evaluatePostState,
  observationKey,
  type StateObservation,
} from '../src/oracle/post-state-oracle.js';
import { required } from '../src/domain/required.js';
import { AnvilFork, loadForkConfig, sanitizeExecutionFailure } from './anvil-harness.js';
import { fixtureAddress } from './extended-benchmark.js';
import { ForkRuntime, owner, json, resetExecutionSequence } from './m2-execution/runtime.js';
import { PERMIT_READ, resolvePermit } from './m2-execution/permit.js';
import { prepareRelay, relaySourceReceipt } from './m2-execution/bridge.js';
import { assertPinnedQuote, readPinnedQuote } from './m2-execution/quotes.js';
import { classifyReceiptEffects } from '../src/oracle/receipt-accounting.js';
import { minimumPrefixFunding } from '../src/benchmark/execution-funding.js';
import { executionCollectorSha256 } from './m2-execution/provenance.js';
import { lendingObservationToken } from './m2-execution/lending.js';
import {
  executionLeaves,
  requiredReceiptCount as requiredReceiptCountFor,
} from './m2-execution/receipt-requirements.js';
import {
  assertCleanSourceAtStart,
  assertCleanSourceUnchanged,
  readGitSourceState,
} from './source-integrity.js';

const numericAddress = z.custom<Address>(
  (v) => typeof v === 'string' && /^0x[\da-fA-F]{40}$/.test(v),
);
const reserveManifest = z
  .object({
    lendingReserves: z.object({
      '1': z.record(
        z.string(),
        z.object({ aToken: numericAddress, variableDebtToken: numericAddress }),
      ),
      '8453': z.record(
        z.string(),
        z.object({ aToken: numericAddress, variableDebtToken: numericAddress }),
      ),
    }),
  })
  .parse(JSON.parse(await readFile('benchmark/fixtures/manifest.json', 'utf8')));
const filter = process.argv
  .find((v) => v.startsWith('--ids='))
  ?.slice(6)
  .split(',');
const outDir =
  process.argv.find((v) => v.startsWith('--out='))?.slice(6) ?? 'experiments/results/m2-execution';
const portOffset = z.coerce
  .number()
  .int()
  .min(0)
  .max(50_000)
  .parse(process.argv.find((v) => v.startsWith('--port-offset='))?.slice(14) ?? 50);
const scenarios = (
  await Promise.all(
    ['transfer', 'swap', 'bridge', 'lending', 'batch'].map(async (dir) => {
      const files = (await readdir(`benchmark/scenarios/base/${dir}`))
        .filter((f) => f.endsWith('.json'))
        .sort();
      return Promise.all(
        files.map(async (file) =>
          BenchmarkScenarioSchema.parse(
            JSON.parse(await readFile(`benchmark/scenarios/base/${dir}/${file}`, 'utf8')),
          ),
        ),
      );
    }),
  )
)
  .flat()
  .filter((s) => !filter || filter.some((prefix) => s.id.startsWith(prefix)));
const runtimes = new Map<number, ForkRuntime>();
const requireCleanSource = process.argv.includes('--require-clean-source');
const sourceAtStart = readGitSourceState();
if (requireCleanSource) assertCleanSourceAtStart(sourceAtStart, 'M2 execution evidence');
const sourceCommit = sourceAtStart.commitSha;
const workingTreeDirty = sourceAtStart.workingTreeDirty;
const collectorSha256 = await executionCollectorSha256();
const sensitiveRpcValues = ['FORK_RPC_URL_1', 'FORK_RPC_URL_8453'].flatMap((name) => {
  const value = process.env[name];
  return value ? [value, ...value.split(',').map((entry) => entry.trim())] : [];
});
interface SummaryResult {
  scenarioId: string;
  transactionCount: number;
  executionComplete: boolean;
  oracleStatus: string;
  violations: unknown[];
  missing: string[];
  error: string | null;
}
const results: SummaryResult[] = [];

function executionFailure(cause: unknown): string {
  const message =
    cause instanceof Error
      ? 'shortMessage' in cause && typeof cause.shortMessage === 'string'
        ? cause.shortMessage
        : cause.message
      : 'unknown execution failure';
  return sanitizeExecutionFailure(message, sensitiveRpcValues);
}

function deltaObservation(
  delta: BenchmarkScenario['oracle']['expectedDeltas'][number],
): StateObservation {
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

function stateQueries(s: BenchmarkScenario): StateObservation[] {
  const rows = new Map<string, StateObservation>();
  const add = (r: StateObservation) => rows.set(observationKey(r), r);
  for (const row of [...s.oracle.preState, ...s.oracle.postState]) add(row);
  for (const delta of s.oracle.expectedDeltas) add(deltaObservation(delta));
  for (const e of s.trace.expectedEffects)
    if (e.kind === 'APPROVAL' && e.signatureDeadline !== undefined && e.expiration === undefined)
      add({
        chainId: e.chainId,
        subject: s.intent.account,
        field: 'ALLOWANCE',
        asset: e.asset,
        counterparty: fixtureAddress(e.chainId, 'permit2'),
        value: '0',
        source: 'POST_STATE',
      });
  for (const budget of s.intent.safety.assetBudgets)
    add({
      chainId: budget.chainId,
      subject: s.intent.account,
      field: 'BALANCE',
      asset: budget.asset,
      value: '0',
      source: 'POST_STATE',
    });
  return [...rows.values()];
}
async function observe(
  s: BenchmarkScenario,
  rows: StateObservation[],
  source: 'FIXED_FORK' | 'POST_STATE',
): Promise<StateObservation[]> {
  return Promise.all(
    rows.map(async (row) => {
      const runtime = required(runtimes.get(row.chainId));
      const asset = row.asset as Address;
      const account = row.subject as Address;
      let value: bigint;
      if (row.field === 'BALANCE')
        value =
          row.asset === 'native'
            ? await runtime.client.getBalance({ address: account })
            : await runtime.balance(asset, account);
      else if (row.field === 'ALLOWANCE') {
        const spender = required(row.counterparty) as Address;
        const effect = s.trace.expectedEffects.find(
          (e) =>
            e.kind === 'APPROVAL' &&
            e.chainId === row.chainId &&
            e.asset.toLowerCase() === asset.toLowerCase() &&
            e.spender.toLowerCase() === spender.toLowerCase(),
        );
        if (effect?.kind === 'APPROVAL' && effect.expiration !== undefined) {
          const allowance = await runtime.client.readContract({
            address: fixtureAddress(row.chainId, 'permit2'),
            abi: PERMIT_READ,
            functionName: 'allowance',
            args: [account, asset, spender],
          });
          value = allowance[0];
        } else if (effect?.kind === 'APPROVAL' && effect.signatureDeadline !== undefined)
          value = 0n; // one-use signature is not stored ERC20 allowance
        else value = await runtime.allowance(asset, account, spender);
      } else if (row.field === 'DEBT' || row.field === 'POSITION') {
        const token = lendingObservationToken(
          reserveManifest,
          row.chainId,
          required(row.counterparty),
          asset,
          row.field,
        );
        value = await runtime.balance(token, account);
      } else throw new Error(`unsupported state observation ${row.field}`);
      return { ...row, value: value.toString(), source };
    }),
  );
}
async function run(s: BenchmarkScenario) {
  resetExecutionSequence();
  const snapshotIds = new Map<number, Hex>();
  const resolvedActions = structuredClone(s.trace.actions);
  const requiredReceiptCount = requiredReceiptCountFor(s);
  const setupNotes: string[] = [];
  const fixtureCorrections: {
    kind: 'ACCOUNT_PREFIX_FUNDING';
    chainId: number;
    asset: string;
    authored: string;
    required: string;
  }[] = [];
  const quotes: Awaited<ReturnType<typeof readPinnedQuote>>[] = [];
  const queries = stateQueries(s);
  const prefixFunding = minimumPrefixFunding(s.intent.account, s.trace.expectedEffects);
  let pre: StateObservation[] = [];
  let post: StateObservation[] = [];
  let error: string | null = null;
  try {
    for (const scope of s.intent.safety.chainScopes) {
      const rt = required(runtimes.get(scope.chainId));
      snapshotIds.set(scope.chainId, await rt.fork.snapshot());
      rt.transactions.length = 0;
      const originalCode = (await rt.client.getCode({ address: owner.address })) ?? '0x';
      await rt.test.setCode({ address: owner.address, bytecode: '0x' });
      setupNotes.push(
        `isolated test EOA ${String(scope.chainId)}:original-codehash=${keccak256(originalCode)}`,
      );
      await rt.fork.setBalance(owner.address, 100n * 10n ** 18n);
      // Fund only the benchmark account, never protocol reserves or recipients.
      for (const asset of new Set(
        s.intent.safety.assetBudgets.filter((b) => b.chainId === scope.chainId).map((b) => b.asset),
      )) {
        if (asset === 'native') continue;
        const expected = s.oracle.preState.find(
          (r) =>
            r.chainId === scope.chainId &&
            r.field === 'BALANCE' &&
            r.subject.toLowerCase() === owner.address.toLowerCase() &&
            r.asset?.toLowerCase() === asset.toLowerCase(),
        );
        const authored = BigInt(expected?.value ?? '0');
        const prefix = prefixFunding.get(`${String(scope.chainId)}:${asset.toLowerCase()}`) ?? 0n;
        const needed = authored > prefix ? authored : prefix;
        if (needed > authored) {
          fixtureCorrections.push({
            kind: 'ACCOUNT_PREFIX_FUNDING',
            chainId: scope.chainId,
            asset,
            authored: authored.toString(),
            required: prefix.toString(),
          });
          setupNotes.push(
            `authored starting balance is below required execution prefix: ${String(scope.chainId)}:${asset}; authored=${authored.toString()}; required=${prefix.toString()}`,
          );
        }
        await rt.fork.dealErc20(asset, owner.address, needed);
        setupNotes.push(`account funding ${String(scope.chainId)}:${asset}:${needed.toString()}`);
      }
      if (
        s.trace.actions.some(
          (a) =>
            a.chainId === scope.chainId && a.target.toLowerCase() === owner.address.toLowerCase(),
        )
      ) {
        const artifact = z
          .object({ deployedBytecode: z.object({ object: z.string() }) })
          .parse(
            JSON.parse(
              await readFile('contracts/out/M2FixtureAccount.sol/M2FixtureAccount.json', 'utf8'),
            ),
          );
        const bytecode = artifact.deployedBytecode.object as Hex;
        await rt.test.setCode({ address: owner.address, bytecode });
        setupNotes.push(
          `local-only batch account runtime ${String(scope.chainId)}:${keccak256(bytecode)}`,
        );
      }
    }
    for (const action of resolvedActions) {
      const rt = required(runtimes.get(action.chainId));
      if (action.target.toLowerCase() === fixtureAddress(action.chainId, 'permit2').toLowerCase()) {
        action.calldata = await resolvePermit(rt, action.calldata as Hex);
        setupNotes.push(
          'Resolved test-owner EIP712 signature; one-use spender is actual transaction caller, not impersonated router',
        );
      }
    }
    // Single-swap traces explicitly assume a pre-existing, bounded router approval.
    if (s.workflow === 'SWAP_SINGLE') {
      const amount = s.trace.expectedEffects
        .filter((e) => e.kind === 'SWAP')
        .reduce((sum, e) => sum + BigInt(e.amountIn), 0n);
      await required(runtimes.get(1)).approve(
        fixtureAddress(1, 'usdc'),
        fixtureAddress(1, 'swapRouter02'),
        amount,
      );
      setupNotes.push(`pre-existing single-swap approval ${amount.toString()}`);
    }
    pre = await observe(s, queries, 'FIXED_FORK');
    if (s.workflow === 'BRIDGE_SWAP') await prepareRelay(required(runtimes.get(8453)), setupNotes);
    // Verify every authored quote against the pristine pinned pool state before any user action
    // can move the pool. Sequential swaps intentionally share this planning-time reference point.
    for (const action of resolvedActions) {
      const rt = required(runtimes.get(action.chainId));
      for (const leaf of executionLeaves(
        s.intent.account,
        action.chainId,
        action.target as Address,
        action.calldata as Hex,
      )) {
        if (
          leaf.target.toLowerCase() !== fixtureAddress(leaf.chainId, 'swapRouter02').toLowerCase()
        )
          continue;
        decodeFunctionData({ abi: SWAP_ROUTER_02_ABI, data: leaf.data });
        const observed = await readPinnedQuote(rt, leaf.data);
        assertPinnedQuote(observed, s.fixture?.quoteReferences ?? []);
        quotes.push(observed);
      }
    }
    for (const action of resolvedActions) {
      const rt = required(runtimes.get(action.chainId));
      const transaction = await rt.send(
        action.target as Address,
        action.calldata as Hex,
        'USER',
        owner.address,
        BigInt(action.valueWei),
      );
      if (s.workflow === 'BRIDGE_SWAP' && action.chainId === 1)
        await relaySourceReceipt(rt, required(runtimes.get(8453)), transaction, setupNotes);
    }
    post = await observe(s, queries, 'POST_STATE');
  } catch (cause) {
    error = executionFailure(cause);
    // Retain partial state when the chain is reachable, without claiming completion.
    try {
      post = await observe(s, queries, 'POST_STATE');
    } catch {
      /* original failure retained */
    }
  }
  const transactions = [...snapshotIds.keys()]
    .flatMap((chain) => required(runtimes.get(chain)).transactions)
    .sort((a, b) => a.sequence - b.sequence);
  const user = transactions.filter((r) => r.role !== 'SETUP');
  const receiptTokenEvents = user.flatMap((tx) =>
    tx.receipt.logs.flatMap((log) =>
      decodeErc20Log({
        chainId: tx.chainId,
        token: log.address,
        topics: log.topics,
        data: log.data,
        logIndex: log.logIndex,
      }).effects.filter((e) => e.kind !== 'UNKNOWN'),
    ),
  );
  const { economicFlows: flows, positionTokenEvents } = classifyReceiptEffects(
    receiptTokenEvents,
    Object.entries(reserveManifest.lendingReserves).flatMap(([chain, entries]) =>
      Object.values(entries).map((r) => ({ chainId: Number(chain), ...r })),
    ),
  );
  const oracle = evaluatePostState({
    contract: s.intent,
    preState: pre,
    postState: post,
    evidenceLevel: 'EXECUTED_FORK',
    executionComplete: error === null,
    observedEffects: flows,
    receipts: user,
    requiredReceiptCount,
  });
  const deltaReferenceKeys = new Set(
    s.oracle.expectedDeltas.map((delta) => observationKey(deltaObservation(delta))),
  );
  const absoluteReferenceRows = s.oracle.postState.filter(
    (row) => !deltaReferenceKeys.has(observationKey(row)),
  );
  const reconciliation = post.length
    ? evaluatePostState({
        contract: s.intent,
        preState: pre,
        postState: post,
        expectedPostState: absoluteReferenceRows,
        expectedDeltas: s.oracle.expectedDeltas,
        evidenceLevel: 'EXECUTED_FORK',
        executionComplete: error === null,
        observedEffects: flows,
        receipts: user,
        requiredReceiptCount,
      })
    : null;
  const executionComplete =
    error === null &&
    user.length === requiredReceiptCount &&
    user.every((transaction) => transaction.status === 'success') &&
    oracle.missing.length === 0 &&
    oracle.status !== 'INSUFFICIENT_EVIDENCE';
  const result = {
    datasetVersion: BENCHMARK_DATASET_VERSION,
    scenarioId: s.id,
    sourceCommit,
    workingTreeDirty,
    collectorSha256,
    sourceScenarioSha256: createHash('sha256').update(JSON.stringify(s)).digest('hex'),
    fixture: s.fixture,
    verifiedForks: [...snapshotIds.keys()].map(
      (chain) => required(runtimes.get(chain)).fingerprint,
    ),
    setupNotes,
    fixtureCorrections,
    quotes,
    resolvedActions,
    requiredReceiptCount,
    transactions,
    pre,
    post,
    observedEffects: flows,
    positionTokenEvents,
    oracle,
    referenceReconciliation: reconciliation,
    error,
  };
  await writeFile(`${outDir}/${s.id.toLowerCase()}.json`, json(result));
  results.push({
    scenarioId: s.id,
    transactionCount: user.length,
    executionComplete,
    oracleStatus: oracle.status,
    violations: oracle.violations,
    missing: oracle.missing,
    error,
  });
  console.log(`${s.id}: ${oracle.status}${error ? ` — ${error}` : ''}`);
}

async function recordSetupFailure(s: BenchmarkScenario, cause: unknown): Promise<void> {
  const error = executionFailure(cause);
  const requiredReceiptCount = requiredReceiptCountFor(s);
  const transactions = [...runtimes.values()]
    .flatMap((runtime) => runtime.transactions)
    .sort((a, b) => a.sequence - b.sequence);
  const user = transactions.filter((transaction) => transaction.role !== 'SETUP');
  const oracle = evaluatePostState({
    contract: s.intent,
    preState: [],
    postState: [],
    evidenceLevel: 'EXECUTED_FORK',
    executionComplete: false,
    observedEffects: [],
    receipts: user,
    requiredReceiptCount,
  });
  const result = {
    datasetVersion: BENCHMARK_DATASET_VERSION,
    scenarioId: s.id,
    sourceCommit,
    workingTreeDirty,
    collectorSha256,
    sourceScenarioSha256: createHash('sha256').update(JSON.stringify(s)).digest('hex'),
    fixture: s.fixture,
    verifiedForks: [...runtimes.values()].map((runtime) => runtime.fingerprint),
    setupNotes: ['fork setup failed before scenario execution'],
    fixtureCorrections: [],
    quotes: [],
    resolvedActions: s.trace.actions,
    requiredReceiptCount,
    transactions,
    pre: [],
    post: [],
    observedEffects: [],
    positionTokenEvents: [],
    oracle,
    referenceReconciliation: null,
    error,
  };
  await writeFile(`${outDir}/${s.id.toLowerCase()}.json`, json(result));
  results.push({
    scenarioId: s.id,
    transactionCount: user.length,
    executionComplete: false,
    oracleStatus: oracle.status,
    violations: oracle.violations,
    missing: oracle.missing,
    error,
  });
  console.log(`${s.id}: ${oracle.status} — ${error}`);
}

const existingOutput = await readdir(outDir).catch((cause: unknown) => {
  if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return [];
  throw cause;
});
if (existingOutput.length)
  throw new Error(`refusing to overwrite non-empty M2 output directory: ${outDir}`);
await mkdir(outDir, { recursive: true });
try {
  for (const s of scenarios) {
    let setupComplete = false;
    try {
      for (const scope of s.intent.safety.chainScopes) {
        const name =
          scope.chainId === 1
            ? 'ethereum-25773000'
            : scope.chainId === 8453
              ? 'base-50080000'
              : null;
        if (!name) throw new Error('unsupported fixture chain');
        const config = loadForkConfig(`experiments/configs/forks/${name}.json`);
        const fork = await AnvilFork.start({ ...config, port: config.port + portOffset });
        runtimes.set(scope.chainId, new ForkRuntime(fork, await fork.healthcheck()));
      }
      setupComplete = true;
      await run(s);
    } catch (cause) {
      if (setupComplete) throw cause;
      await recordSetupFailure(s, cause);
    } finally {
      // A fresh process per scenario isolates account/storage changes and tx-pool
      // caches as well as EVM state. A timed-out case cannot contaminate the next.
      await Promise.all([...runtimes.values()].map((r) => r.fork.stop()));
      runtimes.clear();
    }
  }
} finally {
  await writeFile(
    `${outDir}/summary.json`,
    json({
      datasetVersion: BENCHMARK_DATASET_VERSION,
      sourceCommit,
      workingTreeDirty,
      count: results.length,
      results,
    }),
  );
  await Promise.all([...runtimes.values()].map((r) => r.fork.stop()));
}
if (requireCleanSource)
  assertCleanSourceUnchanged(sourceAtStart, readGitSourceState(), 'M2 execution evidence');
if (
  process.argv.includes('--require-all-executed') &&
  (results.length !== scenarios.length || results.some((result) => !result.executionComplete))
)
  process.exitCode = 1;
