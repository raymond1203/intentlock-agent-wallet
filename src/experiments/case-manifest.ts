import { z } from 'zod';

import { MUTATION_OPERATOR_IDS } from '../benchmark/mutations/index.js';
import {
  ScenarioClassSchema,
  ScenarioSplitSchema,
  ScenarioWorkflowSchema,
} from '../benchmark/scenario.js';
import { EVALUATION_VARIANTS, type EvaluationCaseMatrix } from './case-matrix.js';

export const EvaluationVariantSchema = z.enum(EVALUATION_VARIANTS);
export const MutationOperatorIdSchema = z.enum(MUTATION_OPERATOR_IDS);

export const EvaluationCaseManifestEntrySchema = z
  .object({
    caseId: z.string().min(1),
    baseScenarioId: z.string().min(1),
    variant: EvaluationVariantSchema,
    workflow: ScenarioWorkflowSchema,
    class: ScenarioClassSchema,
    split: ScenarioSplitSchema,
    chainIds: z.array(z.number().int().positive()).min(1),
    observationStage: z.enum(['PRE_SIGN', 'POST_STATE']),
    oracleEvidenceLevel: z.enum(['EXPECTED_FIXTURE', 'EXECUTED_FORK']),
    mutationValidity: z
      .enum(['VALID_SEMANTIC', 'INVALID_CALLDATA', 'POST_STATE_FIXTURE', 'NO_OP'])
      .nullable(),
    mutationOperator: MutationOperatorIdSchema.nullable(),
    seed: z.number().int().nonnegative().nullable(),
    scenarioSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const EvaluationCaseManifestSchema = z
  .object({
    protocolVersion: z.literal('0.1'),
    datasetVersion: z.literal('0.3.0'),
    rootSeed: z.literal(2026),
    baseCount: z.literal(80),
    caseCount: z.literal(400),
    casesPerBase: z.literal(5),
    derivation: z
      .object({
        generator: z.string().min(1),
        source: z.string().min(1),
        note: z.string().min(1),
      })
      .strict(),
    entries: z.array(EvaluationCaseManifestEntrySchema).length(400),
  })
  .strict()
  .superRefine((manifest, context) => {
    const ids = manifest.entries.map((entry) => entry.caseId);
    if (new Set(ids).size !== 400) {
      context.addIssue({
        code: 'custom',
        path: ['entries'],
        message: 'case IDs must be unique',
      });
    }
    for (const variant of EVALUATION_VARIANTS) {
      if (manifest.entries.filter((entry) => entry.variant === variant).length !== 80) {
        context.addIssue({
          code: 'custom',
          path: ['entries'],
          message: `${variant} must contain exactly 80 cases`,
        });
      }
    }
  });

export type EvaluationCaseManifest = z.infer<typeof EvaluationCaseManifestSchema>;

/** Ensures the stored manifest is exactly the deterministic regeneration. */
export function verifyCaseManifest(
  manifestInput: unknown,
  matrix: EvaluationCaseMatrix,
): EvaluationCaseManifest {
  const manifest = EvaluationCaseManifestSchema.parse(manifestInput);
  if (manifest.entries.length !== matrix.entries.length) {
    throw new Error('case manifest length differs from the regenerated matrix');
  }
  for (const [index, entry] of manifest.entries.entries()) {
    const regenerated = matrix.entries[index];
    if (!regenerated || JSON.stringify(entry) !== JSON.stringify(regenerated)) {
      throw new Error(`case manifest differs at index ${String(index)}`);
    }
  }
  return manifest;
}
