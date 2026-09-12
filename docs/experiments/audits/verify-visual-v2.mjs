/**
 * Independent read-only audit of the visual-first manuscript and figure bytes.
 * Does not import generators, run experiments, create files, or contact Notion.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

const root = process.cwd();
const localPath = (path) => {
  const absolute = resolve(root, path);
  const local = relative(root, absolute);
  assert(local && !local.startsWith('..') && !isAbsolute(local), `External path: ${path}`);
  return absolute;
};
const bytes = (path) => readFileSync(localPath(path));
const read = (path) => bytes(path).toString('utf8');
const json = (path) => JSON.parse(read(path));
const digest = (value) => createHash('sha256').update(value).digest('hex');
const hash = (path) => digest(bytes(path));
const normalize = (value) => value.replace(/\r\n/g, '\n');
const manifest = json('artifacts/visual-v2-manifest.json');
const names = [
  'cover',
  'cumulative-budget',
  'architecture',
  'security-utility',
  'error-taxonomy',
  'latency',
];
const expectedInputs = [
  'paper/editorial-ko.md',
  'paper/tables/results.json',
  'artifacts/editorial-ko-manifest.json',
  'paper/editorial-preview.html',
  ...names.map((name) => `figures/editorial/${name}.svg`),
];
const expectedOutputs = [
  ...names.flatMap((name) => [`figures/visual-v2/${name}.svg`, `figures/visual-v2/${name}.png`]),
  'paper/visual-v2-ko.md',
  'paper/visual-v2-preview.html',
];
const expectedScripts = [
  'build-visual-v2',
  'visual-v2-flows',
  'visual-v2-charts',
  'visual-v2-prose',
].map((name) => `docs/experiments/audits/${name}.mjs`);
let bindings = 0;
for (const [group, required] of [
  [manifest.inputs, expectedInputs],
  [manifest.outputs, expectedOutputs],
  [manifest.scripts, expectedScripts],
]) {
  assert(group && typeof group === 'object' && !Array.isArray(group));
  for (const path of required) assert(Object.hasOwn(group, path), `Unbound dependency: ${path}`);
  for (const [path, expected] of Object.entries(group)) {
    assert.match(expected, /^[0-9a-f]{64}$/);
    assert.equal(hash(path), expected, `Stale hash: ${path}`);
    bindings++;
  }
}
assert.equal(
  manifest.inputs['paper/editorial-ko.md'],
  '57045151de3b951e685a185b8e098922d5791decc19662551bdad963ec18924b',
);
assert.equal(
  manifest.inputs['paper/tables/results.json'],
  '325fae00a73af9b72d1a7b518d4a7bc295d9e84384933c86c9270af3a7c08d74',
);
assert.equal(manifest.artifactType, 'VISUAL_FIRST_EDITORIAL_DERIVATIVE');
assert.equal(manifest.originalEvidencePreserved, true);
assert.equal(manifest.experimentRerun, false);
assert.equal(manifest.notionChangedByThisBuild, false);
assert.equal(manifest.authorApproval, 'PENDING');
assert.equal(manifest.images, 6);
assert.equal(manifest.tables, 9);
assert.equal(manifest.references, 14);
assert.equal(manifest.sourceCaptions, 15);

const source = normalize(read('paper/editorial-ko.md'));
const manuscript = normalize(read('paper/visual-v2-ko.md'));
const tables = (value) =>
  [...value.matchAll(/^\|[^\n]*\n(?:\|[^\n]*(?:\n|$))+/gm)].map((match) => match[0].trim());
const tableBlocks = tables(manuscript);
assert.equal(tableBlocks.length, 9);
assert.deepEqual(tableBlocks, tables(source), 'Tables changed');
const tableRows = tableBlocks.map((block) =>
  block
    .split('\n')
    .slice(2)
    .map((row) =>
      row
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    ),
);
assert.equal(tableRows.flat().length, 33);
assert.equal(
  digest(JSON.stringify(tableRows)),
  '9a631183a61af5f3acddc23e27c4854bb0f348af06d32a981dcaceed00f6261e',
);
const references = (value) => value.slice(value.indexOf('## 참고문헌'));
assert.equal(references(manuscript), references(source), 'References or review disclosure changed');
assert.equal((references(manuscript).match(/^\d+\. /gm) ?? []).length, 14);
const urls = (value) => value.match(/https?:\/\/[^\s)]+/gu) ?? [];
assert.deepEqual(urls(manuscript), urls(source), 'Citation URLs or order changed');
assert(
  manuscript.includes('팀 EVM 주소:\n\n팀 인원수: 2명\n\n참가 트랙: MetaMask\n\n학회 코드 넘버:\n'),
);
assert.equal(
  (manuscript.split('### Key Takeaways\n\n')[1].split('\n\n')[0].match(/^- /gm) ?? []).length,
  3,
);
assert.equal((manuscript.match(/^Source:/gm) ?? []).length, 15);
const words = manuscript.trim().split(/\s+/u).length;
assert.equal(manifest.whitespaceWords, words);
const unicodeWords =
  manuscript.replace(/https?:\/\/\S+/gu, ' ').match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu)
    ?.length ?? 0;
assert(words < 13000 && unicodeWords < 13000, 'Local word estimate exceeds submission cap');

for (const forbidden of [
  /^\s*(?:```|~~~|>|####)/mu,
  /\{\{[A-Z_]+\}\}/u,
  /github\.com|localhost|[A-Z]:\\Users\\|\/Users\/|\/home\//iu,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/u,
  /\b0x[0-9a-f]{40}\b/iu,
])
  assert(!forbidden.test(manuscript), `Forbidden publication pattern: ${forbidden}`);

const withoutCaptions = (value) =>
  value
    .split('\n')
    .filter((line) => !/^(?:Source:|!\[)/.test(line))
    .join('\n');
const numericSequence = (value) => value.match(/\d+(?:[.,]\d+)*/g) ?? [];
assert.deepEqual(
  numericSequence(withoutCaptions(manuscript)),
  numericSequence(withoutCaptions(source)),
  'Numeric fact sequence changed',
);
for (const required of [
  '10/400',
  '66/400',
  '80/160',
  '53/160',
  '58/160',
  'HTTP 429',
  '92건',
  '23.00%',
  '최초 시도 실패 92건',
  '47건',
  '107회',
  '0.1479204',
  'NON_PAIRED_NON_CAUSAL',
  '정상 원본 80건과 비적대적 의도 이탈 80건',
  '실제 사용자의 승인 행위',
  '성공률은 측정하지 않았다',
  '추상 상태 전이의 조건부 증명 개요',
  '구현을 기계적으로 검증한 증명이 아니다',
  '범위가 제한된 실행 권한 발급',
  '담당자 1명과 인공지능 보조 검토',
  '두 번째 독립 인간 검토자로 계산하지 않는다',
  '계정의 모든 후속 요청에 대한 일괄 동결',
  '운영 제품을 재현한 것이 아닌 정책 모형',
])
  assert(manuscript.includes(required), `Missing critical caveat: ${required}`);

