import { describe, expect, it } from 'vitest';

import { auditSubmission } from '../../src/submission/audit.js';

describe('anonymous submission audit', () => {
  it('accepts ordinary Korean research prose', () => {
    const result = auditSubmission(
      '# 연구\n\nIntentLock은 누적 경제 효과를 확인하며 결과는 원시 증거와 연결된다.',
    );
    expect(result.findings).toEqual([]);
    expect(result.wordCount).toBeGreaterThan(0);
    expect(result.wordCountMethod).toBe('LOCAL_UNICODE_TOKEN_ESTIMATE');
    expect(result.notionWordCountConfirmationRequired).toBe(true);
  });

  it('reports format, identity, path, host, and placeholder categories without values', () => {
    const result = auditSubmission(
      [
        '```ts',
        '> [!NOTE]',
        'contact research@example.com',
        'https://github.com/example/repo',
        'C:\\Users\\person\\paper.md',
        'http://localhost:3000',
        'author: anonymous-person',
        '[M3 결과 삽입]',
        'private-team-name',
      ].join('\n'),
      { forbiddenTerms: ['private-team-name'] },
    );
    expect(result.findings.map((finding) => finding.code)).toEqual([
      'CODE_BLOCK_FORBIDDEN',
      'CALLOUT_FORBIDDEN',
      'EMAIL_EXPOSED',
      'GITHUB_EXPOSED',
      'LOCAL_PATH_EXPOSED',
      'LOCALHOST_EXPOSED',
      'AUTHOR_METADATA_EXPOSED',
      'PLACEHOLDER_REMAINS',
      'CUSTOM_FORBIDDEN_TERM',
    ]);
    expect(result.findings.map((finding) => finding.detail).join(' ')).not.toContain(
      'private-team-name',
    );
  });

  it('enforces the official word limit', () => {
    const result = auditSubmission('하나 둘 셋', { maxWords: 2 });
    expect(result.findings).toEqual([
      expect.objectContaining({ code: 'WORD_LIMIT_EXCEEDED', line: null }),
    ]);
  });

  it('flags broad placeholders, address-like identifiers, ENS names, and export metadata', () => {
    const result = auditSubmission(
      [
        '[40개 episode의 성공·safe block·normal failure와 offline 대비 차이 삽입]',
        'status: PENDING',
        'wallet 0x1111111111111111111111111111111111111111',
        'identity team-member.eth',
        '<meta data-notion-user-id="redacted">',
      ].join('\n'),
    );
    expect(result.findings.map((finding) => finding.code)).toEqual([
      'EVM_ADDRESS_REVIEW_REQUIRED',
      'ENS_NAME_REVIEW_REQUIRED',
      'EXPORT_METADATA_EXPOSED',
      'PLACEHOLDER_REMAINS',
      'PLACEHOLDER_REMAINS',
    ]);
  });

  it('allows only the privately supplied contest address and keeps other addresses reviewable', () => {
    const contestAddress = '0x1111111111111111111111111111111111111111';
    const unrelatedAddress = '0x2222222222222222222222222222222222222222';
    const result = auditSubmission(`team ${contestAddress}\nother ${unrelatedAddress}`, {
      allowedEvmAddresses: [contestAddress.toUpperCase().replace('0X', '0x')],
    });

    expect(result.findings).toEqual([
      expect.objectContaining({ code: 'EVM_ADDRESS_REVIEW_REQUIRED', line: 2 }),
    ]);
  });

  it('flags unexpanded paper assembly tokens as placeholders', () => {
    const result = auditSubmission('{{PRIMARY_RESULTS_TABLE}}');
    expect(result.findings).toEqual([
      expect.objectContaining({ code: 'PLACEHOLDER_REMAINS', line: 1 }),
    ]);
  });
});
