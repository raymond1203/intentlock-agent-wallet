export interface SubmissionAuditFinding {
  code:
    | 'CODE_BLOCK_FORBIDDEN'
    | 'CALLOUT_FORBIDDEN'
    | 'EMAIL_EXPOSED'
    | 'GITHUB_EXPOSED'
    | 'LOCAL_PATH_EXPOSED'
    | 'LOCALHOST_EXPOSED'
    | 'AUTHOR_METADATA_EXPOSED'
    | 'EVM_ADDRESS_REVIEW_REQUIRED'
    | 'ENS_NAME_REVIEW_REQUIRED'
    | 'EXPORT_METADATA_EXPOSED'
    | 'PLACEHOLDER_REMAINS'
    | 'CUSTOM_FORBIDDEN_TERM'
    | 'WORD_LIMIT_EXCEEDED';
  line: number | null;
  detail: string;
}

export interface SubmissionAuditResult {
  wordCount: number;
  maxWords: number;
  wordCountMethod: 'LOCAL_UNICODE_TOKEN_ESTIMATE';
  notionWordCountConfirmationRequired: true;
  findings: SubmissionAuditFinding[];
}

function countWords(text: string): number {
  return (
    text.replace(/https?:\/\/\S+/gu, ' ').match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu)?.length ??
    0
  );
}

function pushMatches(
  lines: readonly string[],
  pattern: RegExp,
  code: SubmissionAuditFinding['code'],
  detail: string,
  findings: SubmissionAuditFinding[],
): void {
  lines.forEach((line, index) => {
    pattern.lastIndex = 0;
    if (pattern.test(line)) findings.push({ code, line: index + 1, detail });
  });
}

/**
 * Audits an exported anonymous submission without returning matched PII values.
 * Team-specific forbidden terms are supplied at runtime and must not be committed.
 */
export function auditSubmission(
  text: string,
  options: {
    maxWords?: number;
    forbiddenTerms?: readonly string[];
    allowedEvmAddresses?: readonly string[];
  } = {},
): SubmissionAuditResult {
  const maxWords = options.maxWords ?? 13_000;
  const lines = text.split(/\r?\n/u);
  const findings: SubmissionAuditFinding[] = [];
  const wordCount = countWords(text);

  pushMatches(
    lines,
    /^\s*```/u,
    'CODE_BLOCK_FORBIDDEN',
    'Markdown code fences are not allowed in the Notion submission.',
    findings,
  );
  pushMatches(
    lines,
    /^\s*>/u,
    'CALLOUT_FORBIDDEN',
    'Blockquote or callout markup is not allowed in the Notion submission.',
    findings,
  );
  pushMatches(
    lines,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
    'EMAIL_EXPOSED',
    'An email-shaped value is present.',
    findings,
  );
  pushMatches(
    lines,
    /(?:https?:\/\/)?(?:www\.)?github\.com(?:\/|\b)/iu,
    'GITHUB_EXPOSED',
    'A GitHub link or host is present.',
    findings,
  );
  pushMatches(
    lines,
    /(?:\b[A-Z]:\\|\/Users\/|\/home\/|\bfile:\/\/|\bcodex:\/\/)/iu,
    'LOCAL_PATH_EXPOSED',
    'A local user path is present.',
    findings,
  );
  pushMatches(
    lines,
    /\b(?:localhost|127\.0\.0\.1)\b/iu,
    'LOCALHOST_EXPOSED',
    'A local host reference is present.',
    findings,
  );
  pushMatches(
    lines,
    /^\s*(?:author|creator|lastModifiedBy|company)\s*:/iu,
    'AUTHOR_METADATA_EXPOSED',
    'Author-shaped document metadata is present.',
    findings,
  );
  const allowedEvmAddresses = new Set(
    (options.allowedEvmAddresses ?? [])
      .map((address) => address.trim().toLocaleLowerCase('en-US'))
      .filter((address) => /^0x[a-f0-9]{40}$/u.test(address)),
  );
  lines.forEach((line, index) => {
    const addresses = line.match(/\b0x[a-fA-F0-9]{40}\b/gu) ?? [];
    if (addresses.some((address) => !allowedEvmAddresses.has(address.toLocaleLowerCase('en-US')))) {
      findings.push({
        code: 'EVM_ADDRESS_REVIEW_REQUIRED',
        line: index + 1,
        detail:
          'A full EVM address is present and is not the privately allowlisted contest submission address.',
      });
    }
  });
  pushMatches(
    lines,
    /\b(?:[a-z0-9-]+\.)+eth\b/iu,
    'ENS_NAME_REVIEW_REQUIRED',
    'An ENS-shaped name is present.',
    findings,
  );
  pushMatches(
    lines,
    /(?:<!--|<meta\b|data-notion-|notion_page_id|notion_user_id|last_edited_(?:by|time)|created_(?:by|time)|document\s*properties)/iu,
    'EXPORT_METADATA_EXPOSED',
    'Export or document metadata markup is present.',
    findings,
  );
  pushMatches(
    lines,
    /(?:\bTODO\b|\bTBD\b|\bPENDING\b|PLACEHOLDER|\{\{[A-Z0-9_]+\}\}|\[[^\]]*(?:삽입|확정|추가)[^\]]*\]|(?:결과|수치|표|그림|분석)\s*(?:삽입|확정)\s*(?:전|뒤)|추후\s*(?:삽입|확정))/iu,
    'PLACEHOLDER_REMAINS',
    'A drafting placeholder remains.',
    findings,
  );

  for (const term of options.forbiddenTerms ?? []) {
    const normalized = term.trim().toLocaleLowerCase('en-US');
    if (!normalized) continue;
    lines.forEach((line, index) => {
      if (line.toLocaleLowerCase('en-US').includes(normalized)) {
        findings.push({
          code: 'CUSTOM_FORBIDDEN_TERM',
          line: index + 1,
          detail: 'A team-supplied forbidden identity term is present.',
        });
      }
    });
  }

  if (wordCount > maxWords) {
    findings.push({
      code: 'WORD_LIMIT_EXCEEDED',
      line: null,
      detail: `Word count ${String(wordCount)} exceeds ${String(maxWords)}.`,
    });
  }

  return {
    wordCount,
    maxWords,
    wordCountMethod: 'LOCAL_UNICODE_TOKEN_ESTIMATE',
    notionWordCountConfirmationRequired: true,
    findings,
  };
}
