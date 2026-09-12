/** Final editorial amendments, keeping prior editions and measured evidence immutable. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const read = (p) => readFileSync(p, 'utf8');
const sha = (s) => createHash('sha256').update(s).digest('hex');
const sourcePath = 'paper/visual-v2-ko.md';
const source = read(sourcePath);
const paragraphs = source.split(/\n\s*\n/);
const changes = [];
function amend(prefix, replacement) {
  const matches = paragraphs.filter((p) => p.startsWith(prefix));
  assert.equal(matches.length, 1, `Ambiguous amendment: ${prefix}`);
  changes.push({ old: matches[0], new: replacement });
}
amend(
  '메타마스크 에이전트 지갑(MetaMask Agent Wallet)은',
  '메타마스크 에이전트 지갑(MetaMask Agent Wallet)은 이 문제를 구체화하는 실무 사례다. Guard Mode는 이미 최근 24시간의 누적 자산 유출을 검사한다. 따라서 첫 예시는 MetaMask에 누적 한도가 없다는 지적이 아니다. 이 연구가 다루는 차이는 지갑 전체의 시간 창 한도를 넘어, 특정 작업에서 허용한 자산·권한·최종 상태를 연결하는 데 있다. 공식 문서는 비동기 요청, 모의 실행과 위협 검사, 지원 환경의 ERC-7821 일괄 호출과 미지원 환경의 순차 실행을 설명한다. [MetaMask Architecture](https://docs.metamask.io/agent-wallet/reference/architecture/), [MetaMask Outflow Policy](https://docs.metamask.io/agent-wallet/reference/outflow-policy/).',
);
amend(
  '본 연구의 기여는 경제 조건으로 표현한 지갑 의도를',
  '본 연구는 “다음 호출을 허용해도 되는가”를 세 가지 기록으로 나누어 다룬다. 이미 허용한 자산 유출, 아직 행사할 수 있는 토큰 사용 권한, 작업 종료 시 남아야 할 상태다. 기존 의도 정렬·권한 통제 연구 위에서 이 세 기록을 지갑의 경제 효과로 구체화하고, 이력을 없앴을 때 어떤 위반이 다시 허용되는지 비교한다. 정책 비교에는 연구자가 작성한 실행 기록(trace)을 사용하고, 실제 실행 여부는 별도의 고정 포크 증거로 제시한다.',
);
amend(
  '실행 식별자: primary-solo-v0.4.0-01; 고정 소스 A:',
  '주 평가의 분석 기록은 2,000개이며 재시도를 포함한 전체 시도는 2,092개다. 실행 식별자와 동결 소스는 9절에 모았다.',
);
amend(
  '비용은 방어 장치 평가 경로의 실제 경과 시간과 사용량 기록이다.',
  '지연은 방어 판단 경로에서 잰 경과 시간이고, 토큰 비용은 기록된 사용량과 당시 단가로 계산한 추정액이다. 청구서나 운영 지갑의 전체 비용을 검증한 값은 아니다. 블록 포함, 사용자 확인, 실제 체인 간 이동의 완료 시간은 측정하지 않았으므로 사용자 체감 응답 시간으로 읽어서는 안 된다.',
);
amend(
  '사전 정의된 음의 결과(negative result)의 자동 목록에는',
  '자동 분석의 음의 결과(negative result) 목록은 관측상 최선의 비교군과 두 주 지표를 비교하는 규칙만 적용해 비어 있었다. 그러나 이 절의 완료율 정체, 남은 위반과 확인 부담은 별도로 남는다. 최종 판단에는 자동 목록의 유무보다 어떤 사례에서 왜 멈추거나 놓쳤는지가 중요하다.',
);
amend(
  '첫 번째 적용 지점은 자산 유출과 권한 노출을 함께 보는 것이다.',
  '첫 번째 적용 지점은 작업별 권한 관리다. MetaMask의 최근 24시간 자산 유출 한도와 사용자가 특정 작업에 허용한 범위는 목적이 다르다. 하루 한도 안의 거래라도 지정한 수취인이나 작업 후 자산 조건을 어길 수 있다. 반대로 토큰이 아직 이동하지 않아도 사용 승인 대상에 권한을 남길 수 있다. 공식 문서에서 Permit2 같은 서명은 자산 유출 계산에 포함되지 않는다. 이는 다른 위협 검사나 사용자 승인도 없다는 뜻이 아니라, 유출량과 별도로 권한의 대상·금액·만료를 관리할 이유다. [MetaMask Outflow Policy](https://docs.metamask.io/agent-wallet/reference/outflow-policy/).',
);
amend(
  '주 비교 실행은 primary-solo-v0.4.0-01,',
  '주 비교 실행은 primary-solo-v0.4.0-01, 제거 실험은 primary-solo-v0.4.0-01-ablations, 서명 경계 실행은 adaptive-solo-v0.4.0-01이다. 주 비교의 고정 소스 A는 89c742e953c8251ba4de78939648b5c7d566b9f3, 동결 커밋 B는 58b36e2cbd490813b4ffc848f3ea126c94c7e4b3, 분석 커밋은 919c896a2f46932299ac3643d8448e9fa046818a이다. 주 비교는 오프라인 반사실 재생이고, 서명 경계 평가는 비대응·비인과 기술 통계다. 기록된 파일의 무결성 확인, 원시 결과의 재집계와 새 환경의 재실행은 서로 다른 검증이다. 그림의 글꼴·렌더러가 달라지면 PNG 바이트도 달라질 수 있어 새 출력은 다시 눈으로 확인해야 한다.',
);
amend(
  '이번 비교에서 실행 이력을 유지하는 정책은',
  '이번 결과에서 가장 분명한 차이는 실행 이력의 유무였다. 인텐트록이 호출별 정책보다 위반을 덜 허용한 반면, 판정기를 추가하는 것만으로 정상 완료가 좋아지지는 않았다. 따라서 운영 적용에서 먼저 연결해야 할 것은 모델의 설명이 아니라 확인된 작업 범위, 대기·완료된 효과와 실제 서명 요청이다. 이 연결이 없으면 개별 판정이 맞아도 작업 전체의 한도는 지켜지지 않을 수 있다. 사후 검증은 그 연결의 실패를 발견하는 수단이지 이미 발생한 거래를 취소하는 수단은 아니다.',
);
amend(
  '아래는 본문에 사용한 1차 출처다.',
  '아래는 본문에 사용한 1차 출처다. 논문은 명시한 arXiv 버전, 정책 모형은 2026년 9월 5일의 공개 문서 해석을 기준으로 한다. MetaMask 문서 세 편은 9월 12일 다시 확인했으며, 이 재확인을 새 제품 버전의 성능 평가로 해석하지 않는다.',
);
let manuscript = source;
for (const change of changes) manuscript = manuscript.replace(change.old, change.new);
// The user cleared this duplicated notice in Notion; keep the complete disclosure in section 8.
manuscript = manuscript.replace(
  /\n\n검증 절차는 검수 담당자 1명과 AI 보조 검토 방식으로 진행했다\.[^\n]*\n?$/,
  '\n',
);
const tables = (s) => [...s.matchAll(/^\|[^\n]*\n(?:\|[^\n]*(?:\n|$))+/gm)].map((m) => m[0].trim());
assert.deepEqual(tables(manuscript), tables(source));
assert.equal(tables(manuscript).length, 9);
assert.deepEqual(manuscript.match(/^\d+\. .+$/gm), source.match(/^\d+\. .+$/gm));
assert(
  !/github\.com|localhost|\b0x[0-9a-f]{40}\b|sk-(?:proj-)?[A-Za-z0-9_-]{20,}/iu.test(manuscript),
);
assert(!/^\s*(?:```|~~~|>|####)/mu.test(manuscript));
const words = manuscript
  .replace(/https?:\/\/\S+/gu, ' ')
  .match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu).length;
assert(words < 13000);
const escape = (v) =>
  v
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const inline = (v) =>
  escape(v)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
const body = manuscript
  .trim()
  .split(/\n\s*\n/)
  .map((part) => {
    const h = /^(#{1,3}) (.*)$/s.exec(part);
    if (h) return `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`;
    if (part.startsWith('|')) {
      const rows = part.split(/\r?\n/);
      const row = (s, tag) =>
        '<tr>' +
        s
          .split('|')
          .slice(1, -1)
          .map((c) => `<${tag}>${inline(c.trim())}</${tag}>`)
          .join('') +
        '</tr>';
      return `<div class="table-scroll"><table><thead>${row(rows[0], 'th')}</thead><tbody>${rows
        .slice(2)
        .map((r) => row(r, 'td'))
        .join('')}</tbody></table></div>`;
    }
    if (/^(?:- |\d+\. )/.test(part)) {
      const tag = part.startsWith('- ') ? 'ul' : 'ol';
      return `<${tag}>${part
        .split('\n')
        .map((s) => `<li>${inline(s.replace(/^(?:- |\d+\. )/, ''))}</li>`)
        .join('')}</${tag}>`;
    }
    return `<p${part.startsWith('Source:') ? ' class="source"' : ''}>${inline(part)}</p>`;
  })
  .join('\n');
const style = read('paper/visual-v2-preview.html').match(/<style>[\s\S]*?<\/style>/)[0];
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>IntentLock — 제출 전 검토본</title>${style}</head><body><header>INTENTLOCK · 제출 전 검토본</header><main>${body}</main><footer>실험 결과는 동결본 기준. 최종 저자 승인과 대회 제출은 별도 확인 사항입니다.</footer></body></html>`;
const outputs = { 'paper/final-review-ko.md': manuscript, 'paper/final-review-preview.html': html };
const manifest = {
  artifactType: 'FINAL_REVIEW_EDITORIAL_DERIVATIVE',
  reviewedAt: '2026-09-12',
  inputs: {
    [sourcePath]: sha(source),
    'paper/tables/results.json': sha(readFileSync('paper/tables/results.json')),
    'paper/visual-v2-preview.html': sha(read('paper/visual-v2-preview.html')),
  },
  outputs: Object.fromEntries(Object.entries(outputs).map(([p, v]) => [p, sha(v)])),
  changes,
  tables: 9,
  dataRows: 33,
  images: 6,
  references: 14,
  unicodeTokenEstimate: words,
  finalAuthorApproval: 'PENDING',
  experimentRerun: false,
};
const manifestText = JSON.stringify(manifest, null, 2) + '\n';
if (process.argv.includes('--check')) {
  for (const [p, v] of Object.entries(outputs)) assert.equal(read(p), v, `Stale derivative: ${p}`);
  assert.equal(read('artifacts/final-review-manifest.json'), manifestText);
} else {
  for (const [p, v] of Object.entries(outputs)) writeFileSync(p, v);
  writeFileSync('artifacts/final-review-manifest.json', manifestText);
}
console.log(
  JSON.stringify({
    status: 'PASS',
    amendments: changes.length,
    tables: 9,
    images: 6,
    references: 14,
    unicodeTokenEstimate: words,
    experimentRerun: false,
  }),
);
