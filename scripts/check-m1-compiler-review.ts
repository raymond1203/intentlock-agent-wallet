import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  evaluateCompilerReviewSubmission,
  validateCompilerReviewPacket,
} from '../src/intent/compiler-review.js';

const MODULE_PARENT = resolve(import.meta.dirname, '..');
const ROOT = existsSync(resolve(MODULE_PARENT, 'package.json'))
  ? MODULE_PARENT
  : resolve(MODULE_PARENT, '..');
const DEFAULT_PACKET = 'benchmark/reviews/m1/compiler-labeling.packet.json';

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
  const packetPath = argument('--packet') ?? DEFAULT_PACKET;
  const packetValue = readJson(packetPath);
  const packet = validateCompilerReviewPacket(packetValue);
  const submissionPath = argument('--submission');
  if (!submissionPath) {
    process.stdout.write(
      `M1 compiler packet valid: ${String(packet.cases.length)} blind cases, sha256 ${packet.packetSha256}\n`,
    );
    return;
  }
  const report = evaluateCompilerReviewSubmission(packet, readJson(submissionPath));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (process.argv.includes('--require-agreement') && report.disagreementCount > 0) {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error: unknown) {
  process.stderr.write(
    `M1 compiler review invalid: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
