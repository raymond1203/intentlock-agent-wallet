import type { BenchmarkScenario } from '../../src/benchmark/scenario.js';
import { requiredReceiptCount } from './receipt-requirements.js';

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
