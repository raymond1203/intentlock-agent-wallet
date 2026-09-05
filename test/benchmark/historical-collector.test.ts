import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  boundCollectorSha256,
  reconstructBoundCollectorSha256,
} from '../../scripts/m2-execution/historical-collector.js';
import {
  EXECUTION_COLLECTOR_PATHS,
  executionCollectorSha256,
} from '../../scripts/m2-execution/provenance.js';

const PROVENANCE_PATH = 'scripts/m2-execution/provenance.ts';
const SOURCE_COMMIT = 'a0cca37764d3267929f7b74404393c4a1115fc78';
const RECORDED_COLLECTOR_SHA256 =
  'd3ca47765b9de0aa86d88a55d0a048e6708692711f82a7778c14ba147fa50474';
const provenanceSource = readFileSync(PROVENANCE_PATH);
const sourceConfig = readFileSync('tsconfig.json');

function fixtures(): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  for (const path of EXECUTION_COLLECTOR_PATHS) {
    files.set(path, Buffer.from(path.endsWith('.ts') ? 'export const sample = 1;\n' : path));
  }
  files.set(PROVENANCE_PATH, provenanceSource);
  files.set('tsconfig.json', sourceConfig);
  files.set(
    'package.json',
    Buffer.from(JSON.stringify({ type: 'module', devDependencies: { typescript: ts.version } })),
  );
  return files;
}

function readFixture(files: Map<string, Uint8Array>, path: string): Promise<Uint8Array> {
  const bytes = files.get(path);
  return bytes
    ? Promise.resolve(bytes)
    : Promise.reject(new Error(`missing historical file ${path}`));
}

function reconstruct(files: Map<string, Uint8Array>, installedTypeScriptVersion = ts.version) {
  return reconstructBoundCollectorSha256({
    readHistoricalFile: (path) => readFixture(files, path),
    currentProvenanceSource: provenanceSource,
    installedTypeScriptVersion,
  });
}

