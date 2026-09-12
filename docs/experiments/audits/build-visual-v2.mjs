/** Visual-first editorial derivative. Does not mutate published Notion or prior editions. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { renderFlowFigures } from './visual-v2-flows.mjs';
import { renderDataFigures } from './visual-v2-charts.mjs';
import { reviseProse } from './visual-v2-prose.mjs';

const root = process.cwd();
const read = (p) => readFile(resolve(root, p));
const hash = (b) => createHash('sha256').update(b).digest('hex');
const inputs = [
  'paper/editorial-ko.md',
  'paper/tables/results.json',
  'artifacts/editorial-ko-manifest.json',
  'paper/editorial-preview.html',
  ...[
    'cover',
    'cumulative-budget',
    'architecture',
    'security-utility',
    'error-taxonomy',
    'latency',
  ].map((name) => `figures/editorial/${name}.svg`),
];
const inputHashes = Object.fromEntries(
  await Promise.all(inputs.map(async (p) => [p, hash(await read(p))])),
);
assert.equal(
  inputHashes['paper/editorial-ko.md'],
  '57045151de3b951e685a185b8e098922d5791decc19662551bdad963ec18924b',
);
const source = (await read('paper/editorial-ko.md')).toString('utf8');
const results = JSON.parse(await read('paper/tables/results.json'));
const revision = reviseProse(source);
let manuscript = revision.text.replaceAll('../figures/editorial/', '../figures/visual-v2/');
const captionEdits = [
  [
    'Source: 본 연구의 누적 실행과 권한 경계를 표현한 개념 그래픽. 실험 수치가 아님.',
    'Source: 본 연구. 개념 표지.',
  ],
  [
    'Source: 본 연구의 문제 설정을 설명한 예시. 한도 100, 호출 60·60은 같은 자산의 설명용 단위이며 실험 결과가 아님.',
    'Source: 본 연구. 100과 60은 같은 자산의 가상 단위이며 실험 수치가 아니다.',
  ],
  [
    'Source: 본 연구의 구현 경계와 설계. 선택적 의도 계약 생성, 주 오프라인 재생 평가와 별도 서명 경계 구현을 구분해 도식화.',
    'Source: 본 연구의 지갑 연결 모듈. 주 실험인 400개 기록의 오프라인 비교와 구분되는 구현 구조다. 단일 프로세스 기준이며 실행 실패 분기는 생략했다.',
  ],
  [
    'Source: 본 연구의 주 평가 첫 시도 집계. 위반 허용률은 전체 400건, 정상 완료율은 비적대적 160건 기준이다. 점은 관측 비율이며, 구간은 작성된 기본 의도별 묶음 부트스트랩 결과.',
    'Source: 본 연구. 위반 허용률은 전체 400건, 완료율은 비적대적 160건 기준이다. 선은 기본 의도 단위 군집 부트스트랩의 95% 구간이다.',
  ],
  [
    'Source: 본 연구의 주 평가 첫 시도 오류 분류. 시스템별 전체 400건의 기술 통계이며 위반 허용 건수와는 다른 지표.',
    'Source: 본 연구. 각 체계의 400건을 오류 유형으로 분류했다. 위반 허용이나 자금 손실의 건수가 아니다. 출력 없음 16건은 이 오류 분류의 부분집합이며, 최초 요청 실패 92건 전체와 다르다.',
  ],
  [
    'Source: 본 연구의 주 평가 첫 시도 평가 경로 시간 기록. 단위는 밀리초이며 거래 확정·사용자 확인까지의 전체 지연 시간이 아님.',
    'Source: 본 연구. 평가 경로의 평균 시간이며, 거래 확정·사용자 확인까지의 지연은 포함하지 않는다.',
  ],
  [
    'Source: 본 연구의 비교 시스템 정의와 실험 설정. 실행 식별자와 증거 범위는 해당 절 및 재현성 절에 명시.',
    'Source: 본 연구의 비교 설계.',
  ],
  [
    'Source: 본 연구의 주 평가 첫 시도 집계. 실행 식별자와 증거 범위는 해당 절 및 재현성 절에 명시.',
    'Source: 본 연구, 주 평가의 첫 시도.',
  ],
  [
    'Source: 본 연구의 구성요소 비교 집계. 실행 식별자와 증거 범위는 해당 절 및 재현성 절에 명시.',
    'Source: 본 연구, 구성요소 비교.',
  ],
  [
    'Source: 본 연구의 비대응·비인과 서명 경계 기술 비교. 실행 식별자와 증거 범위는 해당 절 및 재현성 절에 명시.',
    'Source: 본 연구, 비대응·비인과 서명 경계 비교.',
  ],
];
for (const [before, after] of captionEdits) {
  assert(manuscript.includes(before), 'Caption anchor not found');
  manuscript = manuscript.replaceAll(before, after);
}
const tables = (s) => [...s.matchAll(/^\|[^\n]*\n(?:\|[^\n]*(?:\n|$))+/gm)].map((m) => m[0].trim());
assert.deepEqual(tables(manuscript), tables(source));
assert.equal(manuscript.split('## 참고문헌')[1], source.split('## 참고문헌')[1]);
assert.deepEqual(manuscript.match(/https?:\/\/[^\s)]+/gu), source.match(/https?:\/\/[^\s)]+/gu));
assert.equal((manuscript.match(/^Source:/gm) ?? []).length, 15);
assert(!/^\s*(?:```|~~~|>|####)/mu.test(manuscript));
assert(!/github\.com|\b0x[0-9a-f]{40}\b|sk-(?:proj-)?[A-Za-z0-9_-]{20,}/iu.test(manuscript));

const cover = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900" role="img" aria-labelledby="title desc">
<title id="title">IntentLock — 에이전트 지갑의 누적 권한 검증</title>
<desc id="desc">여러 호출 경로가 한 권한 경계로 모이는 개념 표지. 측정 결과나 정식 시스템 구조도가 아니다.</desc>
<defs><linearGradient id="bg" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#203031"/><stop offset=".7" stop-color="#121212"/></linearGradient></defs>
<rect width="1600" height="900" fill="url(#bg)"/>
<g fill="none" stroke-linejoin="round" stroke-linecap="round">
<path d="M960 270H1100V410H1270M960 450H1270M960 630H1100V490H1270" stroke="#687684" stroke-width="4"/>
<path d="M1270 410V490M1286 450H1430" stroke="#38ABA2" stroke-width="5"/>
<circle cx="960" cy="270" r="18" fill="#ADB4D4" stroke="#ADB4D4"/>
<circle cx="960" cy="450" r="18" fill="#96CDBA" stroke="#96CDBA"/>
<circle cx="960" cy="630" r="18" fill="#B59CC7" stroke="#B59CC7"/>
<rect x="1250" y="388" width="44" height="124" rx="8" fill="#121212" stroke="#38ABA2" stroke-width="3"/>
<path d="M1263 450L1271 458L1284 440" stroke="#38ABA2" stroke-width="3"/>
<circle cx="1430" cy="450" r="9" fill="#38ABA2"/>
</g>
<g font-family="Malgun Gothic,Noto Sans KR,sans-serif" fill="#F2F3F5">
<text x="96" y="430" font-size="82" font-weight="700" letter-spacing="-2">IntentLock</text>
<text x="100" y="489" font-size="27" fill="#B5C2C3">에이전트 지갑의 누적 권한 검증</text>
<text x="100" y="810" font-size="17" fill="#A1AFB0" letter-spacing="3">SECURITY RESEARCH</text>
</g></svg>`;
const svgs = { cover, ...renderFlowFigures(), ...renderDataFigures(results) };
assert.deepEqual(Object.keys(svgs), [
  'cover',
  'cumulative-budget',
  'architecture',
  'security-utility',
  'error-taxonomy',
  'latency',
]);
const req = createRequire(import.meta.url);
const sharp = req(
  resolve(
    homedir(),
    '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp',
  ),
);
await mkdir(resolve(root, 'figures/visual-v2'), { recursive: true });
const outputs = {},
  visualText = {};
const visibleText = (svg) =>
  [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
    .map((m) => m[1].replace(/<[^>]+>/g, ' '))
    .join(' ');
for (const [name, svg] of Object.entries(svgs)) {
  assert(/<title\b/.test(svg) && /<desc\b/.test(svg));
  assert(!svg.includes('FOUR PILLARS') && !svg.includes('VALIDATED'));
  const p = `figures/visual-v2/${name}`;
  await writeFile(resolve(root, `${p}.svg`), svg, 'utf8');
  await sharp(Buffer.from(svg), { density: 144 })
    .png()
    .toFile(resolve(root, `${p}.png`));
  outputs[`${p}.svg`] = hash(await read(`${p}.svg`));
  outputs[`${p}.png`] = hash(await read(`${p}.png`));
  const before = visibleText((await read(`figures/editorial/${name}.svg`)).toString('utf8'));
  const after = visibleText(svg);
  visualText[name] = {
    beforeCharacters: before.length,
    afterCharacters: after.length,
    reductionPercent: Math.round((1 - after.length / before.length) * 100),
    visibleWords: after.trim().split(/\s+/u).length,
  };
}

const escape = (v) =>
  String(v)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const inline = (v) =>
  escape(v)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" loading="lazy">')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
const htmlBody = manuscript
  .trim()
  .split(/\n\s*\n/)
  .map((part) => {
    const h = /^(#{1,3}) (.*)$/s.exec(part);
    if (h) return `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`;
    if (part.startsWith('|')) {
      const rows = part.split(/\r?\n/);
      const cells = (line, tag) =>
        line
          .split('|')
          .slice(1, -1)
          .map((c) => `<${tag}>${inline(c.trim())}</${tag}>`)
          .join('');
      return `<div class="table-scroll"><table><thead><tr>${cells(rows[0], 'th')}</tr></thead><tbody>${rows
        .slice(2)
        .map((r) => `<tr>${cells(r, 'td')}</tr>`)
        .join('')}</tbody></table></div>`;
    }
    if (/^- /m.test(part))
      return `<ul>${part
        .split('\n')
        .map((l) => `<li>${inline(l.replace(/^- /, ''))}</li>`)
        .join('')}</ul>`;
    if (/^\d+\. /m.test(part))
      return `<ol>${part
        .split('\n')
        .map((l) => `<li>${inline(l.replace(/^\d+\. /, ''))}</li>`)
        .join('')}</ol>`;
    return `<p${part.startsWith('Source:') ? ' class="source"' : ''}>${inline(part)}</p>`;
  })
  .join('\n');
const oldHtml = (await read('paper/editorial-preview.html')).toString('utf8');
const style = oldHtml.match(/<style>[\s\S]*?<\/style>/)?.[0];
assert(style);
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(manuscript.split('\n')[0].slice(2))}</title>${style}</head><body><header>INTENTLOCK · 시각 중심 개정안</header><main>${htmlBody}</main><footer>검토용 개정안. 기존 Notion과 이전 원고는 변경하지 않았습니다.</footer></body></html>`;
for (const [p, body] of [
  ['paper/visual-v2-ko.md', manuscript],
  ['paper/visual-v2-preview.html', html],
]) {
  await writeFile(resolve(root, p), body, 'utf8');
  outputs[p] = hash(await read(p));
}
const scripts = Object.fromEntries(
  await Promise.all(
    ['build-visual-v2', 'visual-v2-flows', 'visual-v2-charts', 'visual-v2-prose'].map(async (n) => {
      const p = `docs/experiments/audits/${n}.mjs`;
      return [p, hash(await read(p))];
    }),
  ),
);
for (const [p, digest] of Object.entries(inputHashes))
  assert.equal(hash(await read(p)), digest, `Prior edition changed: ${p}`);
const qaPath = 'docs/experiments/audits/visual-v2-qa.json';
let qa = null;
try {
  qa = JSON.parse(await read(qaPath));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const qaMatches =
  qa?.reviewerType === 'AI_ASSISTED' &&
  Object.entries(outputs)
    .filter(([p]) => p.endsWith('.png'))
    .every(([p, digest]) => qa.inspectedPngHashes?.[p] === digest);
const manifest = {
  artifactType: 'VISUAL_FIRST_EDITORIAL_DERIVATIVE',
  inputs: inputHashes,
  outputs,
  scripts,
  proseEdits: revision.edits,
  captionEdits,
  visualText,
  originalEvidencePreserved: true,
  experimentRerun: false,
  images: 6,
  tables: 9,
  references: 14,
  sourceCaptions: 15,
  whitespaceWords: manuscript.trim().split(/\s+/u).length,
  notionChangedByThisBuild: false,
  authorApproval: 'PENDING',
  visualQa: {
    status: qaMatches ? 'AI_RENDER_REVIEW_PASS' : 'PENDING',
    recordSha256: qa ? hash(await read(qaPath)) : null,
    renderer: sharp.versions,
    browserPreviewVerified: false,
  },
};
await writeFile(
  resolve(root, 'artifacts/visual-v2-manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);
console.log(
  JSON.stringify(
    {
      manuscript: 'paper/visual-v2-ko.md',
      images: 6,
      proseEdits: revision.edits.length,
      visualText,
      originalEvidencePreserved: true,
    },
    null,
    2,
  ),
);
