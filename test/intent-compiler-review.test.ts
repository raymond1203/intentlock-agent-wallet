import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CompilerReviewSubmissionSchema,
  evaluateCompilerReviewSubmission,
  materializeCompilerReviewCase,
  runCompilerReviewCase,
  validateCompilerReviewPacket,
} from '../src/intent/compiler-review.js';

const ROOT = resolve(import.meta.dirname, '..');
const PACKET_PATH = resolve(ROOT, 'benchmark/reviews/m1/compiler-labeling.packet.json');
const TEMPLATE_PATH = resolve(
  ROOT,
  'benchmark/reviews/m1/compiler-labeling.submission.template.json',
);

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('M1 compiler independent-review packet', () => {
  it('contains ten materializable natural-language cases and has a valid content hash', () => {
    const packet = validateCompilerReviewPacket(readJson(PACKET_PATH));
    expect(packet.cases).toHaveLength(10);
    expect(new Set(packet.cases.map((entry) => entry.reviewId)).size).toBe(10);
    for (const reviewCase of packet.cases) {
      expect(reviewCase.trustedUserText).toMatch(/[가-힣]/);
      const materialized = materializeCompilerReviewCase(packet, reviewCase);
      expect(materialized.candidate).toBeTypeOf('object');
      expect(materialized.fieldEvidence).toHaveLength(11);
    }
  });

  it('does not contain an answer key, author label, mutation name, or implementation outcome', () => {
    const raw = readFileSync(PACKET_PATH, 'utf8');
    expect(raw).not.toMatch(
      /"(expectedDecision|expectedCode|authorDecision|authorLabel|mutation|implementationResult|implementationDecision)"/,
    );
    expect(raw).not.toContain('compiler-gold.json');
  });

  it('rejects a packet whose content changes without a new packet hash', () => {
    const packet = readJson(PACKET_PATH) as Record<string, unknown>;
    expect(() => validateCompilerReviewPacket({ ...packet, instructions: ['tampered'] })).toThrow(
      /hash mismatch/,
    );
  });

  it('accepts a complete human-format submission and computes agreement only afterwards', () => {
    const packet = validateCompilerReviewPacket(readJson(PACKET_PATH));
    const submission = CompilerReviewSubmissionSchema.parse({
      protocolVersion: packet.protocolVersion,
      packetSha256: packet.packetSha256,
      reviewerPseudonym: 'reviewer-b',
      reviewerType: 'HUMAN',
      submittedAt: '2026-09-04T12:00:00+09:00',
      independenceAttestation: true,
      cases: packet.cases.map((reviewCase) => {
        const result = runCompilerReviewCase(packet, reviewCase);
        return {
          reviewId: reviewCase.reviewId,
          decision: result.kind,
          escalationCode: result.kind === 'ESCALATE' ? result.code : null,
          fields: result.kind === 'ESCALATE' ? result.fields : [],
          rationale: 'Independent policy judgment recorded before running this comparison.',
        };
      }),
    });
    const report = evaluateCompilerReviewSubmission(packet, submission);
    expect(report).toMatchObject({
      complete: true,
      agreementCount: 10,
      disagreementCount: 0,
    });
  });

  it('keeps the distributed template structurally incomplete until a human fills it', () => {
    expect(() => CompilerReviewSubmissionSchema.parse(readJson(TEMPLATE_PATH))).toThrow();
  });
});
