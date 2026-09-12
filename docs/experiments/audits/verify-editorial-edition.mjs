/** Independent, read-only checks of editorial files and plotted numeric geometry. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';

const root = process.cwd();
const bytes = (p) => readFileSync(resolve(root, p));
const text = (p) => bytes(p).toString('utf8');
const json = (p) => JSON.parse(text(p));
const hash = (p) => createHash('sha256').update(bytes(p)).digest('hex');
const digest = (v) => createHash('sha256').update(v).digest('hex');
const m = json('artifacts/editorial-ko-manifest.json');
let bindings = 0;
for (const group of [m.inputs, m.outputs, m.scripts]) {
  for (const [p, expected] of Object.entries(group)) {
    const local = relative(root, resolve(root, p));
    assert(!local.startsWith('..') && !isAbsolute(local), 'External artifact path');
    assert.equal(hash(p), expected, `Changed artifact: ${p}`);
    bindings++;
  }
}
assert.equal(
  m.inputs['paper/submission-ko.md'],
  '4cce67ecdaa158519f0d004687fe6c923c6ff19a880bd4720a181d57d8ed0f1b',
);
const source = text('paper/submission-ko.md');
const manuscript = text('paper/editorial-ko.md');
const tables = [...manuscript.matchAll(/^\|[^\n]*\n(?:\|[^\n]*(?:\n|$))+/gm)].map((match) =>
  match[0]
    .trim()
    .split(/\r?\n/)
    .slice(2)
    .map((row) =>
      row
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    ),
);
assert.equal(tables.length, 9);
assert.equal(tables.flat().length, 33);
assert.equal(
  digest(JSON.stringify(tables)),
  '9a631183a61af5f3acddc23e27c4854bb0f348af06d32a981dcaceed00f6261e',
);
const urls = (s) => s.match(/https?:\/\/[^\s)]+/gu) ?? [];
assert.deepEqual(urls(manuscript), urls(source));
assert.equal(manuscript.split('## 참고문헌')[1], source.split('## 참고문헌')[1]);
assert.equal((manuscript.split('## 참고문헌')[1].match(/^\d+\. /gm) ?? []).length, 14);
assert(
  manuscript.includes('팀 EVM 주소:\n\n팀 인원수: 2명\n\n참가 트랙: MetaMask\n\n학회 코드 넘버:\n'),
);
assert.equal(
  (manuscript.split('### Key Takeaways\n\n')[1].split('\n\n')[0].match(/^- /gm) ?? []).length,
  3,
);
assert.equal((manuscript.match(/^Source: /gm) ?? []).length, 15);
for (const pattern of [
  /^\s*(?:```|~~~|>|####)/mu,
  /\{\{[A-Z_]+\}\}/u,
  /github\.com|localhost|[A-Z]:\\Users\\|\/Users\/|\/home\//iu,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/u,
  /\b0x[0-9a-f]{40}\b/iu,
])
  assert(!pattern.test(manuscript), `Forbidden publication pattern ${pattern}`);
const numeric = (s) =>
  new Set(
    s
      .replace(/https?:\/\/[^\s)]+/gu, '')
      .match(/(?<![\w])[+-]?\d+(?:,\d{3})*(?:\.\d+)*(?:%|\/\d+)?/g) ?? [],
  );
const observed = numeric(manuscript);
for (const n of numeric(source)) assert(observed.has(n), `Removed numeric fact token: ${n}`);
for (const fact of [
  '10/400',
  '66/400',
  '80/160',
  '53/160',
  '58/160',
  'HTTP 429',
  '92건',
  '23.00%',
  '47건',
  '107회',
  '0.1479204',
  'NON_PAIRED_NON_CAUSAL',
  '인공지능',
  '독립 인간',
])
  assert(manuscript.includes(fact), `Critical fact/caveat missing: ${fact}`);
const words =
  manuscript.replace(/https?:\/\/\S+/gu, ' ').match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu)
    ?.length ?? 0;
assert(words <= 13000);
const images = [...manuscript.matchAll(/!\[[^\]]*\]\(([^)]+)\)/gu)].map((v) => v[1]);
assert.equal(images.length, 6);
for (const p of images) {
  assert(p.startsWith('../figures/editorial/') && p.endsWith('.png'));
  assert.equal(bytes(`paper/${p}`).subarray(1, 4).toString('ascii'), 'PNG');
}

const result = json('paper/tables/results.json');
const order = ['NONE', 'GUARD_MODE', 'LLM_VERIFIER', 'PER_CALL_POLICY', 'INTENTLOCK'];
const systems = new Map(result.systems.map((r) => [r.system, r]));
const attrs = (tag) =>
  Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((v) => [v[1], v[2]]));
const marks = (svg) =>
  [...svg.matchAll(/<(?:rect|circle|g|text)\b[^>]*data-system="[^>]+>/g)].map((v) => ({
    raw: v[0],
    ...attrs(v[0]),
  }));
const close = (actual, expected) =>
  assert(
    Math.abs(Number(actual) - expected) < 1e-8,
    `Geometry/value mismatch ${actual} vs ${expected}`,
  );
let checkedMarks = 0;
for (const name of ['security-utility', 'error-taxonomy', 'latency']) {
  const svg = text(`figures/editorial/${name}.svg`);
  assert(!svg.includes('FOUR PILLARS') && !svg.includes('VALIDATED'));
  assert(svg.includes('정책 모형'), 'Guard Mode must be labelled an emulator');
  const plotted = marks(svg);
  assert.equal(
    plotted.length,
    name === 'security-utility' ? 20 : name === 'error-taxonomy' ? 19 : 9,
  );
  for (const p of plotted) {
    const row = systems.get(p['data-system']);
    assert(row, 'Unknown system');
    const a = row.aggregate;
    const metric = p['data-metric'];
    let expected;
    if (metric === 'errorsByMutationTotal')
      expected = Object.values(row.errorsByMutation).reduce((s, n) => s + n, 0);
    else if (metric.startsWith('errorsByMutation.'))
      expected = row.errorsByMutation[metric.slice('errorsByMutation.'.length)];
    else expected = a[metric];
    assert(Number.isFinite(expected));
    close(p['data-value'], expected);
    if (metric.endsWith('Rate')) {
      const ci = row[`${metric}95`];
      close(p['data-low'], ci.lower95);
      close(p['data-high'], ci.upper95);
      const benign = metric === 'benignCompletionRate';
      const denominator = benign ? a.benignTotal : a.total;
      const count = benign ? a.benignCompleted : a.unsafeExecutions;
      assert.equal(Number(p['data-denominator']), denominator);
      assert.equal(Number(p['data-count']), count);
      if (p.raw.startsWith('<circle')) {
        close(p.cx, (benign ? 938 : 366) + 430 * expected);
        close(p.cy, 373 + 96 * order.indexOf(row.system));
      }
      assert(svg.includes(`${count}/${denominator} · ${(expected * 100).toFixed(2)}%`));
    }
    if (p.raw.startsWith('<rect') && name === 'latency') {
      const max = p['data-panel'] === 'full' ? 1500 : 0.5;
      assert.equal(Number(p['data-axis-max']), max);
      assert(!(row.system === 'LLM_VERIFIER' && max === 0.5));
      close(p.x, 360);
      close(p.width, (848 * expected) / max);
      assert(svg.includes(`${expected.toFixed(3)} ms`));
    }
    if (p.raw.startsWith('<rect') && name === 'error-taxonomy') {
      close(p.x, 360);
      close(p.width, (360 * expected) / 400);
      assert.equal(Number(p['data-denominator']), 400);
      assert(svg.includes(`${expected}/400`));
    }
    checkedMarks++;
  }
  assert(order.every((system) => plotted.some((p) => p['data-system'] === system)));
}
const budget = text('figures/editorial/cumulative-budget.svg');
assert(marks(budget).every((p) => p['data-scope'] === 'illustrative'));
assert(budget.includes('실험 결과 아님'));
assert.equal(m.preserved.firstAttemptFailures, 92);
assert.equal(m.preserved.experimentRerun, false);
assert.equal(m.notionChanged, false);
assert.equal(m.authorApproval, 'PENDING');
assert.equal(m.publication.notionWordCountVerified, false);
const qaPath = 'docs/experiments/audits/editorial-visual-qa.json';
assert.equal(hash(qaPath), m.visualQa.qaRecordSha256);
const qa = json(qaPath);
assert.equal(qa.reviewerType, 'AI_ASSISTED');
assert.equal(m.visualQa.status, 'AI_RENDER_REVIEW_PASS');
for (const p of images) {
  const normalized = p.slice(3);
  assert.equal(qa.inspectedPngHashes[normalized], hash(normalized), `Stale visual QA: ${p}`);
}
console.log(
  JSON.stringify(
    {
      status: 'PASS',
      bindings,
      checkedMarks,
      tables: 9,
      tableDataRows: 33,
      references: 14,
      images: 6,
      unicodeTokenEstimate: words,
      originalEditionPreserved: true,
      aiVisualReview: 'PASS',
      authorApproval: 'PENDING',
      notionChanged: false,
    },
    null,
    2,
  ),
);
