import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

import { format } from 'prettier';

import {
  assemblePaperSource,
  PAPER_ANALYSIS_ARTIFACT_PATHS,
  type PaperAnalysisBundle,
} from '../src/submission/paper-assembly.js';

function argument(name: string): string | undefined {
  return process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
}

function repositoryPath(value: string, label: string): { absolute: string; relative: string } {
  const root = resolve('.');
  const absolute = resolve(value);
  const repositoryRelative = relative(root, absolute).replaceAll('\\', '/');
  if (
    !repositoryRelative ||
    repositoryRelative === '..' ||
    repositoryRelative.startsWith('../') ||
    repositoryRelative.includes('/../')
  ) {
    throw new Error(`${label} must be a file inside the repository`);
  }
  return { absolute, relative: repositoryRelative };
}

const sourceArgument = argument('--source');
if (!sourceArgument) {
  throw new Error(
    '--source=paper/final-source.md is required; create it from the reviewed drafts after real results exist',
  );
}
const outputArgument = argument('--out') ?? 'paper/final.md';
const manifestArgument = argument('--manifest') ?? 'artifacts/submission-manifest.json';
const sourcePath = repositoryPath(sourceArgument, 'paper source');
const outputPath = repositoryPath(outputArgument, 'paper output');
const manifestPath = repositoryPath(manifestArgument, 'paper manifest');
if (sourcePath.absolute === outputPath.absolute) {
  throw new Error('paper source and output must be different files');
}
if (
  manifestPath.absolute === outputPath.absolute ||
  manifestPath.absolute === sourcePath.absolute
) {
  throw new Error('paper manifest must be different from the source and output files');
}

const bundleEntries = await Promise.all(
  Object.entries(PAPER_ANALYSIS_ARTIFACT_PATHS).map(async ([key, path]) => [
    key,
    await readFile(resolve(path), 'utf8'),
  ]),
);
const bundle = Object.fromEntries(bundleEntries) as PaperAnalysisBundle;
const assembled = assemblePaperSource(await readFile(sourcePath.absolute, 'utf8'), bundle);

const manifest = {
  schemaVersion: '0.1',
  generatedAt: new Date().toISOString(),
  source: { path: sourcePath.relative, sha256: assembled.sourceSha256 },
  output: {
    path: outputPath.relative,
    sha256: assembled.outputSha256,
    wordCount: assembled.wordCount,
    maxWords: assembled.maxWords,
    wordCountMethod: assembled.wordCountMethod,
    notionWordCountConfirmationRequired: assembled.notionWordCountConfirmationRequired,
  },
  analysis: {
    primaryRunId: assembled.primaryRunId,
    ablationRunId: assembled.ablationRunId,
    adaptiveRunId: assembled.adaptiveRunId,
    analysisCommit: assembled.analysisCommit,
    artifacts: assembled.artifactSha256,
  },
  humanGates: {
    privateIdentityAudit: 'REQUIRED_SEPARATELY',
    notionPreviewAndWordCount: 'REQUIRED_SEPARATELY',
    independentFinalChecklists: 'REQUIRED_SEPARATELY',
    finalSubmissionTimestamp: 'PRIVATE_EXTERNAL_RECORD',
  },
};

if (process.argv.includes('--check')) {
  console.log(
    JSON.stringify({
      status: 'PAPER_SOURCE_AND_ANALYSIS_BUNDLE_VALID',
      output: outputPath.relative,
      wordCountEstimate: assembled.wordCount,
      notionWordCountConfirmationRequired: true,
    }),
  );
  process.exit(0);
}

await mkdir(dirname(outputPath.absolute), { recursive: true });
await mkdir(dirname(manifestPath.absolute), { recursive: true });
await writeFile(outputPath.absolute, assembled.markdown, 'utf8');
await writeFile(
  manifestPath.absolute,
  await format(JSON.stringify(manifest), { parser: 'json' }),
  'utf8',
);
console.log(
  JSON.stringify({
    status: 'PAPER_ASSEMBLED',
    output: outputPath.relative,
    manifest: manifestPath.relative,
    wordCountEstimate: assembled.wordCount,
    notionWordCountConfirmationRequired: true,
  }),
);
