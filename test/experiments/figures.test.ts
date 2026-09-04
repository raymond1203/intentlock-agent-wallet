import { describe, expect, it } from 'vitest';

import type { EvaluationAnalysis, SystemAnalysis } from '../../src/experiments/analysis.js';
import {
  architectureSvg,
  errorTaxonomySvg,
  latencySvg,
  securityUtilitySvg,
} from '../../src/experiments/figures.js';

function fixture(): EvaluationAnalysis {
  const names: SystemAnalysis['system'][] = [
    'NONE',
    'GUARD_MODE',
    'LLM_VERIFIER',
    'PER_CALL_POLICY',
    'INTENTLOCK',
  ];
  const interval = {
    point: 0,
    lower95: 0,
    upper95: 0,
    replicates: 100,
    seed: 2026,
    groupCount: 80,
  };
  return {
    runId: 'figure-test',
    selectedRecords: 2000,
    strongestBaseline: null,
    intentLockUnsafeRateDifference: null,
    intentLockUnsafeRateDifference95: null,
    negativeResults: [],
    systems: names.map((system) => ({
      system,
      aggregate: {
        system,
        total: 400,
        unsafeExecutions: 0,
        unsafeExecutionRate: 0,
        benignTotal: 160,
        benignCompleted: 160,
        benignCompletionRate: 1,
        falseDenials: 0,
        falseDenyRate: 0,
        adversarialTotal: 240,
        preSignDetections: 240,
        preSignDetectionRate: 1,
        abstentions: 0,
        escalationRate: 0,
        confirmationRequests: 0,
        confirmationRequestRate: 0,
        incompleteOutcomes: 0,
        meanLatencyMs: 0,
        totalTokenCost: 0,
      },
      unsafeExecutionRate95: { ...interval },
      benignCompletionRate95: { ...interval, point: 1, lower95: 1, upper95: 1 },
      preSignDetectionRate95: { ...interval },
      unauthorizedViolationAmountAtomicByCase: {},
      authorizedAllowanceExposureAtomicByCase: {},
      detectionStages: { preSign: 240, postState: 0, none: 160 },
      detectionOrdinals: { planPreflight: 0, actionPreSign: 240, postState: 0, none: 160 },
      firstDetectionOrdinalByCase: {},
      errorsByMutation: {},
    })),
  };
}

describe('static research figures', () => {
  it('retains all five coincident systems in separate labeled rows without altering values', () => {
    const data = fixture();
    const before = structuredClone(data);
    const svg = securityUtilitySvg(data);
    expect(svg.match(/data-metric="unsafe authorization" data-value="0"/g)).toHaveLength(5);
    expect(svg.match(/data-metric="benign completion" data-value="1"/g)).toHaveLength(5);
    const pointRows = [...svg.matchAll(/<circle cx="210" cy="(\d+)"/g)].map((match) => match[1]);
    expect(new Set(pointRows).size).toBe(5);
    expect(svg.match(/100.0% \(160\/160\)/g)).toHaveLength(10);
    expect(svg).toContain('Denominator: all selected cases');
    expect(svg).toContain('Denominator: benign selected cases');
    expect(data).toEqual(before);
  });

  it('does not turn missing or zero-denominator benign completion into a zero mark', () => {
    const data = fixture();
    const first = data.systems[0];
    const second = data.systems[1];
    if (!first || !second) throw new Error('fixture missing');
    first.aggregate.benignCompletionRate = null;
    second.aggregate.benignTotal = 0;
    const svg = securityUtilitySvg(data);
    expect(svg.match(/data-metric="benign completion" data-available="false"/g)).toHaveLength(2);
    expect(svg.match(/data-metric="benign completion" data-value=/g)).toHaveLength(3);
    expect(svg).not.toContain('data-metric="benign completion" data-value="0"');
  });

  it('renders measured zero bars visibly and reserves space for complete system labels', () => {
    for (const svg of [latencySvg(fixture()), errorTaxonomySvg(fixture())]) {
      expect(svg.match(/data-zero="true"/g)).toHaveLength(5);
      expect(svg).toContain('x="28"');
      expect(svg).toContain('PER_CALL_POLICY</text>');
      expect(svg).not.toContain('x="72"');
      expect(svg).not.toContain('x="775"');
    }
  });

  it('preserves exact latency and error totals with bounded bar length', () => {
    const data = fixture();
    const first = data.systems[0];
    if (!first) throw new Error('fixture missing');
    first.aggregate.meanLatencyMs = 12345.67;
    first.errorsByMutation = { 'amount-inflation': 10, 'deadline-expiry': 4, 'route-change': 2 };
    const latency = latencySvg(data);
    const errors = errorTaxonomySvg(data);
    expect(latency).toContain('12345.67 ms</text>');
    expect(latency).toContain('width="550"');
    expect(errors).toContain('16 / 400</text>');
    expect(errors).toContain('amount-inflation:10, deadline-expiry:4');
    expect(errors).toContain('route-change:2');
    expect(errors).toContain('width="550"');
  });

  it('escapes metadata and category labels as XML', () => {
    const data = fixture();
    data.runId = 'test<&"';
    const first = data.systems[0];
    if (!first) throw new Error('fixture missing');
    first.errorsByMutation = { '<script>': 1 };
    expect(errorTaxonomySvg(data)).toContain('&lt;script&gt;:1');
    expect(errorTaxonomySvg(data)).not.toContain('<script>');
    for (const svg of [architectureSvg(data.runId), securityUtilitySvg(data), latencySvg(data)]) {
      expect(svg).toContain('test&lt;&amp;&quot;');
    }
  });

  it('bounds long visible category labels without losing the full category or count', () => {
    const data = fixture();
    const first = data.systems[0];
    if (!first) throw new Error('fixture missing');
    const label = 'synthetic-long-mutation-label-'.repeat(8);
    first.errorsByMutation = { [label]: 31 };
    const svg = errorTaxonomySvg(data);
    expect(svg).toContain(`<title>${label}:31</title>`);
    expect(svg).toContain(`${label.slice(0, 42)}…:31</text>`);
    expect(svg).not.toContain(`${label}:31</text>`);
    expect(svg).toContain('31 / 400</text>');
  });

  it('states actual architecture boundaries rather than stronger unimplemented guarantees', () => {
    const svg = architectureSvg('test');
    expect(svg).toContain('authored contract-conditioned offline replay');
    expect(svg).toContain('confirmation is caller-supplied');
    expect(svg).toContain('not verified taint');
    expect(svg).toContain('Single-process reservation gate');
    expect(svg).toContain('VIOLATED budget remains counted');
    expect(svg).toContain('no global follow-up signing freeze is implemented');
    expect(svg).not.toContain('linearizable ledger');
    expect(svg).not.toContain('taint-aware extraction');
    expect(svg).not.toContain('mismatch freezes follow-up signing');
  });
});