describe('historical M2 collector reconstruction', () => {
  it('reads every bound source path but never accepts historical dist files', async () => {
    const files = fixtures();
    const reads: string[] = [];
    const digest = await reconstructBoundCollectorSha256({
      readHistoricalFile: (path) => {
        reads.push(path);
        return readFixture(files, path);
      },
      currentProvenanceSource: provenanceSource,
      installedTypeScriptVersion: ts.version,
    });
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(reads.sort()).toEqual([...EXECUTION_COLLECTOR_PATHS].sort());
    files.set('dist/src/domain/action-ir.js', Buffer.from('forged historical runtime'));
    await expect(reconstruct(files)).resolves.toBe(digest);
  });

  it('changes the digest when a historical source byte changes', async () => {
    const files = fixtures();
    const original = await reconstruct(files);
    files.set('src/domain/action-ir.ts', Buffer.from('export const sample = 2;\n'));
    await expect(reconstruct(files)).resolves.not.toBe(original);
  });

  it('does not authenticate a digest made from tampered emitted runtime bytes', async () => {
    const files = fixtures();
    const expected = await reconstruct(files);
    // Match the independently known compiler profile, then corrupt one runtime after emit.
    for (const path of EXECUTION_COLLECTOR_PATHS) {
      if (!path.endsWith('.ts')) continue;
      const bytes = files.get(path);
      if (!bytes) throw new Error('source fixture missing');
      const output = ts.transpileModule(Buffer.from(bytes).toString('utf8'), {
        fileName: path,
        compilerOptions: {
          target: ts.ScriptTarget.ES2023,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          verbatimModuleSyntax: true,
          sourceMap: true,
          declaration: true,
          rewriteRelativeImportExtensions: true,
        },
      });
      files.set(`dist/${path.slice(0, -3)}.js`, Buffer.from(output.outputText));
    }
    const beforeTamper = await executionCollectorSha256((path) => readFixture(files, path));
    expect(beforeTamper).toBe(expected);
    files.set('dist/src/domain/action-ir.js', Buffer.from('export const sample = 999;\n'));
    const tampered = await executionCollectorSha256((path) => readFixture(files, path));
    expect(tampered).not.toBe(expected);
    await expect(reconstruct(files)).resolves.toBe(expected);
  });

  it('rejects changed historical or current provenance algorithm bytes', async () => {
    const files = fixtures();
    files.set(PROVENANCE_PATH, Buffer.concat([provenanceSource, Buffer.from('\n// changed')]));
    await expect(reconstruct(files)).rejects.toThrow('provenance algorithm or path list');
    await expect(
      reconstructBoundCollectorSha256({
        readHistoricalFile: (path) => readFixture(fixtures(), path),
        currentProvenanceSource: Buffer.from('different current provenance'),
        installedTypeScriptVersion: ts.version,
      }),
    ).rejects.toThrow('provenance algorithm or path list');
  });

  it.each(['0.0.0', `^${ts.version}`, undefined])(
    'rejects historical TypeScript version %s instead of using another compiler',
    async (version) => {
      const files = fixtures();
      files.set(
        'package.json',
        Buffer.from(JSON.stringify({ type: 'module', devDependencies: { typescript: version } })),
      );
      await expect(reconstruct(files)).rejects.toThrow('TypeScript version');
    },
  );

  it('rejects an installed package version different from the loaded compiler', async () => {
    await expect(reconstruct(fixtures(), '0.0.0')).rejects.toThrow('TypeScript version');
  });

  it('rejects a non-ESM historical package', async () => {
    const files = fixtures();
    files.set(
      'package.json',
      Buffer.from(
        JSON.stringify({ type: 'commonjs', devDependencies: { typescript: ts.version } }),
      ),
    );
    await expect(reconstruct(files)).rejects.toThrow('type module');
  });

  it('rejects missing historical source rather than falling back to the worktree', async () => {
    const files = fixtures();
    files.delete('src/domain/action-ir.ts');
    await expect(reconstruct(files)).rejects.toThrow('missing historical file');
  });

  it.each([
    {},
    { compilerOptions: {} },
    { extends: './unbound.json', compilerOptions: {} },
    { compilerOptions: { module: 'CommonJS' } },
    { compilerOptions: { module: 'NodeNext', sourceMap: false } },
  ])('rejects missing or unsupported historical config %j', async (config) => {
    const files = fixtures();
    files.set('tsconfig.json', Buffer.from(JSON.stringify(config)));
    await expect(reconstruct(files)).rejects.toThrow(/compilerOptions|unsupported/);
  });

  it('rejects a missing tsconfig and invalid TypeScript source', async () => {
    const missing = fixtures();
    missing.delete('tsconfig.json');
    await expect(reconstruct(missing)).rejects.toThrow('missing historical file');
    const malformed = fixtures();
    malformed.set('src/domain/action-ir.ts', Buffer.from('export const = ;'));
    await expect(reconstruct(malformed)).rejects.toThrow('cannot be transpiled deterministically');
  });

  it.each(['HEAD', SOURCE_COMMIT.slice(0, 12), `${SOURCE_COMMIT}:package.json`, 'f'.repeat(39)])(
    'rejects unbound ref %s',
    async (source) => {
      await expect(boundCollectorSha256(source)).rejects.toThrow('full lowercase 40-character');
    },
  );

  it('rejects an authenticated Git blob where a commit is required', async () => {
    const blob = execFileSync(
      'git',
      ['--no-replace-objects', 'rev-parse', `HEAD:${PROVENANCE_PATH}`],
      {
        encoding: 'utf8',
        windowsHide: true,
      },
    ).trim();
    await expect(boundCollectorSha256(blob)).rejects.toThrow('commit object');
  });

  it('reconstructs the exact recorded source-plus-runtime digest from the bound Git commit', async () => {
    await expect(boundCollectorSha256(SOURCE_COMMIT)).resolves.toBe(RECORDED_COLLECTOR_SHA256);
  }, 30_000);
});
