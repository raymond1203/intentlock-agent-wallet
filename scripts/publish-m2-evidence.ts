import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { format, resolveConfig } from 'prettier';
import { BenchmarkScenarioSchema, StateObservationSchema } from '../src/benchmark/scenario.js';
import { executionProblems as validateExecution } from './m2-execution/evidence-validation.js';

const dirs = process.argv
  .find((v) => v.startsWith('--runs='))
  ?.slice(7)
  .split(',');
if (!dirs?.length)
  throw new Error('--runs=path[,path] is required; list attempts in chronological order');
const out =
  process.argv.find((v) => v.startsWith('--out='))?.slice(6) ??
  'benchmark/evidence/m2-execution.json';
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const current = new Map<string, string>();
const currentScenarios = new Map<string, z.infer<typeof BenchmarkScenarioSchema>>();
for (const dir of ['transfer', 'swap', 'bridge', 'lending', 'batch'])
  for (const file of (await readdir(`benchmark/scenarios/base/${dir}`)).filter((f) =>
    f.endsWith('.json'),
  )) {
    const s = BenchmarkScenarioSchema.parse(
      JSON.parse(await readFile(`benchmark/scenarios/base/${dir}/${file}`, 'utf8')),
    );
    current.set(s.id, sha256(JSON.stringify(s)));
    currentScenarios.set(s.id, s);
  }
const Oracle = z.object({
  status: z.enum(['PASS', 'VIOLATION', 'INSUFFICIENT_EVIDENCE', 'DISAGREEMENT']),
  violations: z.array(z.object({ code: z.string(), key: z.string(), amount: z.string() })),
  missing: z.array(z.string()),
  disagreements: z.array(
    z.object({ key: z.string(), expected: z.string(), actual: z.string().nullable() }),
  ),
});
const Raw = z.object({
  scenarioId: z.string(),
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  workingTreeDirty: z.boolean(),
  collectorSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  sourceScenarioSha256: z.string(),
  verifiedForks: z.array(
    z.object({
      chainId: z.number(),
      blockNumber: z.number(),
      blockHash: z.string(),
      digest: z.string(),
      contracts: z.array(z.object({ key: z.string(), address: z.string(), codehash: z.string() })),
    }),
  ),
  setupNotes: z.array(z.string()),
  fixtureCorrections: z
    .array(
      z.object({
        kind: z.literal('ACCOUNT_PREFIX_FUNDING'),
        chainId: z.number().int(),
        asset: z.string(),
        authored: z.string().regex(/^\d+$/),
        required: z.string().regex(/^\d+$/),
      }),
    )
    .optional(),
  requiredReceiptCount: z.number().int().nonnegative(),
  transactions: z.array(
    z.object({
      sequence: z.number().int().optional(),
      role: z.enum(['SETUP', 'USER', 'RELAY']),
      chainId: z.number(),
      from: z.string(),
      to: z.string(),
      transactionHash: z.string(),
      status: z.enum(['success', 'reverted']),
      gasCostWei: z.string(),
      receipt: z.object({ blockNumber: z.string(), blockHash: z.string(), gasUsed: z.string() }),
    }),
  ),
  pre: z.array(StateObservationSchema),
  post: z.array(StateObservationSchema),
  quotes: z
    .array(
      z.object({
        chainId: z.number(),
        blockNumber: z.string(),
        blockHash: z.string(),
        amountIn: z.string(),
        authoredMinimum: z.string(),
        quotedAmountOut: z.string(),
        authoredSlippageBps: z.string().nullable(),
        sourceCalldataHash: z.string(),
        quoter: z.object({ address: z.string(), codehash: z.string() }),
        pools: z.array(
          z.object({
            address: z.string(),
            codehash: z.string(),
            tokenA: z.string(),
            tokenB: z.string(),
            fee: z.number(),
          }),
        ),
      }),
    )
    .optional(),
  oracle: Oracle,
  referenceReconciliation: Oracle.nullable(),
  error: z.string().nullable(),
});
type Published = ReturnType<typeof Raw.parse> & { run: string; rawFileSha256: string };
type PublicFailureKind =
  | 'UPSTREAM_RATE_LIMIT'
  | 'UPSTREAM_TIMEOUT'
  | 'ARCHIVE_STATE_UNAVAILABLE'
  | 'TRANSACTION_REVERTED'
  | 'OTHER';

function publicFailure(error: string | null): { kind: PublicFailureKind; sha256: string } | null {
  if (error === null) return null;
  const kind: PublicFailureKind = /\b429\b|rate.?limit|compute units/i.test(error)
    ? 'UPSTREAM_RATE_LIMIT'
    : /timed? ?out|timeout/i.test(error)
      ? 'UPSTREAM_TIMEOUT'
      : /archive|pruned|historical state/i.test(error)
        ? 'ARCHIVE_STATE_UNAVAILABLE'
        : /revert/i.test(error)
          ? 'TRANSACTION_REVERTED'
          : 'OTHER';
  return { kind, sha256: sha256(error) };
}

