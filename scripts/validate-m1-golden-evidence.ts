import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  M1GoldenEvidenceSchema,
  M1GoldenFixtureSchema,
  validateM1GoldenEvidence,
} from '../src/benchmark/m1-golden-evidence.js';

const MODULE_PARENT = resolve(import.meta.dirname, '..');
const ROOT = existsSync(resolve(MODULE_PARENT, 'package.json'))
  ? MODULE_PARENT
  : resolve(MODULE_PARENT, '..');
const FIXTURE_PATH = resolve(ROOT, 'benchmark/scenarios/golden/scenarios.json');

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value) throw new Error(`${name} requires a path`);
  return value;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(resolve(ROOT, path), 'utf8'));
}

function main(): void {
  const evidencePath = argument('--evidence');
  if (!evidencePath) throw new Error('--evidence is required');
  const fixtureRaw = readFileSync(FIXTURE_PATH, 'utf8');
  const fixture = M1GoldenFixtureSchema.parse(JSON.parse(fixtureRaw));
  const fixtureSha256 = createHash('sha256').update(fixtureRaw).digest('hex');
  const requireClean = !process.argv.includes('--allow-dirty');
  const expectedCommitSha = process.argv.includes('--ignore-current-commit')
    ? undefined
    : execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const evidence = validateM1GoldenEvidence(readJson(evidencePath), fixture, {
    fixtureSha256,
    requireClean,
    ...(expectedCommitSha ? { expectedCommitSha } : {}),
  });
  const comparePath = argument('--compare');
  if (comparePath) {
    const compared = validateM1GoldenEvidence(readJson(comparePath), fixture, {
      fixtureSha256,
      requireClean: true,
      expectedCommitSha: evidence.source.commitSha,
    });
    if (
      evidence.source.runnerSha256 !== compared.source.runnerSha256 ||
      evidence.fork.fingerprintDigest.toLowerCase() !==
        compared.fork.fingerprintDigest.toLowerCase() ||
      evidence.summary.stableDecisionDigest.toLowerCase() !==
        compared.summary.stableDecisionDigest.toLowerCase()
    ) {
      throw new Error(
        'independent M1 Golden runs do not have the same provenance and stable digest',
      );
    }
    process.stdout.write(
      `M1 Golden independent runs agree: ${evidence.summary.stableDecisionDigest}\n`,
    );
    return;
  }
  const parsed = M1GoldenEvidenceSchema.parse(evidence);
  process.stdout.write(
    `M1 Golden evidence valid: 5 real ALLOW receipts, 5 pre-sign blocks; ${parsed.summary.stableDecisionDigest}\n`,
  );
}

try {
  main();
} catch (error: unknown) {
  process.stderr.write(
    `M1 Golden evidence invalid: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