assert.equal(manifest.proseEdits.length, 25);
let reconstructed = source;
for (const edit of manifest.proseEdits) {
  assert.equal(reconstructed.split(edit.before).length, 2, `Nonunique edit anchor: ${edit.id}`);
  reconstructed = reconstructed.replace(edit.before, edit.after);
}
reconstructed = reconstructed.replaceAll('../figures/editorial/', '../figures/visual-v2/');
for (const [before, after] of manifest.captionEdits) {
  assert(reconstructed.includes(before), 'Missing caption provenance anchor');
  reconstructed = reconstructed.replaceAll(before, after);
}
assert.equal(reconstructed, manuscript, 'Manuscript not reproduced by recorded edits');

const attributes = (tag) =>
  Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
const elements = (svg, kind) =>
  [...svg.matchAll(new RegExp(`<${kind}\\b[^>]*>`, 'g'))].map((match) => ({
    ...attributes(match[0]),
    raw: match[0],
    offset: match.index,
  }));
const allMarks = (svg) =>
  [...svg.matchAll(/<(rect|circle|g|text)\b[^>]*data-system="[^>]+>/g)].map((match) => ({
    ...attributes(match[0]),
    tag: match[1],
    raw: match[0],
    offset: match.index,
  }));
const close = (actual, expected, label = '') => {
  assert(
    actual !== undefined && Number.isFinite(Number(actual)) && Number.isFinite(expected),
    `Nonfinite ${label}`,
  );
  assert(Math.abs(Number(actual) - expected) < 1e-8, `${label}: ${actual} != ${expected}`);
};
const visibleTextElements = (svg) =>
  [...svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)].map((match) => ({
    ...attributes(match[1]),
    value: match[2],
  }));
const hasLabel = (svg, x, y, value) =>
  visibleTextElements(svg).some(
    (label) =>
      Math.abs(Number(label.x) - x) < 1e-8 &&
      Math.abs(Number(label.y) - y) < 1e-8 &&
      label.value === String(value),
  );
