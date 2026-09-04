import { readFile, readdir } from 'node:fs/promises';
import { evaluateReviewGate, reviewDigest } from '../src/benchmark/review-gate.js';
import { z } from 'zod';

const packetInput: unknown = JSON.parse(
  await readFile('benchmark/reviews/double-review-20.json', 'utf8'),
);
const packet = z
  .object({ datasetVersion: z.string(), cases: z.array(z.object({ reviewId: z.string() })) })
  .loose()
  .parse(packetInput);
const dir = 'benchmark/labels/submissions';
const files = (
  await readdir(dir).catch((cause: unknown) => {
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return [];
    throw cause;
  })
)
  .filter((f) => f.endsWith('.json'))
  .sort();
const submissions: unknown[] = await Promise.all(
  files.map(async (f) => JSON.parse(await readFile(`${dir}/${f}`, 'utf8')) as unknown),
);
let adjudications: unknown;
try {
  adjudications = JSON.parse(
    await readFile('benchmark/labels/adjudications.json', 'utf8'),
  ) as unknown;
} catch (cause) {
  if (!(cause instanceof Error && 'code' in cause && cause.code === 'ENOENT')) throw cause;
}
const result = evaluateReviewGate(
  {
    datasetVersion: packet.datasetVersion,
    packetSha256: reviewDigest(packetInput),
    reviewIds: packet.cases.map((c) => c.reviewId),
  },
  submissions,
  adjudications,
);
console.log(JSON.stringify(result, null, 2));
if (result.status !== 'RECORDS_COMPLETE' && process.argv.includes('--require-complete'))
  process.exitCode = 1;
