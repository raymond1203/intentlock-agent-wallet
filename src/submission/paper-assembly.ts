import { createHash } from 'node:crypto';
import { SoloAiReviewProtocolSchema } from '../experiments/protocol.js';

import { auditSubmission } from './audit.js';

export const PAPER_ANALYSIS_ARTIFACT_PATHS = {
  primaryMarkdown: 'paper/tables/results.md',
  primaryCsv: 'paper/tables/results.csv',
  primaryJson: 'paper/tables/results.json',
  ablationMarkdown: 'paper/tables/ablations.md',
  ablationCsv: 'paper/tables/ablations.csv',
  ablationJson: 'paper/tables/ablations.json',
  adaptiveMarkdown: 'paper/tables/adaptive.md',
  adaptiveCsv: 'paper/tables/adaptive.csv',
  adaptiveJson: 'paper/tables/adaptive.json',
  metadata: 'paper/tables/results.metadata.json',
  securityUtilityFigure: 'figures/security-utility.svg',
  errorTaxonomyFigure: 'figures/error-taxonomy.svg',
  latencyFigure: 'figures/latency.svg',
  architectureFigure: 'figures/architecture.svg',
} as const;

export type PaperAnalysisArtifactKey = keyof typeof PAPER_ANALYSIS_ARTIFACT_PATHS;
export type PaperAnalysisBundle = Record<PaperAnalysisArtifactKey, string>;

export const PAPER_ASSEMBLY_TOKENS = {
  primaryTable: '{{PRIMARY_RESULTS_TABLE}}',
  ablationTable: '{{ABLATION_RESULTS_TABLE}}',
  adaptiveTable: '{{ADAPTIVE_RESULTS_TABLE}}',
  securityUtilityFigure: '{{SECURITY_UTILITY_FIGURE}}',
  errorTaxonomyFigure: '{{ERROR_TAXONOMY_FIGURE}}',
  latencyFigure: '{{LATENCY_FIGURE}}',
  architectureFigure: '{{ARCHITECTURE_FIGURE}}',
  provenance: '{{ANALYSIS_PROVENANCE}}',
  negativeResults: '{{NEGATIVE_RESULTS}}',
} as const;

interface JsonObject {
  [key: string]: unknown;
}

export interface ValidatedPaperAnalysisBundle {
  primaryRunId: string;
  ablationRunId: string;
  adaptiveRunId: string;
  analysisCommit: string;
  negativeResults: string[];
  artifactSha256: Record<string, string>;
  reviewProtocol?: {
    schemaVersion: '0.1';
    mode: 'SOLO_AI_ASSISTED';
    independentHumanReviewClaim: false;
    finalAuthorApproval: 'PENDING';
  };
}

export interface PaperAssemblyResult extends ValidatedPaperAnalysisBundle {
  markdown: string;
  sourceSha256: string;
  outputSha256: string;
  wordCount: number;
  maxWords: number;
  wordCountMethod: 'LOCAL_UNICODE_TOKEN_ESTIMATE';
  notionWordCountConfirmationRequired: true;
}

