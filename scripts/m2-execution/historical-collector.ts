import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import ts from 'typescript';

import { EXECUTION_COLLECTOR_PATHS, executionCollectorSha256 } from './provenance.js';

const executeFile = promisify(execFile);
const require = createRequire(import.meta.url);
const PROVENANCE_PATH = 'scripts/m2-execution/provenance.ts';

// Only the recorded NodeNext/ESM collector profile is supported. Additional emit-affecting
// options or config inheritance require an explicit reconstruction review, not a guessed build.
const SUPPORTED_COMPILER_OPTIONS = {
  target: 'ES2023',
  module: 'NodeNext',
  moduleResolution: 'NodeNext',
  lib: ['ES2023', 'DOM'],
  strict: true,
  noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true,
  noImplicitOverride: true,
  noFallthroughCasesInSwitch: true,
  noUnusedLocals: true,
  noUnusedParameters: true,
  verbatimModuleSyntax: true,
  declaration: true,
  sourceMap: true,
  outDir: 'dist',
  rootDir: '.',
  types: ['node'],
  allowImportingTsExtensions: true,
  rewriteRelativeImportExtensions: true,
} as const;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function utf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function jsonObject(bytes: Uint8Array, path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(utf8(bytes));
  if (!object(parsed)) throw new Error(`historical collector ${path} must be a JSON object`);
  return parsed;
}

function compilerOptions(config: Record<string, unknown>): ts.CompilerOptions {
  if (Object.keys(config).some((key) => !['compilerOptions', 'include', 'exclude'].includes(key))) {
    throw new Error('historical collector tsconfig has unsupported inheritance or configuration');
  }
  const configured = config.compilerOptions;
  if (!object(configured)) throw new Error('historical collector compilerOptions are missing');
  if (
    Object.keys(configured).length !== Object.keys(SUPPORTED_COMPILER_OPTIONS).length ||
    Object.entries(SUPPORTED_COMPILER_OPTIONS).some(
      ([key, expected]) => JSON.stringify(configured[key]) !== JSON.stringify(expected),
    )
  ) {
    throw new Error('historical collector compilerOptions do not match the supported ESM profile');
  }
  const converted = ts.convertCompilerOptionsFromJson(configured, '.');
  if (converted.errors.length) throw new Error('historical collector compilerOptions are invalid');

  // transpileModule does not discover package.json's "type" for NodeNext. The validated package
  // is ESM, so select ESM emit explicitly. Bundler resolution avoids NodeNext's option-pair
  // diagnostic in this single-file operation; no imports are resolved or executed here.
  return {
    ...converted.options,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  };
}

export interface HistoricalCollectorInputs {
  readHistoricalFile: (path: string) => Promise<Uint8Array>;
  currentProvenanceSource: Uint8Array;
  installedTypeScriptVersion: string;
}

/** Reconstructs only source and compiler output bytes; it never executes historical project code. */
export async function reconstructBoundCollectorSha256(
  input: HistoricalCollectorInputs,
): Promise<string> {
  const files = new Map<string, Uint8Array>();
  await Promise.all(
    EXECUTION_COLLECTOR_PATHS.map(async (path) => {
      files.set(path, await input.readHistoricalFile(path));
    }),
  );
  const file = (path: string): Uint8Array => {
    const bytes = files.get(path);
    if (!bytes) throw new Error(`historical collector file is missing: ${path}`);
    return bytes;
  };
  if (!Buffer.from(file(PROVENANCE_PATH)).equals(Buffer.from(input.currentProvenanceSource))) {
    throw new Error('historical collector provenance algorithm or path list has changed');
  }
  const historicalPackage = jsonObject(file('package.json'), 'package.json');
  if (historicalPackage.type !== 'module') {
    throw new Error('historical collector package must declare type module');
  }
  const dependencies = historicalPackage.devDependencies;
  const historicalVersion = object(dependencies) ? dependencies.typescript : undefined;
  if (
    typeof historicalVersion !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(historicalVersion) ||
    historicalVersion !== input.installedTypeScriptVersion ||
    input.installedTypeScriptVersion !== ts.version
  ) {
    throw new Error(
      'historical collector TypeScript version does not match the installed compiler',
    );
  }
  const options = compilerOptions(jsonObject(file('tsconfig.json'), 'tsconfig.json'));
  for (const path of EXECUTION_COLLECTOR_PATHS) {
    if (!path.endsWith('.ts')) continue;
    const output = ts.transpileModule(utf8(file(path)), {
      fileName: path,
      compilerOptions: options,
      reportDiagnostics: true,
    });
    if (
      output.diagnostics?.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    ) {
      throw new Error(`historical collector cannot be transpiled deterministically: ${path}`);
    }
    files.set(`dist/${path.slice(0, -3)}.js`, Buffer.from(output.outputText, 'utf8'));
  }
  return executionCollectorSha256((path) => Promise.resolve(file(path)));
}

/** Computes the expected digest from authenticated Git source, never from a stored artifact hash. */
export async function boundCollectorSha256(
  sourceCommit: string,
  repoRoot = process.cwd(),
): Promise<string> {
  if (!/^[a-f0-9]{40}$/.test(sourceCommit)) {
    throw new Error('historical collector requires a full lowercase 40-character commit SHA');
  }
  const root = resolve(repoRoot);
  const gitBytes = async (args: string[]): Promise<Buffer> => {
    const result = await executeFile('git', ['--no-replace-objects', '-C', root, ...args], {
      encoding: 'buffer',
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    return result.stdout;
  };
  if (utf8(await gitBytes(['cat-file', '-t', sourceCommit])).trim() !== 'commit') {
    throw new Error('historical collector source SHA does not identify a commit object');
  }
  const installedPackage = jsonObject(
    await readFile(require.resolve('typescript/package.json')),
    'installed TypeScript package.json',
  );
  if (typeof installedPackage.version !== 'string') {
    throw new Error('installed TypeScript package version is missing');
  }
  return reconstructBoundCollectorSha256({
    readHistoricalFile: (path) => gitBytes(['cat-file', 'blob', `${sourceCommit}:${path}`]),
    currentProvenanceSource: await readFile(resolve(root, PROVENANCE_PATH)),
    installedTypeScriptVersion: installedPackage.version,
  });
}
