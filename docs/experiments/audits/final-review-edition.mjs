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
  '본 연구는 누적 한도 검사를 새로운 보안 기법으로 주장하지 않는다. 다루려는 문제는 같은 작업의 자산 유출, 남아 있는 토큰 사용 권한, 종료 시 자산 상태를 하나의 확인된 계약에 대조하는 것이다. 이를 실행 시점에 검사하는 프로토타입과 사례별 비교 자료를 제시한다. 특히 검사 규칙을 추가해서 생긴 차이와 이전 실행을 기억해서 생긴 차이를 나누어 읽는다. 정책 비교에는 연구자가 작성한 실행 기록(trace)을 사용하고, 실제 실행 여부는 별도의 고정 포크 증거로 제시한다.',
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
  '이 연구에서 얻은 설계 판단은 지갑 전체의 유출 한도를 작업별 계약으로 대체하자는 것이 아니다. 두 검사를 함께 두고, 자산이 얼마나 이동했는지, 어떤 권한이 남았는지, 요청한 작업이 끝났는지를 따로 확인해야 한다는 것이다. Guard 모형과의 점수 차이에는 추가 규칙과 모형의 단순화가 섞여 있었고, 호출별 정책과의 차이에는 중복 실행 인식이 크게 작용했다. 따라서 “누적 검사를 도입해 성능이 개선됐다”는 설명만으로는 결과를 충분히 설명할 수 없다. 실행 이력을 서명 요청에 연결할 이유는 확인했지만, 실제 MetaMask보다 안전하거나 작업 완료율을 높였다는 결론은 내리지 않는다.',
);
amend(
  '후속 검증에서는 사용자의 계약 확인 정확도,',
  '후속 비교에서는 가스·슬리피지·권한 한도를 양쪽에 똑같이 둔 뒤 작업 이력만 바꿔야 한다. 중복 제출도 토큰의 중복 이동, 같은 권한의 재설정, 프로토콜이 자체 거부하는 재사용으로 나누어 실제 실행 여부를 확인할 필요가 있다. 여기에 사용자의 계약 확인 정확도와 여러 서명 서비스 사이의 예약·복구 일관성을 검증해야 운영 적용을 판단할 수 있다. 이번 결과가 보여준 것은 그 검증에서 무엇을 분리해 측정해야 하는가이다.',
);
amend(
  '- 인텐트록은 지갑 에이전트가 이미 허용받은 지출과 권한을 기록하고,',
  '- 지갑의 하루 유출 한도와 사용자가 맡긴 작업의 성공 조건은 다르다. 인텐트록은 기존 한도 검사를 대체하기보다, 확인된 작업의 지출·권한·최종 자산 상태를 함께 검사하는 연구 프로토타입이다.\n- 400개 실행 기록의 오프라인 비교에서 위반 허용은 인텐트록 10건, 호출별 정책 66건이었다. 차이 56건의 최초 중단 사유는 중복 실행 인식 41건과 누적 유출 초과 15건이었다. 이는 작성 정책 기준의 판정 차이이며 실제 이중 지출 방지 건수가 아니다.\n- 정상 완료는 두 정책 모두 80/160건이었다. 이미 허용한 위반 10건은 사후에 발견해도 되돌릴 수 없었다. 이 결과는 실제 MetaMask의 취약점이나 운영 성능의 우열을 입증하지 않는다.',
);
const differentialSection = `**6.1.4 차이를 만든 것은 어떤 검사였나**

누적 한도가 이미 있는 Guard 모형과는 왜 차이가 났을까. 주 분석 종료 후 같은 사례 식별자와 입력 해시로 400건을 짝지어 살펴봤다. 이 절은 최초 시도 기록의 사후 설명 분석이며, 기존 점수나 작성 라벨을 바꾸지 않는다.

먼저 Guard 모형은 147건을 사용자 확인 대상으로 보류했다. 이 중 54건에는 누적 유출 초과 사유가 있었다. IntentLock은 이 147건에 DENY를 반환했지만, 두 정책 모두 자동 실행을 중단했다. 확인 요청을 거부로 바꾼 것만으로 추가 위반을 막았다고 셀 수는 없다.

위반 허용 93건과 10건의 차이인 83건은 다음과 같이 나뉜다. 표는 IntentLock이 먼저 반환한 중단 사유를 기준으로 한다. 여러 조건이 동시에 위반될 수 있고 검사 순서도 영향을 주므로, 각 행은 독립적인 인과 효과가 아니다.

| 최초 중단 사유 | 사례 수 | 차이를 해석할 때의 주의점 |
| --- | --- | --- |
| 가스 예산 초과 | 52 | Guard 모형에 없는 작업별 가스 규칙의 효과 |
| 중복 실행 인식 | 12 | 반복 호출 식별이며, 모두 실제 이중 지출인 것은 아님 |
| 슬리피지 상한 초과 | 10 | 같은 지출액에서도 최소 수취량을 제한한 효과 |
| 토큰 사용 권한 상한 초과 | 8 | 현재 유출량과 별도로 승인 금액을 검사한 효과 |
| 체인별 호출 대상 불일치 | 1 | Guard 모형이 체인별 주소 목록을 합친 단순화의 영향 |

Source: 본 연구, 주 평가 최초 시도 400쌍의 사후 대조. 표의 분모는 Guard 모형만 작성 정책 위반을 허용한 83건이다.

가장 큰 묶음인 가스 52건은 누적 이력이 없어도 해당 호출의 규칙으로 잡을 수 있었다. 슬리피지 10건, 권한 상한 8건과 체인별 대상 1건도 호출별 정책이 거부했다. 따라서 83건 전체를 작업 이력 관리의 성과로 해석하면 안 된다. 특히 체인별 대상 1건은 비교 모형의 주소 처리 방식에서 생긴 차이다. 실제 MetaMask에도 같은 문제가 있다는 증거가 아니다.

권한과 유출을 나눌 이유는 승인 사례 AP-01에서 드러난다. 사용자는 토큰 사용 한도를 2 USDC로 정했는데, 변이는 이를 사실상 무제한 승인으로 바꿨다. 당장 토큰이 이동하지 않으므로 Guard 모형의 유출량은 0이지만, IntentLock은 승인 금액 초과로 중단했다. 이는 별도의 권한 상한이 필요한 예이지 누적 유출 검사 자체가 틀렸다는 예가 아니다. 이 사례는 직접 승인 거래이며, 공식 문서의 Permit2 서명 제외 설명을 모든 승인 거래에 대한 운영 제품의 처리 방식으로 확대해석하지 않는다.

반대로 AP-01의 반복 실행 변이는 같은 2 USDC 승인을 두 번 설정한다. 중복 실행 규칙은 이를 막았지만, 승인 한도가 4 USDC로 더해지는 거래는 아니다. 호출별 정책과의 차이 56건도 최초 사유로 보면 중복 실행 인식 41건과 누적 유출 초과 15건이다. 여기서 중복 인식은 동일 호출 시퀀스가 두 번 이어진 작성 기록을 대상으로 한다. 이 수치를 실제 이중 지출 방지 건수나 일반적인 재시도 탐지 성능으로 읽을 수 없다.

Guard 모형이 허용하고 IntentLock이 판단을 유보한 비적대적 불완전 해석 65건 역시 추가 공격 차단으로 세지 않았다. 두 정책 모두 위반을 허용한 10건은 오래된 견적의 사후 상태 사례였다. 결국 이 비교의 쟁점은 누적 검사의 유무 하나가 아니다. 어떤 규칙을 두었는지, 어떤 실행을 기억하는지, 언제 결과를 관측할 수 있는지를 구분해야 차이의 의미를 설명할 수 있다.`;
amend('### 6.2 구성요소별 영향', `${differentialSection}\n\n### 6.2 구성요소별 영향`);
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
const addedTables = tables(differentialSection);
assert.equal(addedTables.length, 1);
assert.deepEqual(
  tables(manuscript).filter((t) => t !== addedTables[0]),
  tables(source),
);
assert.equal(tables(manuscript).length, 10);
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
    'artifacts/guard-differential-audit.json': sha(read('artifacts/guard-differential-audit.json')),
  },
  outputs: Object.fromEntries(Object.entries(outputs).map(([p, v]) => [p, sha(v)])),
  changes,
  tables: 10,
  dataRows: 38,
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
    tables: 10,
    images: 6,
    references: 14,
    unicodeTokenEstimate: words,
    experimentRerun: false,
  }),
);