function sha256(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

function parseObject(source: string, label: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as JsonObject;
}

function objectField(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonObject;
}

function stringField(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a string`);
  return value;
}

function assertIncludes(source: string, needle: string, label: string): void {
  if (!source.includes(needle))
    throw new Error(`${label} is missing required claim scope: ${needle}`);
}

function assertCsv(source: string, firstColumn: string, label: string): void {
  const [header, ...rows] = source.trim().split(/\r?\n/u);
  if (!header?.startsWith(`${firstColumn},`) || rows.length === 0) {
    throw new Error(`${label} is missing its header or data rows`);
  }
}

function assertSvg(source: string, label: string): void {
  if (!/<svg\b/iu.test(source) || !/<\/svg>/iu.test(source)) {
    throw new Error(`${label} is not a complete SVG`);
  }
}

/**
 * Validates the complete 9-table/4-figure analyzer bundle before any value reaches paper prose.
 * This intentionally checks claim-scope sentinels as well as counts and run identity.
 */
export function validatePaperAnalysisBundle(
  bundle: PaperAnalysisBundle,
): ValidatedPaperAnalysisBundle {
  for (const [key, path] of Object.entries(PAPER_ANALYSIS_ARTIFACT_PATHS)) {
    if (!bundle[key as PaperAnalysisArtifactKey].trim()) {
      throw new Error(`paper analysis artifact is empty: ${path}`);
    }
  }

  const primary = parseObject(bundle.primaryJson, 'primary results');
  const ablation = parseObject(bundle.ablationJson, 'ablation results');
  const adaptive = parseObject(bundle.adaptiveJson, 'adaptive results');
  const metadata = parseObject(bundle.metadata, 'analysis metadata');
  const reviewProtocol =
    metadata.reviewProtocol === undefined
      ? undefined
      : SoloAiReviewProtocolSchema.parse(metadata.reviewProtocol);
  if (reviewProtocol) {
    const freeze = objectField(metadata.freeze, 'analysis freeze metadata');
    const review = objectField(freeze.review, 'analysis freeze review');
    if (
      review.reviewerType !== 'AI' ||
      !/^[a-f0-9]{64}$/u.test(stringField(review.reviewDigestSha256, 'AI review digest')) ||
      !stringField(review.reviewPath, 'AI review path') ||
      !stringField(review.reviewerPseudonym, 'AI reviewer') ||
      freeze.aiReviewDigestSha256 !== review.reviewDigestSha256 ||
      freeze.humanReviewDigestSha256 !== undefined
    ) {
      throw new Error(
        'solo paper metadata requires the actual AI freeze-review binding without a human approval claim',
      );
    }
  }
  const primaryMetadata = objectField(metadata.primary, 'analysis metadata primary');
  const ablationMetadata = objectField(metadata.ablation, 'analysis metadata ablation');
  const adaptiveMetadata = objectField(metadata.adaptive, 'analysis metadata adaptive');
  const adaptiveSignerBoundary = objectField(
    adaptive.adaptiveSignerBoundaryDescriptive,
    'adaptive signer-boundary analysis',
  );

  const primaryRunId = stringField(primary.runId, 'primary run ID');
  const ablationRunId = stringField(ablation.runId, 'ablation run ID');
  const adaptiveRunId = stringField(adaptive.runId, 'adaptive run ID');
  const analysisCommit = stringField(metadata.analysisCommit, 'analysis commit');

  if (
    metadata.schemaVersion !== '0.2' ||
    metadata.workingTreeDirtyAtStart !== false ||
    primary.selectedRecords !== 2_000 ||
    primary.evidenceMode !== 'OFFLINE_COUNTERFACTUAL_REPLAY' ||
    primaryMetadata.runId !== primaryRunId ||
    primaryMetadata.selectedRecords !== 2_000 ||
    primaryMetadata.evidenceMode !== 'OFFLINE_COUNTERFACTUAL_REPLAY'
  ) {
    throw new Error('primary paper artifact is not the complete scoped 2,000-record analysis');
  }
  if (
    ablation.evidenceMode !== 'OFFLINE_COUNTERFACTUAL_REPLAY' ||
    ablation.recordCount !== 3_200 ||
    ablationMetadata.runId !== ablationRunId ||
    ablationMetadata.records !== 3_200 ||
    ablationMetadata.referenceParityVerified !== true ||
    ablationMetadata.stageComparisonsCausal !== false
  ) {
    throw new Error('ablation paper artifact is not the complete scoped 3,200-record analysis');
  }
  if (
    adaptive.design !== 'NON_PAIRED_NON_CAUSAL' ||
    adaptive.claimScope !== 'OFFLINE_SCRIPTED_SIGNER_BOUNDARY_ONLY' ||
    adaptiveSignerBoundary.episodes !== 40 ||
    adaptiveMetadata.runId !== adaptiveRunId ||
    adaptiveMetadata.episodes !== 40 ||
    adaptiveMetadata.comparisonDesign !== 'NON_PAIRED_NON_CAUSAL' ||
    adaptiveMetadata.claimScope !== 'OFFLINE_SCRIPTED_SIGNER_BOUNDARY_ONLY' ||
    adaptiveMetadata.causalComparison !== false ||
    adaptiveMetadata.equivalentCases !== false ||
    adaptiveMetadata.modelAdaptiveEvidence !== false ||
    adaptiveMetadata.forkExecutionEvidence !== false
  ) {
    throw new Error('adaptive paper artifact exceeds or differs from its registered claim scope');
  }

  assertIncludes(
    bundle.primaryMarkdown,
    'Evidence mode: offline counterfactual replay.',
    'primary table',
  );
  assertIncludes(
    bundle.primaryMarkdown,
    'not a fixed-fork transaction UER measurement',
    'primary table',
  );
  assertIncludes(bundle.ablationMarkdown, 'one-factor causal ablations', 'ablation table');
  assertIncludes(bundle.ablationMarkdown, 'Non-causal stage comparisons', 'ablation table');
  assertIncludes(bundle.adaptiveMarkdown, '`NON_PAIRED_NON_CAUSAL`', 'adaptive table');
  assertIncludes(
    bundle.adaptiveMarkdown,
    'OFFLINE_SCRIPTED_SIGNER_BOUNDARY_ONLY',
    'adaptive table',
  );
  assertIncludes(bundle.adaptiveMarkdown, 'not model-adaptive', 'adaptive table');

  assertCsv(bundle.primaryCsv, 'system', 'primary CSV');
  assertCsv(bundle.ablationCsv, 'arm', 'ablation CSV');
  assertCsv(bundle.adaptiveCsv, 'design', 'adaptive CSV');
  assertSvg(bundle.securityUtilityFigure, 'security-utility figure');
  assertSvg(bundle.errorTaxonomyFigure, 'error-taxonomy figure');
  assertSvg(bundle.latencyFigure, 'latency figure');
  assertSvg(bundle.architectureFigure, 'architecture figure');

  const negativeResults = Array.isArray(primary.negativeResults)
    ? primary.negativeResults.map((value, index) =>
        stringField(value, `negative result ${String(index + 1)}`),
      )
    : (() => {
        throw new Error('primary results must contain the registered negative-results list');
      })();
  const artifactSha256 = Object.fromEntries(
    Object.entries(PAPER_ANALYSIS_ARTIFACT_PATHS).map(([key, path]) => [
      path,
      sha256(bundle[key as PaperAnalysisArtifactKey]),
    ]),
  );

  return {
    primaryRunId,
    ablationRunId,
    adaptiveRunId,
    analysisCommit,
    negativeResults,
    artifactSha256,
    ...(reviewProtocol ? { reviewProtocol } : {}),
  };
}

function withoutTopHeading(source: string): string {
  return source.trim().replace(/^# [^\n]+\r?\n+/u, '');
}

function exactlyOne(source: string, token: string): void {
  const count = source.split(token).length - 1;
  if (count !== 1)
    throw new Error(`paper source must contain exactly one ${token}; found ${String(count)}`);
}

function negativeResultsMarkdown(negativeResults: readonly string[]): string {
  if (negativeResults.length === 0) {
    return '사전 정의된 음의 결과(negative result) 판정 규칙에 해당하는 항목은 없었다. 이 문장은 등록된 규칙의 판정만 뜻하며, 모든 비교와 하위 집단에서 우월하다는 뜻은 아니다.';
  }
  return [
    '분석기가 사전 정의된 규칙으로 표시한 음의 결과(negative result)는 다음과 같다.',
    '',
    ...negativeResults.map((result) => `- ${result}`),
  ].join('\n');
}

/** Replaces evidence slots only after the analyzer bundle passes provenance/scope validation. */
export function assemblePaperSource(
  source: string,
  bundle: PaperAnalysisBundle,
): PaperAssemblyResult {
  const validated = validatePaperAnalysisBundle(bundle);
  Object.values(PAPER_ASSEMBLY_TOKENS).forEach((token) => {
    exactlyOne(source, token);
  });

  const insertions: Record<string, string> = {
    [PAPER_ASSEMBLY_TOKENS.primaryTable]: bundle.primaryMarkdown.trim(),
    [PAPER_ASSEMBLY_TOKENS.ablationTable]: withoutTopHeading(bundle.ablationMarkdown),
    [PAPER_ASSEMBLY_TOKENS.adaptiveTable]: withoutTopHeading(bundle.adaptiveMarkdown),
    [PAPER_ASSEMBLY_TOKENS.securityUtilityFigure]:
      '![보안과 정상 완료의 관계](../figures/security-utility.svg)',
    [PAPER_ASSEMBLY_TOKENS.errorTaxonomyFigure]:
      '![시스템별 오류 유형](../figures/error-taxonomy.svg)',
    [PAPER_ASSEMBLY_TOKENS.latencyFigure]: '![시스템별 지연 시간](../figures/latency.svg)',
    [PAPER_ASSEMBLY_TOKENS.architectureFigure]:
      '![IntentLock 검증 구조](../figures/architecture.svg)',
    [PAPER_ASSEMBLY_TOKENS.provenance]: `주 비교 실행은 \`${validated.primaryRunId}\`, 제거 실험은 \`${validated.ablationRunId}\`, 적응형 서명 경계 실행은 \`${validated.adaptiveRunId}\`이며 분석 커밋은 \`${validated.analysisCommit}\`이다. 주 비교는 오프라인 반사실 재생이고, 적응형 표는 비대응·비인과 기술 통계다.`,
    [PAPER_ASSEMBLY_TOKENS.negativeResults]: negativeResultsMarkdown(validated.negativeResults),
  };

  let markdown = source;
  for (const [token, insertion] of Object.entries(insertions)) {
    markdown = markdown.replace(token, insertion);
  }
  if (validated.reviewProtocol?.mode === 'SOLO_AI_ASSISTED') {
    markdown +=
      '\n\n검증 절차는 단일 저자가 주도하고 AI가 보조했다. 두 사람의 독립 검수나 맹검 평가를 수행했다는 주장은 하지 않는다.\n';
  }
  markdown = `${markdown.trim()}\n`;
  if (/\{\{[A-Z0-9_]+\}\}/u.test(markdown)) {
    throw new Error('paper output contains an unknown or unexpanded assembly token');
  }

  const audit = auditSubmission(markdown);
  if (audit.findings.length > 0) {
    const locations = audit.findings
      .map(
        (finding) => `${finding.code}@${finding.line === null ? 'document' : String(finding.line)}`,
      )
      .join(', ');
    throw new Error(`assembled paper failed the non-private submission audit: ${locations}`);
  }

  return {
    ...validated,
    markdown,
    sourceSha256: sha256(source),
    outputSha256: sha256(markdown),
    wordCount: audit.wordCount,
    maxWords: audit.maxWords,
    wordCountMethod: audit.wordCountMethod,
    notionWordCountConfirmationRequired: audit.notionWordCountConfirmationRequired,
  };
}
