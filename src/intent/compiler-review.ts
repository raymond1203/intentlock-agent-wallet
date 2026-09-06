import { createHash } from 'node:crypto';

import { z } from 'zod';

import { IntentContractSchema, type IntentContract } from '../domain/intent-contract.js';
import {
  compileExtractedIntent,
  CRITICAL_FIELDS,
  type CompilerResult,
  type FieldEvidence,
} from './compiler.js';

const CriticalFieldSchema = z.enum(CRITICAL_FIELDS);
const JsonPointerSchema = z.string().regex(/^\/(?:[^~/]|~[01])+(?:\/(?:[^~/]|~[01])+)*$/);

const FieldEvidenceSchema = z
  .object({
    field: CriticalFieldSchema,
    source: z.enum(['TRUSTED_USER', 'UNTRUSTED_OBSERVATION']),
    confidence: z.number().min(0).max(1),
    evidence: z.string(),
  })
  .strict();

const CandidateChangeSchema = z
  .object({
    path: JsonPointerSchema,
    value: z.unknown(),
  })
  .strict();

const EvidenceOverrideSchema = z
  .object({
    field: CriticalFieldSchema,
    source: z.enum(['TRUSTED_USER', 'UNTRUSTED_OBSERVATION']).optional(),
    confidence: z.number().min(0).max(1).optional(),
    evidence: z.string().optional(),
  })
  .strict();

export const CompilerReviewCaseSchema = z
  .object({
    reviewId: z.string().regex(/^M1C-\d{2}$/),
    trustedUserText: z.string().min(1),
    untrustedObservations: z.array(z.string()),
    candidateChanges: z.array(CandidateChangeSchema),
    evidenceOverrides: z.array(EvidenceOverrideSchema),
    comparisonMode: z.enum(['NONE', 'BASELINE_AS_PREVIOUS']),
    confirmedWideningFields: z.array(CriticalFieldSchema),
    minimumConfidence: z.number().min(0).max(1),
  })
  .strict();

export const CompilerReviewPacketSchema = z
  .object({
    protocolVersion: z.literal('m1-compiler-review-v1'),
    policyDocument: z.literal('docs/intent-compiler.md'),
    packetSha256: z.string().regex(/^[0-9a-f]{64}$/),
    instructions: z.array(z.string().min(1)).min(1),
    baselineCandidate: z.unknown(),
    baselineFieldEvidence: z.array(FieldEvidenceSchema),
    cases: z.array(CompilerReviewCaseSchema).length(10),
  })
  .strict()
  .superRefine((packet, context) => {
    const ids = packet.cases.map((entry) => entry.reviewId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', message: 'review ids must be unique', path: ['cases'] });
    }
    const fields = packet.baselineFieldEvidence.map((entry) => entry.field);
    if (
      fields.length !== CRITICAL_FIELDS.length ||
      CRITICAL_FIELDS.some((field) => !fields.includes(field))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'baseline evidence must cover every critical field exactly once',
        path: ['baselineFieldEvidence'],
      });
    }
  });

export type CompilerReviewPacket = z.infer<typeof CompilerReviewPacketSchema>;
export type CompilerReviewCase = z.infer<typeof CompilerReviewCaseSchema>;

const HumanDecisionSchema = z
  .object({
    reviewId: z.string().regex(/^M1C-\d{2}$/),
    decision: z.enum(['COMPILED', 'ESCALATE']),
    escalationCode: z
      .enum(['INVALID_CONTRACT', 'MISSING_OR_UNTRUSTED_FIELD', 'WIDENING_REQUIRES_CONFIRMATION'])
      .nullable(),
    fields: z.array(z.string()).max(20),
    rationale: z.string().min(1),
  })
  .strict()
  .superRefine((decision, context) => {
    if (decision.decision === 'COMPILED') {
      if (decision.escalationCode !== null) {
        context.addIssue({
          code: 'custom',
          message: 'COMPILED decisions cannot have an escalation code',
          path: ['escalationCode'],
        });
      }
      if (decision.fields.length !== 0) {
        context.addIssue({
          code: 'custom',
          message: 'COMPILED decisions cannot have unresolved fields',
          path: ['fields'],
        });
      }
    } else if (decision.escalationCode === null) {
      context.addIssue({
        code: 'custom',
        message: 'ESCALATE decisions require an escalation code',
        path: ['escalationCode'],
      });
    }
  });