const attempts: Published[] = [];
for (const dir of dirs) {
  for (const file of (await readdir(dir)).filter((f) => /^[a-z]{2}-\d\d\.json$/.test(f)).sort()) {
    const bytes = await readFile(`${dir}/${file}`, 'utf8');
    const raw = Raw.parse(JSON.parse(bytes));
    if (raw.sourceScenarioSha256 !== current.get(raw.scenarioId))
      throw new Error(`stale scenario evidence: ${raw.scenarioId}`);
    attempts.push({
      ...raw,
      run: dir.replaceAll('\\', '/').split('/').at(-1) ?? dir,
      rawFileSha256: sha256(bytes),
    });
  }
}
const latest = new Map(attempts.map((a) => [a.scenarioId, a]));
const selected = [...latest.values()].sort((a, b) => a.scenarioId.localeCompare(b.scenarioId));
const missing = [...current.keys()].filter((id) => !latest.has(id));

type FixtureCorrection = NonNullable<Published['fixtureCorrections']>[number];
function corrections(a: Published): FixtureCorrection[] {
  if (a.fixtureCorrections) return a.fixtureCorrections;
  return a.setupNotes.flatMap((note) => {
    const match =
      /^authored starting balance is below required execution prefix: (\d+):([^;]+); authored=(\d+); required=(\d+)$/.exec(
        note,
      );
    return match
      ? [
          {
            kind: 'ACCOUNT_PREFIX_FUNDING' as const,
            chainId: Number(match[1]),
            asset: match[2] ?? '',
            authored: match[3] ?? '',
            required: match[4] ?? '',
          },
        ]
      : [];
  });
}

function executionProblems(a: Published): string[] {
  const scenario = currentScenarios.get(a.scenarioId);
  return scenario ? validateExecution(a, scenario) : ['scenario:unknown'];
}

function compactAttempt(a: Published) {
  const fixtureCorrections = corrections(a);
  return {
    scenarioId: a.scenarioId,
    run: a.run,
    rawFileSha256: a.rawFileSha256,
    sourceCommit: a.sourceCommit,
    workingTreeDirty: a.workingTreeDirty,
    collectorSha256: a.collectorSha256 ?? null,
    sourceScenarioSha256: a.sourceScenarioSha256,
    verifiedForks: a.verifiedForks,
    setupNotes: a.setupNotes,
    fixtureCorrections,
    fixtureCorrected: fixtureCorrections.length > 0,
    requiredReceiptCount: a.requiredReceiptCount,
    receipts: a.transactions.map((tx) => ({
      sequence: tx.sequence ?? null,
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
    pre: a.pre,
    post: a.post,
    quotes: a.quotes ?? [],
    oracle: a.oracle,
    referenceReconciliation: a.referenceReconciliation,
    executionComplete: executionProblems(a).length === 0,
    incompletenessReasons: executionProblems(a),
    failure: publicFailure(a.error),
  };
}
const completed = selected.filter((attempt) => executionProblems(attempt).length === 0);
const strictAuthoredFixture = completed.filter((attempt) => corrections(attempt).length === 0);
const evidence = {
  datasetVersion: '0.2.0',
  purpose: 'Diagnostic evidence, not a frozen performance result',
  selection: 'Last listed attempt per scenario; all earlier attempts retained, including failures',
  baseCount: current.size,
  attemptedCount: latest.size,
  missing,
  completedExecutionCount: completed.length,
  strictAuthoredFixtureExecutionCount: strictAuthoredFixture.length,
  finalGoalPassCount: completed.filter((a) => a.oracle.status === 'PASS').length,
  strictAuthoredFixtureFinalGoalPassCount: strictAuthoredFixture.filter(
    (a) => a.oracle.status === 'PASS',
  ).length,
  syntheticReferenceDisagreementCount: selected.filter(
    (a) => a.referenceReconciliation?.status === 'DISAGREEMENT',
  ).length,
  humanReview: 'PENDING',
  m2Complete: false,
  latest: selected.map((a) => ({
    scenarioId: a.scenarioId,
    run: a.run,
    rawFileSha256: a.rawFileSha256,
    executionComplete: executionProblems(a).length === 0,
    fixtureCorrected: corrections(a).length > 0,
    oracleStatus: a.oracle.status,
  })),
  attempts: attempts.map(compactAttempt),
};
await mkdir(dirname(out), { recursive: true });
await writeFile(
  out,
  await format(JSON.stringify(evidence), {
    ...(await resolveConfig('package.json')),
    parser: 'json',
  }),
);
console.log(
  JSON.stringify(
    {
      attempted: evidence.attemptedCount,
      executed: evidence.completedExecutionCount,
      finalGoalPass: evidence.finalGoalPassCount,
      referenceDisagreements: evidence.syntheticReferenceDisagreementCount,
      missing,
    },
    null,
    2,
  ),
);
if (
  process.argv.includes('--require-all-executed') &&
  (missing.length || evidence.completedExecutionCount !== current.size)
)
  process.exitCode = 1;
