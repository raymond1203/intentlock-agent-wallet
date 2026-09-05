import { readFile, readdir } from 'node:fs/promises';
import {
  AI_BENCHMARK_REVIEW_PATH,
  evaluateAiAssistedReviewGate,
  evaluateReviewGate,
  REVIEW_PROTOCOL_PATH,
  ReviewProtocolSchema,
  reviewDigest,
} from '../src/benchmark/review-gate.js';
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
const protocol = ReviewProtocolSchema.parse(
  JSON.parse(await readFile(REVIEW_PROTOCOL_PATH, 'utf8')) as unknown,
);
const aiReview = JSON.parse(
  await readFile(AI_BENCHMARK_REVIEW_PATH, 'utf8').catch((cause: unknown) => {
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return 'null';
    throw cause;
  }),
) as unknown;
const aiResult = evaluateAiAssistedReviewGate(
  {
    datasetVersion: packet.datasetVersion,
    packetSha256: reviewDigest(packetInput),
    reviewIds: packet.cases.map((c) => c.reviewId),
  },
  protocol,
  aiReview,
);
console.log(
  JSON.stringify({ protocol, independentHumanReview: result, aiAssistedReview: aiResult }, null, 2),
);
// Legacy completion still means two actual human submissions; the explicit flag is distinct.
if (result.status !== 'RECORDS_COMPLETE' && process.argv.includes('--require-complete'))
  process.exitCode = 1;
if (
  process.argv.includes('--require-experiment-ready') &&
  (protocol.mode === 'SOLO_AI_ASSISTED'
    ? aiResult.recordStatus !== 'COMPLETE_AI_ASSISTED'
    : result.status !== 'RECORDS_COMPLETE')
)
  process.exitCode = 1;
