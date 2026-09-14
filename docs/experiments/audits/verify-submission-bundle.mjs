/** Read-only publication verification; no production analyzer or API calls. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path));
const json = (path) => JSON.parse(read(path).toString('utf8'));
const hash = (path) => createHash('sha256').update(read(path)).digest('hex');
let verifiedFiles = 0;
function verify(path, expected) {
  const local = relative(root, resolve(root, path));
  assert(!local.startsWith('..') && !isAbsolute(local), 'Unexpected external artifact path');
  assert.equal(hash(path), expected, `Artifact hash mismatch: ${path}`);
  verifiedFiles++;
}

const assembly = json('artifacts/submission-manifest.json');
verify(assembly.source.path, assembly.source.sha256);
verify(assembly.output.path, assembly.output.sha256);
for (const [path, expected] of Object.entries(assembly.analysis.artifacts)) verify(path, expected);
assert.equal(assembly.reviewProtocol.finalAuthorApproval, 'PENDING');
assert.equal(assembly.reviewProtocol.independentHumanReviewClaim, false);

const publication = json('artifacts/submission-ko-manifest.json');
assert.equal(publication.artifactType, 'NOTION_EDITORIAL_MIRROR');
assert.equal(publication.source.kind, 'AUTHOR_EDITED_NOTION');
assert.equal(publication.source.privateMetadataExcluded, true);
assert.equal(publication.source.pageIdentifierPublished, false);
assert.equal(publication.transformation.contentEditsDuringExport, false);
assert.equal(publication.transformation.legacyAssemblyNotRegenerated, true);
for (const group of [publication.inputs, publication.outputs])
  for (const [path, expected] of Object.entries(group)) verify(path, expected);
assert.equal(publication.contest.registeredTeamSize, 2);
assert.equal(publication.contest.track, 'MetaMask');
assert.equal(publication.contest.userConfirmedDeadlineDate, '2026-09-06');
assert.equal(publication.reviewProtocol.humanReviewers, 1);
assert.equal(publication.reviewProtocol.finalAuthorApproval, 'PENDING');
assert.equal(publication.reviewProtocol.independentHumanReviewClaim, false);
assert.equal(publication.reviewProtocol.notionSubmission, 'PENDING');
assert.equal(publication.publication.notionWordCountVerified, true);
assert.equal(publication.publication.notionWordCount, 7089);
assert.equal(publication.publication.notionWordCountObservedDate, '2026-09-14');

const localized = read('paper/submission-ko.md').toString('utf8');
assert(
  localized.includes('팀 EVM 주소:\n\n팀 인원수: 2명\n\n참가 트랙: MetaMask\n\n학회 코드 넘버:\n'),
);
const takeaways = localized.split('### Key Takeaways\n\n')[1]?.split('\n\n')[0];
assert.equal((takeaways?.match(/^- /gm) ?? []).length, 3);
assert(!/^####/m.test(localized));
assert(localized.includes('비적대적 사례 거부율 (분모 160)'));
assert(localized.includes('서명 전 판단 유보율 (분모 400)'));
assert(localized.includes('확인 요구 건수 (400개 중)'));
// This is the reviewed Notion edition, not a fresh run of the historical localizer.
// Its 32 rows were checked against the private Notion snapshot and recorded results.
const tableData = [...localized.matchAll(/^\|[^\n]*\n(?:\|[^\n]*(?:\n|$))+/gm)].map((match) =>
  match[0]
    .trim()
    .split(/\r?\n/)
    .slice(2)
    .map((row) =>
      row
        .split('|')
        .slice(1, -1)
        .map((cell) =>
          cell
            .trim()
            .replace(/\[([^\]]+)\]\(https?:[^)]+\)/gu, '$1')
            .replace(/\\([\\`*_[\]])/gu, '$1'),
        ),
    ),
);
assert.equal(tableData.length, 9);
assert.equal(tableData.flat().length, 32);
assert.equal(
  createHash('sha256').update(JSON.stringify(tableData)).digest('hex'),
  'e79996999797dad02dce8d5f3c9834206cd46f0757f0f0e602874b9f117b64f3',
  'Reviewed Notion table data changed',
);
assert.equal(
  publication.integrity.tableDataSha256,
  createHash('sha256').update(JSON.stringify(tableData)).digest('hex'),
);
assert.deepEqual(tableData.at(-1), [['40개', '160개', '40건', '0회']]);
const urls = (text) => text.match(/https?:\/\/[^\s)]+/gu) ?? [];
assert.equal(
  createHash('sha256')
    .update(JSON.stringify(urls(localized)))
    .digest('hex'),
  publication.integrity.citationUrlsSha256,
  'Notion citation URL order changed',
);
const references = (text) =>
  text
    .split('## 참고문헌')[1]
    .split(/\r?\n/u)
    .filter((line) => /^\d+\. /u.test(line));
assert.equal(references(localized).length, 14);

const forbidden = [
  /^\s*(?:```|~~~|>)/mu,
  /\{\{[A-Z_]+\}\}/u,
  /localhost|[A-Z]:[/\\]Users[/\\]|\/Users\/|\/home\//iu,
  /(?:app\.)?notion\.(?:com|so)|X-Amz-/iu,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/u,
  /\b0x[0-9a-f]{40}\b/iu,
];
for (const pattern of forbidden) assert(!pattern.test(localized), 'Forbidden publication pattern');
const words =
  localized.replace(/https?:\/\/\S+/gu, ' ').match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu)
    ?.length ?? 0;
assert(words <= 13000, 'Local Unicode token estimate exceeds word limit');
const images = [...localized.matchAll(/!\[[^\]]*\]\(([^)]+)\)/gu)].map((match) => match[1]);
assert.equal(images.length, 4);
for (const image of images) {
  assert(/^\.\.\/figures\/editorial\/[a-z-]+\.png$/u.test(image));
  const bytes = read(`paper/${image}`);
  assert(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
  const asset = publication.figureAssets.find((entry) => entry.path === image.slice(3));
  assert(asset && asset.byteIdentical);
  assert.equal(bytes.readUInt32BE(16), asset.width);
  assert.equal(bytes.readUInt32BE(20), asset.height);
  assert.equal(hash(asset.path), asset.sha256);
}

for (const suffix of ['01', '02']) {
  const base = `experiments/results/operational-recovery-solo-v0.4.0-${suffix}`;
  const summary = json(`${base}/summary.json`);
  verify(`${base}/raw.jsonl`, summary.rawSha256);
  verify(`${base}/manifest.json`, summary.manifestSha256);
  for (const [path, expected] of Object.entries(summary.originalPrimaryArtifactHashes))
    verify(path, expected);
  assert.equal(summary.excludedFromPrimaryResults, true);
  assert.equal(summary.latencyBenchmarkEligible, false);
}
const last = json('experiments/results/operational-recovery-solo-v0.4.0-02/summary.json');
assert.equal(last.availableOutputsAcrossPrimaryAndBothRecoveryRuns, 400);
assert.equal(last.primaryFirstAttemptFailuresUnchanged, 92);
for (const [path, expected] of Object.entries(last.previousRecoveryArtifactHashes))
  verify(path, expected);

console.log(
  JSON.stringify(
    {
      status: 'PASS',
      verifiedFileBindings: verifiedFiles,
      manuscript: 'paper/submission-ko.md',
      manuscriptSha256: hash('paper/submission-ko.md'),
      localUnicodeTokenEstimate: words,
      referenceEntries: 14,
      imageFiles: images.length,
      laterOutputsAvailable: 400,
      firstAttemptLlmFailuresPreserved: 92,
      finalAuthorApproval: 'PENDING',
      notionWordCount: publication.publication.notionWordCount,
      notionWordCountBasis: 'Recorded UI observation on 2026-09-14, not a live query by this audit',
      notionSubmission: 'PENDING',
      publicationSource: 'Notion editorial mirror; private metadata excluded',
      scope:
        'Byte integrity and format, not independent truth of research claims or private identity approval',
    },
    null,
    2,
  ),
);
