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
for (const group of [publication.inputs, publication.outputs])
  for (const [path, expected] of Object.entries(group)) verify(path, expected);
verify(publication.transformation.script, publication.transformation.scriptSha256);
assert.equal(publication.contest.registeredTeamSize, 2);
assert.equal(publication.contest.track, 'MetaMask');
assert.equal(publication.contest.userConfirmedDeadlineDate, '2026-09-06');
assert.equal(publication.reviewProtocol.humanReviewers, 1);
assert.equal(publication.reviewProtocol.finalAuthorApproval, 'PENDING');
assert.equal(publication.reviewProtocol.independentHumanReviewClaim, false);
assert.equal(publication.publication.notionWordCountVerified, false);

const original = read('paper/final.md').toString('utf8');
const localized = read('paper/submission-ko.md').toString('utf8');
const urls = (text) => text.match(/https?:\/\/[^\s)]+/gu) ?? [];
assert.deepEqual(urls(localized), urls(original), 'Citation URL order changed');
const references = (text) =>
  text
    .split('## 참고문헌')[1]
    .split(/\r?\n/u)
    .filter((line) => /^\d+\. /u.test(line));
assert.deepEqual(references(localized), references(original), 'Reference entry changed');
assert.equal(references(localized).length, 14);

const forbidden = [
  /^\s*(?:```|~~~|>)/mu,
  /\{\{[A-Z_]+\}\}/u,
  /github\.com|localhost|[A-Z]:\\Users\\|\/Users\/|\/home\//iu,
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
  const bytes = read(`paper/${image}`);
  assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG');
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
      notionPreviewAndSubmission: 'NOT_VERIFIED',
      scope:
        'Byte integrity and format, not independent truth of research claims or private identity approval',
    },
    null,
    2,
  ),
);