const images = [...manuscript.matchAll(/!\[[^\]]*\]\(([^)]+)\)/gu)].map((match) => match[1]);
assert.equal(images.length, 6);
assert.equal(new Set(images).size, 6);
assert.deepEqual(
  images,
  names.map((name) => `../figures/visual-v2/${name}.png`),
);
const visibleText = (svg) =>
  visibleTextElements(svg)
    .map((label) => label.value.replace(/<[^>]+>/g, ' '))
    .join(' ');
for (const name of names) {
  const svg = read(`figures/visual-v2/${name}.svg`);
  const png = bytes(`figures/visual-v2/${name}.png`);
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR');
  const dimensions = attributes(svg.match(/<svg\b[^>]*>/)[0]);
  assert.equal(png.readUInt32BE(16), Number(dimensions.width) * 2, `PNG width: ${name}`);
  assert.equal(png.readUInt32BE(20), Number(dimensions.height) * 2, `PNG height: ${name}`);
  assert(/<title\b/.test(svg) && /<desc\b/.test(svg) && /aria-labelledby=/.test(svg));
  assert(
    !/FOUR PILLARS|VALIDATED|<script\b|<foreignObject\b|<image\b|https?:\/\/(?!www\.w3\.org\/2000\/svg)/i.test(
      svg,
    ),
  );
  const before = visibleText(read(`figures/editorial/${name}.svg`));
  const after = visibleText(svg);
  assert.deepEqual(
    manifest.visualText[name],
    {
      beforeCharacters: before.length,
      afterCharacters: after.length,
      reductionPercent: Math.round((1 - after.length / before.length) * 100),
      visibleWords: after.trim().split(/\s+/u).length,
    },
    `Visual text inventory: ${name}`,
  );
}
const html = read('paper/visual-v2-preview.html');
assert(!/<script\b|<iframe\b|<link\b[^>]*href="https?:|<img\b[^>]*src="https?:/i.test(html));
assert.equal((html.match(/<table>/g) ?? []).length, 9);
assert.equal((html.match(/<img /g) ?? []).length, 6);
for (const path of images) assert(html.includes(`src="${path}"`));

const results = json('paper/tables/results.json');
const order = ['NONE', 'GUARD_MODE', 'LLM_VERIFIER', 'PER_CALL_POLICY', 'INTENTLOCK'];
const systems = new Map(results.systems.map((row) => [row.system, row]));
assert.equal(systems.size, 5);
for (const system of order) {
  const row = systems.get(system);
  assert(row);
  assert.equal(row.aggregate.total, 400);
  assert.equal(row.aggregate.benignTotal, 160);
}
const unique = (marks, key) =>
  assert.equal(new Set(marks.map(key)).size, marks.length, 'Repeated plotted marks');
const security = read('figures/visual-v2/security-utility.svg');
const securityMarks = allMarks(security);
assert.equal(securityMarks.length, 20);
unique(
  securityMarks,
  (mark) => `${mark['data-system']}|${mark['data-metric']}|${mark['data-kind']}`,
);
for (const mark of securityMarks) {
  const row = systems.get(mark['data-system']);
  assert(row);
  const metric = mark['data-metric'];
  assert(['unsafeExecutionRate', 'benignCompletionRate'].includes(metric));
  const benign = metric === 'benignCompletionRate';
  const axisX = benign ? 860 : 246;
  const denominator = benign ? 160 : 400;
  const count = row.aggregate[benign ? 'benignCompleted' : 'unsafeExecutions'];
  const rate = count / denominator;
  const ci = row[`${metric}95`];
  const y = 219 + order.indexOf(row.system) * 117;
  const point = axisX + 514 * rate;
  const low = axisX + 514 * ci.lower95;
  const high = axisX + 514 * ci.upper95;
  const color = row.system === 'INTENTLOCK' ? '#0C8077' : '#747F8A';
  close(mark['data-value'], rate);
  close(mark['data-count'], count);
  close(mark['data-denominator'], denominator);
  close(mark['data-low'], ci.lower95);
  close(mark['data-high'], ci.upper95);
  close(mark['data-axis-min'], 0);
  close(mark['data-axis-max'], 1);
  close(mark['data-axis-x'], axisX);
  close(mark['data-axis-width'], 514);
  close(mark['data-plot-x'], point);
  close(mark['data-plot-y'], y);
  close(mark['data-low-x'], low);
  close(mark['data-high-x'], high);
  assert.equal(ci.replicates, 10000);
  assert.equal(ci.groupCount, 80);
  close(ci.point, rate);
  if (mark['data-kind'] === 'point') {
    assert.equal(mark.tag, 'circle');
    close(mark.cx, point);
    close(mark.cy, y);
    close(mark.r, 7);
    assert.equal(mark.fill, color);
  } else {
    assert.equal(mark['data-kind'], 'interval');
    assert.equal(mark.tag, 'g');
    const end = security.indexOf('</g>', mark.offset);
    assert(end > mark.offset);
    const lines = elements(security.slice(mark.offset, end), 'line');
    assert.equal(lines.length, 3);
    for (const [index, expected] of [
      [low, y, high, y, 3],
      [low, y - 8, low, y + 8, 2],
      [high, y - 8, high, y + 8, 2],
    ].entries()) {
      ['x1', 'y1', 'x2', 'y2', 'stroke-width'].forEach((attribute, i) =>
        close(lines[index][attribute], expected[i], `CI ${attribute}`),
      );
      assert.equal(lines[index].stroke, color);
    }
  }
  assert(
    hasLabel(security, point + 13, y - 17, `${count}/${denominator}`),
    'Rate count label missing or misplaced',
  );
}
for (const system of order)
  for (const metric of ['unsafeExecutionRate', 'benignCompletionRate'])
    for (const kind of ['point', 'interval'])
      assert(
        securityMarks.some(
          (mark) =>
            mark['data-system'] === system &&
            mark['data-metric'] === metric &&
            mark['data-kind'] === kind,
        ),
      );

