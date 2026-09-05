import { describe, expect, it } from 'vitest';

import {
  assemblePaperSource,
  PAPER_ASSEMBLY_TOKENS,
  type PaperAnalysisBundle,
  validatePaperAnalysisBundle,
} from '../../src/submission/paper-assembly.js';

function bundle(): PaperAnalysisBundle {
  return {
    primaryMarkdown: [
      '| System | Rate |',
      '| --- | ---: |',
      '| INTENTLOCK | 1.00% |',
      '',
      'Evidence mode: offline counterfactual replay. This table is not a fixed-fork transaction UER measurement.',
    ].join('\n'),
    primaryCsv: 'system,rate\nINTENTLOCK,0.01\n',
    primaryJson: JSON.stringify({
      runId: 'primary-real-01',
      selectedRecords: 2_000,
      evidenceMode: 'OFFLINE_COUNTERFACTUAL_REPLAY',
      systems: [],
      negativeResults: ['IntentLock has lower benign completion than the strongest baseline.'],
    }),
    ablationMarkdown: [
      '# Ablation and stage-comparison results',
      '',
      '## one-factor causal ablations',
      '',
      '| Arm | Rate |',
      '| --- | ---: |',
      '| STATELESS | 2.00% |',
      '',
      '## Non-causal stage comparisons',
      '',
      '| Arm | Rate |',
      '| --- | ---: |',
      '| SEMANTIC_ONLY | 3.00% |',
    ].join('\n'),
    ablationCsv: 'arm,rate\nSTATELESS,0.02\n',
    ablationJson: JSON.stringify({
      runId: 'ablation-real-01',
      evidenceMode: 'OFFLINE_COUNTERFACTUAL_REPLAY',
      recordCount: 3_200,
    }),
    adaptiveMarkdown: [
      '# Adaptive signer-boundary descriptive results',
      '',
      '`NON_PAIRED_NON_CAUSAL` and `OFFLINE_SCRIPTED_SIGNER_BOUNDARY_ONLY`.',
      'This evidence is not model-adaptive.',
      '',
      '| Source | Rows |',
      '| --- | ---: |',
      '| Scripted | 40 |',
    ].join('\n'),
    adaptiveCsv: 'design,rows\nNON_PAIRED_NON_CAUSAL,40\n',
    adaptiveJson: JSON.stringify({
      runId: 'adaptive-real-01',
      design: 'NON_PAIRED_NON_CAUSAL',
      claimScope: 'OFFLINE_SCRIPTED_SIGNER_BOUNDARY_ONLY',
      adaptiveSignerBoundaryDescriptive: { episodes: 40 },
    }),
    metadata: JSON.stringify({
      schemaVersion: '0.2',
      analysisCommit: '0123456789abcdef',
      workingTreeDirtyAtStart: false,
      primary: {
        runId: 'primary-real-01',
        selectedRecords: 2_000,
        evidenceMode: 'OFFLINE_COUNTERFACTUAL_REPLAY',
      },
      ablation: {
        runId: 'ablation-real-01',
        records: 3_200,
        referenceParityVerified: true,
        stageComparisonsCausal: false,
      },
      adaptive: {
        runId: 'adaptive-real-01',
        episodes: 40,
        comparisonDesign: 'NON_PAIRED_NON_CAUSAL',
        claimScope: 'OFFLINE_SCRIPTED_SIGNER_BOUNDARY_ONLY',
        causalComparison: false,
        equivalentCases: false,
        modelAdaptiveEvidence: false,
        forkExecutionEvidence: false,
      },
    }),
    securityUtilityFigure: '<svg><text>security utility</text></svg>',
    errorTaxonomyFigure: '<svg><text>error taxonomy</text></svg>',
    latencyFigure: '<svg><text>latency</text></svg>',
    architectureFigure: '<svg><text>architecture</text></svg>',
  };
}

function source(): string {
  return [
    '# IntentLock',
    '',
    '## 구조',
    PAPER_ASSEMBLY_TOKENS.architectureFigure,
    '',
    '## 주 결과',
    PAPER_ASSEMBLY_TOKENS.primaryTable,
    PAPER_ASSEMBLY_TOKENS.securityUtilityFigure,
    PAPER_ASSEMBLY_TOKENS.errorTaxonomyFigure,
    PAPER_ASSEMBLY_TOKENS.latencyFigure,
    '',
    '## 제거 실험',
    PAPER_ASSEMBLY_TOKENS.ablationTable,
    '',
    '## 적응형 서명 경계',
    PAPER_ASSEMBLY_TOKENS.adaptiveTable,
    '',
    '## 음의 결과',
    PAPER_ASSEMBLY_TOKENS.negativeResults,
    '',
    '## 재현성',
    PAPER_ASSEMBLY_TOKENS.provenance,
  ].join('\n');
}

describe('paper assembly', () => {
  it('preserves solo AI review disclosure and rejects fabricated independent approval', () => {
    const input = bundle();
    const metadata = JSON.parse(input.metadata) as Record<string, unknown>;
    const reviewProtocol = {
      schemaVersion: '0.1',
      mode: 'SOLO_AI_ASSISTED',
      independentHumanReviewClaim: false,
      finalAuthorApproval: 'PENDING',
    };
    const freeze = {
      review: {
        reviewerType: 'AI',
        reviewerPseudonym: 'ai-reviewer',
        reviewPath: 'experiments/reviews/ai.json',
        reviewDigestSha256: 'a'.repeat(64),
      },
      aiReviewDigestSha256: 'a'.repeat(64),
    };
    input.metadata = JSON.stringify({ ...metadata, reviewProtocol, freeze });
    expect(assemblePaperSource(source(), input).reviewProtocol).toEqual(reviewProtocol);
    input.metadata = JSON.stringify({ ...metadata, reviewProtocol });
    expect(() => validatePaperAnalysisBundle(input)).toThrow(/freeze metadata/);
    input.metadata = JSON.stringify({
      ...metadata,
      reviewProtocol: { ...reviewProtocol, independentHumanReviewClaim: true },
    });
    expect(() => validatePaperAnalysisBundle(input)).toThrow();
  });

  it('binds all 9 tables, metadata, and 4 figures before replacing final-paper slots', () => {
    const result = assemblePaperSource(source(), bundle());

    expect(result.markdown).not.toMatch(/\{\{[A-Z0-9_]+\}\}/u);
    expect(result.markdown).toContain('offline counterfactual replay');
    expect(result.markdown).toContain('NON_PAIRED_NON_CAUSAL');
    expect(result.markdown).toContain('../figures/architecture.svg');
    expect(result.markdown).toContain('lower benign completion');
    expect(Object.keys(result.artifactSha256)).toHaveLength(14);
    expect(result.wordCount).toBeGreaterThan(0);
    expect(result.notionWordCountConfirmationRequired).toBe(true);
  });

  it('rejects an adaptive artifact whose non-causal scope marker was removed', () => {
    const input = bundle();
    input.adaptiveMarkdown = input.adaptiveMarkdown.replace('not model-adaptive', 'adaptive');
    expect(() => validatePaperAnalysisBundle(input)).toThrow(/claim scope/u);
  });

  it('requires every generated insertion exactly once', () => {
    const incomplete = source().replace(PAPER_ASSEMBLY_TOKENS.latencyFigure, '');
    expect(() => assemblePaperSource(incomplete, bundle())).toThrow(/exactly one/u);
  });

  it('does not permit unrelated draft placeholders to ride through assembly', () => {
    expect(() => assemblePaperSource(`${source()}\n\nstatus: PENDING`, bundle())).toThrow(
      /PLACEHOLDER_REMAINS/u,
    );
  });
});
