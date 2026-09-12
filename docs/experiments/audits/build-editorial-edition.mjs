/** New publication derivative only. Never runs experiments or overwrites the submitted edition. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { rewriteEditorial } from './fourpillars-editorial-rewrite.mjs';
import { renderEditorialFigures } from './fourpillars-editorial-figures.mjs';

const root = process.cwd();
const read = (path) => readFile(resolve(root, path));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const inputPaths = [
  'paper/submission-ko.md',
  'paper/final.md',
  'paper/tables/results.json',
  'paper/tables/results.metadata.json',
  'artifacts/submission-ko-manifest.json',
  ...['architecture', 'security-utility', 'error-taxonomy', 'latency'].flatMap((name) => [
    `figures/ko/${name}.svg`,
    `figures/ko/${name}.png`,
  ]),
];
const inputs = Object.fromEntries(
  await Promise.all(inputPaths.map(async (p) => [p, hash(await read(p))])),
);
assert.equal(
  inputs['paper/submission-ko.md'],
  '4cce67ecdaa158519f0d004687fe6c923c6ff19a880bd4720a181d57d8ed0f1b',
);
const source = (await read('paper/submission-ko.md')).toString('utf8');
const results = JSON.parse(await read('paper/tables/results.json'));
const metadata = JSON.parse(await read('paper/tables/results.metadata.json'));
const { text: rewritten, edits } = rewriteEditorial(source);
let manuscript = rewritten.replaceAll('../figures/ko/', '../figures/editorial/');
const firstSection = manuscript.match(/^## 1\.[^\n]*\n\n/m)?.[0];
assert(firstSection, 'Missing introduction');
const exampleEnd = manuscript.indexOf(
  '\n\n',
  manuscript.indexOf(firstSection) + firstSection.length,
);
assert(exampleEnd > 0);
manuscript =
  manuscript.slice(0, exampleEnd) +
  '\n\n![호출별 허용과 누적 예산 검사의 차이](../figures/editorial/cumulative-budget.png)\n\n' +
  'Source: 본 연구의 문제 설정을 설명한 예시. 한도 100, 호출 60·60은 같은 자산의 설명용 단위이며 실험 결과가 아님.' +
  manuscript.slice(exampleEnd);
manuscript = manuscript.replace(
  '### Key Takeaways\n\n',
  '![IntentLock 연구 표지](../figures/editorial/cover.png)\n\n' +
    'Source: 본 연구의 누적 실행과 권한 경계를 표현한 개념 그래픽. 실험 수치가 아님.\n\n### Key Takeaways\n\n',
);

const tableRows = (text) =>
  [...text.matchAll(/^\|[^\n]*\n(?:\|[^\n]*(?:\n|$))+/gm)].map((m) =>
    m[0]
      .trim()
      .split(/\r?\n/)
      .slice(2)
      .map((row) =>
        row
          .split('|')
          .slice(1, -1)
          .map((v) => v.trim()),
      ),
  );
assert.deepEqual(tableRows(manuscript), tableRows(source), 'Editorial changed table data');
assert.equal(
  hash(JSON.stringify(tableRows(manuscript))),
  '9a631183a61af5f3acddc23e27c4854bb0f348af06d32a981dcaceed00f6261e',
);
const urls = (text) => text.match(/https?:\/\/[^\s)]+/gu) ?? [];
assert.deepEqual(urls(manuscript), urls(source), 'Editorial changed external sources');
assert.equal(
  manuscript.split('## 참고문헌')[1],
  source.split('## 참고문헌')[1],
  'Reference section changed',
);
assert(!/^\s*(?:```|~~~|>)/mu.test(manuscript), 'Forbidden code box or callout');
assert(!/github\.com|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|\b0x[0-9a-f]{40}\b/iu.test(manuscript));
const wordCount = manuscript.trim().split(/\s+/u).length;
assert(wordCount < 13000);

const escape = (text) =>
  String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const cover = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900" role="img">
<title>IntentLock — 에이전트에게 맡긴 돈, 어디까지 허용할 것인가</title>
<desc>실험 데이터가 아닌 개념 표지. 여러 실행 경로가 공통 권한 경계를 통과하는 문제를 표현한다. Four Pillars의 공식 발행물 표식은 사용하지 않는다.</desc>
<defs>
<linearGradient id="cover-light" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#273234"/><stop offset=".65" stop-color="#121516"/><stop offset="1" stop-color="#0D1011"/></linearGradient>
<pattern id="cover-grid" width="36" height="36" patternUnits="userSpaceOnUse"><path d="M36 0H0V36" fill="none" stroke="#FFFFFF" stroke-opacity=".035"/></pattern>
</defs>
<rect width="1600" height="900" fill="url(#cover-light)"/><rect width="1600" height="900" fill="url(#cover-grid)"/>
<g font-family="Malgun Gothic, Noto Sans KR, sans-serif" fill="#F0F2F2">
<text x="90" y="95" font-size="20" letter-spacing="5" fill="#9CAAAA">INTENTLOCK / SECURITY RESEARCH</text>
<text x="90" y="265" font-size="30" fill="#91CFC5">다중 도구 실행의 의도 이탈</text>
<text x="90" y="365" font-size="62" font-weight="700">에이전트에게 맡긴 돈,</text>
<text x="90" y="448" font-size="62" font-weight="700">어디까지 허용할 것인가</text>
<text x="93" y="520" font-size="25" fill="#B9C3C3">호출의 허용에서 누적 경제 효과의 검증으로</text>
<g fill="none" stroke-linecap="round" stroke-linejoin="round">
<path d="M1020 370H1100V280H1230V365H1430" stroke="#879DCC" stroke-width="5"/>
<path d="M1020 440H1150V535H1250V440H1330" stroke="#48B8A8" stroke-width="6"/>
<path d="M1020 510H1090V640H1230V575H1430" stroke="#B098C4" stroke-width="5"/>
<path d="M1350 240V680" stroke="#9BCFC8" stroke-width="2" stroke-dasharray="9 12"/>
<rect x="1003" y="353" width="34" height="34" rx="6" stroke="#879DCC" stroke-width="3"/>
<rect x="1003" y="423" width="34" height="34" rx="6" stroke="#48B8A8" stroke-width="3"/>
<rect x="1003" y="493" width="34" height="34" rx="6" stroke="#B098C4" stroke-width="3"/>
<circle cx="1430" cy="365" r="10" fill="#879DCC" stroke="none"/>
<circle cx="1430" cy="575" r="10" fill="#B098C4" stroke="none"/>
<path d="M1322 430L1342 450M1342 430L1322 450" stroke="#48B8A8" stroke-width="4"/>
</g>
<text x="1350" y="725" text-anchor="middle" fill="#A8C8C3" font-size="20">승인된 실행 범위</text>
<path d="M90 785H1510" stroke="#435052"/>
<text x="90" y="835" font-size="18" fill="#AAB6B6">Source: 본 연구의 문제 설정 · 설명용 개념도</text>
<text x="1510" y="835" text-anchor="end" font-size="20" fill="#D0D9D8">INTENTLOCK</text>
</g></svg>`;

const svgs = { cover, ...renderEditorialFigures(results) };
assert.equal(Object.keys(svgs).length, 6);
const req = createRequire(import.meta.url);
const sharp = req(
  resolve(
    homedir(),
    '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp',
  ),
);
await mkdir(resolve(root, 'figures/editorial'), { recursive: true });
const outputPaths = [];
for (const [name, svg] of Object.entries(svgs)) {
  assert(
    /<title(?:\s[^>]*)?>/.test(svg) && /<desc(?:\s[^>]*)?>/.test(svg),
    `${name}: missing accessible description`,
  );
  const svgPath = `figures/editorial/${name}.svg`;
  const pngPath = `figures/editorial/${name}.png`;
  await writeFile(resolve(root, svgPath), svg, 'utf8');
  await sharp(Buffer.from(svg), { density: 144 }).png().toFile(resolve(root, pngPath));
  outputPaths.push(svgPath, pngPath);
}

// A static local reading preview, without remote scripts, fonts, cookies, or analytics.
function inline(text) {
  return escape(text)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" loading="lazy">')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<span class="term">$1</span>');
}
function htmlFromMarkdown(text) {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      const h = block.match(/^(#{1,3}) (.*)$/s);
      if (h) return `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`;
      if (block.startsWith('|')) {
        const rows = block.split(/\r?\n/);
        const cells = (line, tag) =>
          line
            .split('|')
            .slice(1, -1)
            .map((cell) => `<${tag}>${inline(cell.trim())}</${tag}>`)
            .join('');
        return `<div class="table-scroll"><table><thead><tr>${cells(rows[0], 'th')}</tr></thead><tbody>${rows
          .slice(2)
          .map((row) => `<tr>${cells(row, 'td')}</tr>`)
          .join('')}</tbody></table></div>`;
      }
      if (/^- /m.test(block))
        return `<ul>${block
          .split(/\n/)
          .map((line) => `<li>${inline(line.replace(/^- /, ''))}</li>`)
          .join('')}</ul>`;
      if (/^\d+\. /m.test(block))
        return `<ol>${block
          .split(/\n/)
          .map((line) => `<li>${inline(line.replace(/^\d+\. /, ''))}</li>`)
          .join('')}</ol>`;
      return `<p${block.startsWith('Source:') ? ' class="source"' : ''}>${inline(block)}</p>`;
    })
    .join('\n');
}
const title = manuscript.split('\n')[0].slice(2);
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f7f8f8;color:#202629;font-family:"Malgun Gothic","Noto Sans KR",sans-serif}header{background:#111719;color:#d5e2df;padding:22px 6vw;letter-spacing:.12em;font-size:12px}main{max-width:1060px;margin:auto;padding:48px 54px 100px;background:white}h1{font-size:40px;line-height:1.45;letter-spacing:-.04em;margin:0 0 38px}h2{font-size:28px;letter-spacing:-.035em;margin:76px 0 24px;border-top:1px solid #dce3e1;padding-top:28px}h3{font-size:22px;margin:40px 0 20px}p,li{font-size:17px;line-height:1.95;word-break:keep-all;overflow-wrap:anywhere}p{margin:22px 0}li{margin:12px 0}a{color:#14776c;text-underline-offset:4px}img{display:block;width:100%;height:auto;margin:32px 0 0}.source{font-size:13px;color:#62706e;line-height:1.7;margin:12px 0 34px}table{width:100%;border-collapse:collapse;font-size:13px;line-height:1.7}th,td{padding:13px 12px;border-bottom:1px solid #dce3e1;text-align:left;vertical-align:top}th{background:#eff4f2;font-weight:700}.table-scroll{overflow-x:auto;margin:28px 0}.term{font-size:.9em;background:#f0f3f2;padding:1px 3px}footer{padding:26px 6vw;font-size:12px;color:#626f6b}@media(max-width:700px){main{padding:28px 22px 60px}h1{font-size:29px}h2{font-size:24px}p,li{font-size:16px}th,td{min-width:110px}}@media print{header,footer{display:none}main{max-width:none;padding:0}h2{break-after:avoid}img,table{break-inside:avoid}}</style></head><body><header>INTENTLOCK · 편집 개정판 / 저자 검토용</header><main>${htmlFromMarkdown(manuscript)}</main><footer>로컬 미리보기. 기존 제출본·Notion을 변경하지 않음. 최종 저자 확인 및 제출 여부 미검증.</footer></body></html>`;
await writeFile(resolve(root, 'paper/editorial-ko.md'), manuscript, 'utf8');
await writeFile(resolve(root, 'paper/editorial-preview.html'), html, 'utf8');
outputPaths.push('paper/editorial-ko.md', 'paper/editorial-preview.html');
const outputs = Object.fromEntries(
  await Promise.all(outputPaths.map(async (p) => [p, hash(await read(p))])),
);
for (const [p, h] of Object.entries(inputs))
  assert.equal(hash(await read(p)), h, `Original changed: ${p}`);
const scripts = [
  'docs/experiments/audits/build-editorial-edition.mjs',
  'docs/experiments/audits/fourpillars-editorial-rewrite.mjs',
  'docs/experiments/audits/fourpillars-editorial-figures.mjs',
];
let qa = null;
try {
  qa = JSON.parse(await read('docs/experiments/audits/editorial-visual-qa.json'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const pngPaths = outputPaths.filter((p) => p.endsWith('.png'));
const inspectedHashesMatch =
  qa?.reviewerType === 'AI_ASSISTED' &&
  pngPaths.every((p) => qa.inspectedPngHashes?.[p] === outputs[p]);
const manifest = {
  artifactType: 'EDITORIAL_PUBLICATION_DERIVATIVE',
  version: '1.0',
  inputs,
  outputs,
  scripts: Object.fromEntries(
    await Promise.all(scripts.map(async (p) => [p, hash(await read(p))])),
  ),
  basis:
    'Public article structure plus five user-provided visual references; original graphics, no publisher branding',
  edits,
  sourceRunId: results.runId,
  sourceAnalysisCommit: metadata.analysisCommit,
  evidenceMode: metadata.primary.evidenceMode,
  sourceDataGeneratedAt: metadata.generatedAt,
  preserved: {
    canonicalEdition: true,
    originalFigures: true,
    all33TableRows: true,
    all14References: true,
    externalUrlsInOrder: true,
    firstAttemptFailures: 92,
    experimentRerun: false,
  },
  publication: {
    images: 6,
    dataFigures: 3,
    explanatoryFigures: 3,
    tables: 9,
    localWhitespaceWordCount: wordCount,
    wordLimit: 13000,
    notionWordCountVerified: false,
    teamSize: 2,
    track: 'MetaMask',
    unknownIdentityFields: 'BLANK',
  },
  visualQa: {
    status: inspectedHashesMatch ? 'AI_RENDER_REVIEW_PASS' : 'PENDING_RENDER_REVIEW',
    inspectedHashesMatch: Boolean(inspectedHashesMatch),
    renderer: sharp.versions,
    qaRecordSha256: qa
      ? hash(await read('docs/experiments/audits/editorial-visual-qa.json'))
      : null,
  },
  authorApproval: 'PENDING',
  notionChanged: false,
  finalSubmissionVerified: false,
};
await writeFile(
  resolve(root, 'artifacts/editorial-ko-manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);
console.log(
  JSON.stringify(
    {
      manuscript: 'paper/editorial-ko.md',
      preview: 'paper/editorial-preview.html',
      edits: edits.length,
      images: pngPaths.length,
      wordCount,
      visualQa: manifest.visualQa.status,
      originalFilesPreserved: true,
    },
    null,
    2,
  ),
);