export const CompilerReviewSubmissionSchema = z
  .object({
    protocolVersion: z.literal('m1-compiler-review-v1'),
    packetSha256: z.string().regex(/^[0-9a-f]{64}$/),
    reviewerPseudonym: z.string().min(1).max(64),
    reviewerType: z.literal('HUMAN'),
    submittedAt: z.iso.datetime({ offset: true }),
    independenceAttestation: z.literal(true),
    cases: z.array(HumanDecisionSchema).length(10),
  })
  .strict()
  .superRefine((submission, context) => {
    const ids = submission.cases.map((entry) => entry.reviewId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', message: 'review ids must be unique', path: ['cases'] });
    }
  });

export type CompilerReviewSubmission = z.infer<typeof CompilerReviewSubmissionSchema>;

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(',')}}`;
}

export function computeCompilerReviewPacketSha256(
  packet: Omit<CompilerReviewPacket, 'packetSha256'> | CompilerReviewPacket,
): string {
  const { packetSha256: _packetSha256, ...hashable } = packet as CompilerReviewPacket;
  return createHash('sha256').update(canonicalize(hashable)).digest('hex');
}

export function validateCompilerReviewPacket(value: unknown): CompilerReviewPacket {
  const packet = CompilerReviewPacketSchema.parse(value);
  const observed = computeCompilerReviewPacketSha256(packet);
  if (observed !== packet.packetSha256) {
    throw new Error(
      `compiler review packet hash mismatch: expected ${packet.packetSha256}, got ${observed}`,
    );
  }
  return packet;
}

function decodePointerSegment(value: string): string {
  return value.replaceAll('~1', '/').replaceAll('~0', '~');
}

function setJsonPointer(target: unknown, pointer: string, value: unknown): void {
  const segments = pointer.slice(1).split('/').map(decodePointerSegment);
  let cursor: unknown = target;
  for (const segment of segments.slice(0, -1)) {
    if (Array.isArray(cursor)) {
      const index = Number(segment);
      if (!Number.isSafeInteger(index) || index < 0 || index >= cursor.length) {
        throw new Error(`candidate change points outside an array: ${pointer}`);
      }
      cursor = cursor[index];
    } else if (cursor !== null && typeof cursor === 'object') {
      if (!(segment in cursor))
        throw new Error(`candidate change points to a missing field: ${pointer}`);
      cursor = (cursor as Record<string, unknown>)[segment];
    } else {
      throw new Error(`candidate change cannot traverse a scalar: ${pointer}`);
    }
  }
  const finalSegment = segments.at(-1);
  if (finalSegment === undefined) throw new Error(`invalid candidate change pointer: ${pointer}`);
  if (Array.isArray(cursor)) {
    const index = Number(finalSegment);
    if (!Number.isSafeInteger(index) || index < 0 || index >= cursor.length) {
      throw new Error(`candidate change points outside an array: ${pointer}`);
    }
    cursor[index] = structuredClone(value);
  } else if (cursor !== null && typeof cursor === 'object') {
    if (!(finalSegment in cursor)) {
      throw new Error(`candidate change points to a missing field: ${pointer}`);
    }
    (cursor as Record<string, unknown>)[finalSegment] = structuredClone(value);
  } else {
    throw new Error(`candidate change cannot update a scalar parent: ${pointer}`);
  }
}

export interface MaterializedCompilerReviewCase {
  reviewId: string;
  trustedUserText: string;
  untrustedObservations: readonly string[];
  candidate: unknown;
  fieldEvidence: readonly FieldEvidence[];
  previousContract?: IntentContract;
  confirmedWideningFields: readonly string[];
  minimumConfidence: number;
}

export function materializeCompilerReviewCase(
  packet: CompilerReviewPacket,
  reviewCase: CompilerReviewCase,
): MaterializedCompilerReviewCase {
  const candidate = structuredClone(packet.baselineCandidate);
  for (const change of reviewCase.candidateChanges) {
    setJsonPointer(candidate, change.path, change.value);
  }
  const overrides = new Map(reviewCase.evidenceOverrides.map((entry) => [entry.field, entry]));
  const fieldEvidence = packet.baselineFieldEvidence.map((entry) => ({
    ...entry,
    ...(overrides.get(entry.field) ?? {}),
  })) as FieldEvidence[];
  return {
    reviewId: reviewCase.reviewId,
    trustedUserText: reviewCase.trustedUserText,
    untrustedObservations: reviewCase.untrustedObservations,
    candidate,
    fieldEvidence,
    ...(reviewCase.comparisonMode === 'BASELINE_AS_PREVIOUS'
      ? { previousContract: IntentContractSchema.parse(packet.baselineCandidate) }
      : {}),
    confirmedWideningFields: reviewCase.confirmedWideningFields,
    minimumConfidence: reviewCase.minimumConfidence,
  };
}

export function runCompilerReviewCase(
  packet: CompilerReviewPacket,
  reviewCase: CompilerReviewCase,
): CompilerResult {
  const materialized = materializeCompilerReviewCase(packet, reviewCase);
  return compileExtractedIntent(
    materialized.trustedUserText,
    { candidate: materialized.candidate, fieldEvidence: materialized.fieldEvidence },
    {
      ...(materialized.previousContract ? { previousContract: materialized.previousContract } : {}),
      confirmedWideningFields: materialized.confirmedWideningFields,
      minimumConfidence: materialized.minimumConfidence,
    },
  );
}

function normalizedFields(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export interface CompilerReviewComparison {
  reviewId: string;
  humanDecision: 'COMPILED' | 'ESCALATE';
  implementationDecision: 'COMPILED' | 'ESCALATE';
  decisionAgrees: boolean;
  codeAgrees: boolean;
  fieldsAgree: boolean;
  agrees: boolean;
}

export interface CompilerReviewReport {
  packetSha256: string;
  reviewerPseudonym: string;
  complete: true;
  agreementCount: number;
  disagreementCount: number;
  comparisons: CompilerReviewComparison[];
}

export function evaluateCompilerReviewSubmission(
  packetValue: unknown,
  submissionValue: unknown,
): CompilerReviewReport {
  const packet = validateCompilerReviewPacket(packetValue);
  const submission = CompilerReviewSubmissionSchema.parse(submissionValue);
  if (submission.packetSha256 !== packet.packetSha256) {
    throw new Error('compiler review submission targets a different packet');
  }
  const packetIds = packet.cases.map((entry) => entry.reviewId).sort();
  const submissionIds = submission.cases.map((entry) => entry.reviewId).sort();
  if (JSON.stringify(packetIds) !== JSON.stringify(submissionIds)) {
    throw new Error('compiler review submission does not cover the packet case set exactly');
  }
  const byId = new Map(submission.cases.map((entry) => [entry.reviewId, entry]));
  const comparisons = packet.cases.map((reviewCase): CompilerReviewComparison => {
    const human = byId.get(reviewCase.reviewId);
    if (!human) throw new Error(`missing human decision for ${reviewCase.reviewId}`);
    const implementation = runCompilerReviewCase(packet, reviewCase);
    const implementationCode = implementation.kind === 'ESCALATE' ? implementation.code : null;
    const implementationFields =
      implementation.kind === 'ESCALATE' ? normalizedFields(implementation.fields) : [];
    const decisionAgrees = human.decision === implementation.kind;
    const codeAgrees = human.escalationCode === implementationCode;
    const fieldsAgree =
      JSON.stringify(normalizedFields(human.fields)) === JSON.stringify(implementationFields);
    return {
      reviewId: reviewCase.reviewId,
      humanDecision: human.decision,
      implementationDecision: implementation.kind,
      decisionAgrees,
      codeAgrees,
      fieldsAgree,
      agrees: decisionAgrees && codeAgrees && fieldsAgree,
    };
  });
  const agreementCount = comparisons.filter((entry) => entry.agrees).length;
  return {
    packetSha256: packet.packetSha256,
    reviewerPseudonym: submission.reviewerPseudonym,
    complete: true,
    agreementCount,
    disagreementCount: comparisons.length - agreementCount,
    comparisons,
  };
}
