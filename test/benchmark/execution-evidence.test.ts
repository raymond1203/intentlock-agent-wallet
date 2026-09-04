import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { BenchmarkScenarioSchema } from '../../src/benchmark/scenario.js';
import {
  classifyExecutionEvidence,
  executionProblems,
  type ExecutionEvidenceCandidate,
} from '../../scripts/m2-execution/evidence-validation.js';
import { requiredReceiptCount } from '../../scripts/m2-execution/receipt-requirements.js';

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
});
