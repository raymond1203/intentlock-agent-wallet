import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { format } from 'prettier';
import { parseDocument } from 'yaml';

import {
  AblationManifestSchema,
  ReadyAblationManifestSchema,
} from '../src/experiments/ablations.js';
import { EvaluationCaseManifestSchema } from '../src/experiments/case-manifest.js';
import { computeFreezeDigests } from '../src/experiments/freeze-digests.js';
import {
  FROZEN_ABLATION_CONFIG_PATH,
  FROZEN_EVALUATION_CONFIG_PATH,
  resolveRepoRelativeJson,
  sha256Source,
  validateFreezeReviewCaseManifest,
  validateM2ReadyForFreeze,
} from '../src/experiments/freeze-gates.js';
import {
  FrozenEvalConfigSchema,
  ReadyFrozenEvalConfigSchema,
} from '../src/experiments/protocol.js';
import { validateFreezeReviewEvidenceFromRepository } from './freeze-review-evidence.js';

function argument(name: string): string | undefined {
  return process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
}

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

const configArgument = argument('--config') ?? FROZEN_EVALUATION_CONFIG_PATH;
if (configArgument.replaceAll('\\', '/') !== FROZEN_EVALUATION_CONFIG_PATH) {
  throw new Error('freeze requires the canonical evaluation config');
}
const configPath = resolve(configArgument);
const ablationConfigPath = resolve(FROZEN_ABLATION_CONFIG_PATH);
const reviewRecordArgument = argument('--review-record');
if (!reviewRecordArgument) {
  throw new Error(
    '--review-record must point to an actual repository-relative human review JSON file',
  );
}
const repositoryRoot = resolve('.');
const reviewLocation = resolveRepoRelativeJson(repositoryRoot, reviewRecordArgument);
const head = git('rev-parse', 'HEAD');
const reviewSource = await readFile(reviewLocation.absolutePath, 'utf8');
const { review, artifactPaths: dryRunArtifactPaths } =
  await validateFreezeReviewEvidenceFromRepository({
    repositoryRoot,
    reviewInput: JSON.parse(reviewSource),
    reviewedCommit: head,
    requireTrackedArtifacts: false,
  });
const permittedUntrackedPaths = new Set(
  [reviewLocation.path, ...dryRunArtifactPaths].map((path) => `?? ${path}`),
);
const dirtyEntries = git('status', '--porcelain', '--untracked-files=all')
  .split(/\r?\n/u)
  .filter(Boolean)
  .filter((line) => !permittedUntrackedPaths.has(line));
if (dirtyEntries.length > 0) {
  throw new Error(
    'freeze requires a clean candidate except for the completed review and its exact three bound dry-run artifacts; all four must be committed with the two frozen manifests',
  );
}

const source = await readFile(configPath, 'utf8');
const document = parseDocument(source);
const candidate = FrozenEvalConfigSchema.parse(document.toJS());
const ablationSource = await readFile(ablationConfigPath, 'utf8');
const candidateAblation = AblationManifestSchema.parse(JSON.parse(ablationSource));
if (candidate.status !== 'CANDIDATE_UNFROZEN') {
  throw new Error('only a CANDIDATE_UNFROZEN config can be frozen');
}
if (candidateAblation.status !== 'CANDIDATE_UNFROZEN') {
  throw new Error('only a CANDIDATE_UNFROZEN ablation manifest can be jointly frozen');
}
const caseManifestSource = await readFile(resolve(candidate.dataset.caseManifest), 'utf8');
const caseManifest = EvaluationCaseManifestSchema.parse(JSON.parse(caseManifestSource));
validateFreezeReviewCaseManifest(review.reviewedCaseIds, caseManifest.entries);
try {
  execFileSync(process.execPath, ['dist/scripts/validate-m2.js', '--check'], { stdio: 'pipe' });
} catch {
  throw new Error(
    'M2 generated artifacts do not match their execution, oracle, and human-review evidence',
  );
}
const m2Location = resolveRepoRelativeJson(repositoryRoot, candidate.dataset.m2Validation);
validateM2ReadyForFreeze(JSON.parse(await readFile(m2Location.absolutePath, 'utf8')));
const digests = await computeFreezeDigests(candidate);
const frozenAt = new Date().toISOString();
document.set('status', 'FROZEN');
document.setIn(['freeze', 'gitCommit'], head);
for (const [key, value] of Object.entries(digests)) document.setIn(['freeze', key], value);
document.setIn(['freeze', 'frozenAt'], frozenAt);
document.setIn(['freeze', 'humanReviewer'], review.reviewerPseudonym);
document.setIn(['freeze', 'humanReviewPath'], reviewLocation.path);
document.setIn(['freeze', 'humanReviewDigestSha256'], sha256Source(reviewSource));

const rendered = document.toString({ lineWidth: 100 });
ReadyFrozenEvalConfigSchema.parse(parseDocument(rendered).toJS());
const frozenAblation = ReadyAblationManifestSchema.parse({
  ...candidateAblation,
  status: 'FROZEN',
  freeze: {
    gitCommit: head,
    frozenAt,
    humanReviewer: review.reviewerPseudonym,
  },
});
const renderedAblation = await format(JSON.stringify(frozenAblation), { parser: 'json' });
await Promise.all([
  writeFile(configPath, rendered, 'utf8'),
  writeFile(ablationConfigPath, renderedAblation, 'utf8'),
]);
console.log(
  JSON.stringify({
    status: 'FROZEN',
    config: configPath,
    ablationConfig: ablationConfigPath,
    frozenAt,
    reviewRecord: reviewLocation.path,
    reviewDigestSha256: sha256Source(reviewSource),
    next: 'Commit the human review record, its three bound dry-run artifacts, and both frozen manifests together as the six-file direct child of the reviewed candidate, then run evaluation:run from that clean freeze commit.',
  }),
);