const categories = [
  'amount-inflation',
  'chain-substitution',
  'gas-inflation',
  'hidden-batch',
  'policy-laundering',
  'recipient-substitution',
  'retry-double-spend',
  'slippage-widening',
  'stale-quote',
  'unlimited-approval',
  'benign-hallucination',
  'BENIGN_ORIGINAL',
  'LLM_OUTPUT_UNAVAILABLE',
  'partial-completion',
];
const heatmap = read('figures/visual-v2/error-taxonomy.svg');
const heatMarks = allMarks(heatmap);
assert.equal(heatMarks.length, 75);
unique(heatMarks, (mark) => `${mark['data-system']}|${mark['data-metric']}`);
// One common intensity encoding for every system: RGB(29,35,37) to RGB(176,184,196).
const intensity = (weight) =>
  '#' +
  [29 + 147 * weight, 35 + 149 * weight, 37 + 159 * weight]
    .map((channel) => Math.round(channel).toString(16).padStart(2, '0'))
    .join('');
for (const mark of heatMarks) {
  const row = systems.get(mark['data-system']);
  assert(row);
  const column = order.indexOf(row.system);
  const x = 348 + column * 205;
  const metric = mark['data-metric'];
  const total = Object.values(row.errorsByMutation).reduce((sum, count) => sum + count, 0);
  close(mark['data-denominator'], 400);
  if (metric === 'errorsByMutationTotal') {
    assert.equal(mark.tag, 'text');
    close(mark['data-value'], total);
    close(mark['data-count'], total);
    close(mark.x, x + 195 / 2);
    close(mark.y, 966);
    assert(hasLabel(heatmap, x + 195 / 2, 966, total));
    continue;
  }
  assert.equal(mark.tag, 'rect');
  const category = mark['data-category'];
  assert(categories.includes(category));
  assert.equal(metric, `errorsByMutation.${category}`);
  const index = categories.indexOf(category);
  const y = 173 + index * 53;
  const count = row.errorsByMutation[category] ?? 0;
  close(mark['data-value'], count);
  close(mark['data-count'], count);
  close(mark['data-color-min'], 0);
  close(mark['data-color-max'], 70);
  close(mark['data-color-weight'], count / 70);
  close(mark['data-column'], column);
  close(mark['data-row'], index);
  for (const [attribute, expected] of [
    ['x', x],
    ['y', y],
    ['width', 195],
    ['height', 46],
  ]) {
    close(mark[attribute], expected, `Heatmap ${attribute}`);
    close(mark[`data-plot-${attribute}`], expected);
  }
  assert.equal(
    mark.fill.toLowerCase(),
    intensity(count / 70),
    'Heatmap color is not the common linear count scale',
  );
  if (count > 0)
    assert(
      hasLabel(heatmap, x + 195 / 2, y + 31, count),
      'Heatmap count label missing or misplaced',
    );
  else
    assert(
      !visibleTextElements(heatmap).some(
        (label) => Number(label.x) === x + 195 / 2 && Number(label.y) === y + 31,
      ),
      'Zero heatmap cells should be blank',
    );
}
for (const system of order)
  for (const category of categories)
    assert(
      heatMarks.some(
        (mark) => mark['data-system'] === system && mark['data-category'] === category,
      ),
    );
const legend = elements(heatmap, 'rect').filter(
  (rect) =>
    Number(rect.x) >= 935 &&
    Number(rect.x) < 1215 &&
    Number(rect.y) >= 1013 &&
    Number(rect.y) < 1030,
);
assert.equal(legend.length, 70, 'Heatmap must have one common legend');
legend.forEach((rect, index) => {
  close(rect.x, 935 + index * 4);
  close(rect.y, 1013);
  close(rect.width, 4);
  close(rect.height, 12);
  assert.equal(rect.fill.toLowerCase(), intensity(index / 69));
});
assert.equal(
  Object.values(systems.get('INTENTLOCK').errorsByMutation).reduce((sum, count) => sum + count, 0),
  75,
);
assert.equal(systems.get('INTENTLOCK').aggregate.unsafeExecutions, 10);
assert(heatmap.includes('75건을 손실, 위반 허용, 오거부로 해석하지 않는다'));

const latency = read('figures/visual-v2/latency.svg');
const latencyMarks = allMarks(latency);
assert.equal(latencyMarks.length, 9);
unique(latencyMarks, (mark) => `${mark['data-system']}|${mark['data-panel']}`);
for (const mark of latencyMarks) {
  assert.equal(mark.tag, 'rect');
  assert.equal(mark['data-metric'], 'meanLatencyMs');
  const row = systems.get(mark['data-system']);
  assert(row);
  const panel = mark['data-panel'];
  assert(['full', 'zoom'].includes(panel));
  const full = panel === 'full';
  const panelOrder = full ? order : order.filter((system) => system !== 'LLM_VERIFIER');
  assert(panelOrder.includes(row.system));
  const max = full ? 1500 : 0.5;
  const value = row.aggregate.meanLatencyMs;
  const width = (942 * value) / max;
  const y = (full ? 173 : 669) + panelOrder.indexOf(row.system) * 70 - 13;
  close(mark['data-value'], value);
  close(mark['data-axis-min'], 0);
  close(mark['data-axis-max'], max);
  close(mark['data-axis-x'], 284);
  close(mark['data-axis-width'], 942);
  for (const [attribute, expected] of [
    ['x', 284],
    ['y', y],
    ['width', width],
    ['height', 26],
  ]) {
    close(mark[attribute], expected, `Latency ${attribute}`);
    close(mark[`data-plot-${attribute}`], expected);
  }
  assert.equal(mark.fill, row.system === 'INTENTLOCK' ? '#43BDB1' : '#B0B8C4');
  assert(
    hasLabel(latency, 1392, y + 21, value.toFixed(3)),
    'Latency numeric label missing or misplaced',
  );
}
for (const system of order)
  assert(
    latencyMarks.some((mark) => mark['data-system'] === system && mark['data-panel'] === 'full'),
  );
for (const system of order.filter((system) => system !== 'LLM_VERIFIER'))
  assert(
    latencyMarks.some((mark) => mark['data-system'] === system && mark['data-panel'] === 'zoom'),
  );
assert(latency.includes('별도 확대 · 0–0.5') && latency.includes('축 범위 다름 · 언어모델 제외'));
assert(latency.includes('RPC·서명·사용자 확인·블록 확정 시간을 대표하지 않는다'));

const budget = read('figures/visual-v2/cumulative-budget.svg');
const budgetMarks = elements(budget, 'rect').filter(
  (rect) => rect['data-scope'] === 'illustrative',
);
assert.equal(budgetMarks.length, 8);
assert.equal(
  allMarks(budget).length,
  0,
  'Hypothetical budget must not be marked as experiment data',
);
for (const mark of budgetMarks) {
  close(mark['data-value'], 60);
  close(mark.width, Number(mark['data-value']) * 3.55, 'Budget proportional width');
  close(mark.height, 55);
  assert(['first', 'second', 'total-first', 'total-second', 'total'].includes(mark['data-stage']));
}
assert.equal(budgetMarks.filter((mark) => mark['data-status'] === 'rejected-proposal').length, 1);
assert(budget.includes('수치는 실험 측정값이 아니다') && budget.includes('오른쪽 실행 합계는 60'));

console.log(
  JSON.stringify(
    {
      status: 'PASS',
      bindings,
      checkedMarks: securityMarks.length + heatMarks.length + latencyMarks.length,
      confidenceIntervalLines: 30,
      hypotheticalBudgetBars: budgetMarks.length,
      commonHeatmapLegendCells: legend.length,
      tables: 9,
      tableDataRows: 33,
      references: 14,
      images: 6,
      sourceCaptions: 15,
      whitespaceWords: words,
      unicodeTokenEstimate: unicodeWords,
      originalEditionPreserved: true,
      experimentRerun: false,
      notionChangedByThisBuild: false,
      authorApproval: 'PENDING',
    },
    null,
    2,
  ),
);
