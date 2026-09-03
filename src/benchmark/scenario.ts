import { z } from 'zod';

import { EconomicEffectSchema } from '../domain/action-ir.js';
import {
  EvmAddressSchema,
  FunctionSelectorSchema,
  IntentContractSchema,
  UnsignedIntegerStringSchema,
} from '../domain/intent-contract.js';

export const CriticalIntentFieldSchema = z.enum([
  'account',
  'nonce',
  'chain',
  'target',
  'selector',
  'recipient',
  'amount',
  'allowance',
  'gas',
  'slippage',
  'deadline',
  'finalGoal',
]);

export const ViolationLabelSchema = z.enum([
  'BENIGN',
  'RECIPIENT_SUBSTITUTION',
  'TOKEN_SUBSTITUTION',
  'CHAIN_SUBSTITUTION',
  'AMOUNT_INFLATION',
  'SLIPPAGE_WIDENING',
  'GAS_INFLATION',
  'DEADLINE_EXTENSION',
  'UNLIMITED_APPROVAL',
  'HIDDEN_BATCH',
  'STALE_QUOTE',
  'RETRY_DOUBLE_SPEND',
  'CONCURRENCY_RACE',
  'POLICY_LAUNDERING',
  'BENIGN_HALLUCINATION',
  'PARTIAL_COMPLETION',
  'UNKNOWN_EFFECT',
]);

export const ScenarioWorkflowSchema = z.enum([
  'TRANSFER',
  'APPROVAL_PERMIT2',
  'SWAP_SINGLE',
  'SWAP_BATCH',
  'BRIDGE_SWAP',
  'LENDING',
  'BATCH_RECOVERY',
]);

export const ScenarioSplitSchema = z.enum(['TRAIN', 'DEV', 'HIDDEN_TEST']);
export const ScenarioClassSchema = z.enum(['BASE', 'ADVERSARIAL', 'BENIGN_DRIFT']);

export const ScenarioProvenanceSchema = z
  .object({
    kind: z.enum(['CURATED', 'GENERATED']),
    sources: z.array(z.url()).min(1),
    baseScenarioId: z.string().min(1).optional(),
    mutationOperator: z.string().min(1).optional(),
    seed: z.number().int().nonnegative().optional(),
  })
  .strict();

export const TraceActionSchema = z
  .object({
    id: z.string().min(1),
    executionIndex: z.number().int().nonnegative(),
    chainId: z.number().int().positive(),
    target: EvmAddressSchema,
    selector: FunctionSelectorSchema,
    calldata: z.string().regex(/^0x[a-fA-F0-9]*$/, 'expected hex calldata'),
    valueWei: UnsignedIntegerStringSchema,
  })
  .strict()
  .superRefine((action, context) => {
    if (
      action.calldata.length < 10 ||
      action.calldata.slice(0, 10).toLowerCase() !== action.selector.toLowerCase()
    ) {
      context.addIssue({
        code: 'custom',
        message: 'selector must equal the first four calldata bytes',
        path: ['selector'],
      });
    }
  });

export const StateObservationSchema = z
  .object({
    chainId: z.number().int().positive(),
    subject: EvmAddressSchema,
    field: z.enum([
      'BALANCE',
      'ALLOWANCE',
      'OWNER',
      'DEBT',
      'POSITION',
      'HEALTH_FACTOR',
      'GAS_USED',
      'CODEHASH',
    ]),
    asset: EvmAddressSchema.or(z.literal('native')).optional(),
    counterparty: EvmAddressSchema.optional(),
    tokenId: UnsignedIntegerStringSchema.optional(),
    value: z.string().regex(/^-?(0|[1-9]\d*)$|^0x[a-fA-F0-9]{40,64}$/),
    source: z.enum(['FIXED_FORK', 'RECEIPT', 'POST_STATE', 'EXPECTED_FIXTURE']),
  })
  .strict();

export const MutationChangeSchema = z
  .object({
    path: z.string().min(1),
    before: z.string(),
    after: z.string(),
  })
  .strict();

export const BenchmarkScenarioSchema = z
  .object({
    schemaVersion: z.literal('0.1'),
    id: z.string().regex(/^[A-Z][A-Z0-9-]{2,79}$/),
    version: z.number().int().positive(),
    title: z.string().min(3).max(160),
    workflow: ScenarioWorkflowSchema,
    class: ScenarioClassSchema,
    split: ScenarioSplitSchema,
    provenance: ScenarioProvenanceSchema,
    fixture: z
      .object({
        manifest: z.literal('benchmark/fixtures/manifest.json'),
        chains: z
          .array(
            z
              .object({
                chainId: z.number().int().positive(),
                blockNumber: z.number().int().positive(),
                blockHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
                contracts: z.array(
                  z
                    .object({
                      address: EvmAddressSchema,
                      codehash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
                    })
                    .strict(),
                ),
              })
              .strict(),
          )
          .min(1),
      })
      .strict()
      .optional(),
    naturalLanguage: z
      .object({
        text: z.string().min(10),
        ambiguity: z.enum(['EXPLICIT', 'IMPLICIT', 'AMBIGUOUS']),
        criticalFieldsPresent: z.array(CriticalIntentFieldSchema).min(1),
      })
      .strict(),
    intent: IntentContractSchema,
    trace: z
      .object({
        kind: z.enum(['BENIGN', 'ADVERSARIAL', 'BENIGN_DRIFT']),
        actions: z.array(TraceActionSchema).min(1),
        expectedEffects: z.array(EconomicEffectSchema).min(1),
      })
      .strict(),
    oracle: z
      .object({
        observationStage: z.enum(['PRE_SIGN', 'POST_STATE']).default('PRE_SIGN'),
        evidenceLevel: z.enum(['EXPECTED_FIXTURE', 'EXECUTED_FORK']).default('EXPECTED_FIXTURE'),
        executionComplete: z.boolean().default(true),
        expectedDecision: z.enum(['ALLOW', 'DENY', 'ESCALATE']),
        labels: z.array(ViolationLabelSchema).min(1),
        violationAmount: UnsignedIntegerStringSchema.optional(),
        allowanceExposure: UnsignedIntegerStringSchema.optional(),
        preState: z.array(StateObservationSchema),
        postState: z.array(StateObservationSchema).min(1),
        evidence: z.string().min(3),
      })
      .strict(),
    mutation: z
      .object({
        validity: z.enum(['VALID_SEMANTIC', 'INVALID_CALLDATA', 'POST_STATE_FIXTURE', 'NO_OP']),
        changes: z.array(MutationChangeSchema).min(1),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((scenario, context) => {
    const labels = new Set(scenario.oracle.labels);
    if (labels.size !== scenario.oracle.labels.length) {
      context.addIssue({
        code: 'custom',
        message: 'labels must be unique',
        path: ['oracle', 'labels'],
      });
    }
    if (labels.has('BENIGN') && labels.size !== 1) {
      context.addIssue({
        code: 'custom',
        message: 'BENIGN is exclusive with violation labels',
        path: ['oracle', 'labels'],
      });
    }
    if (scenario.class === 'BASE') {
      if (scenario.trace.kind !== 'BENIGN' || !labels.has('BENIGN')) {
        context.addIssue({
          code: 'custom',
          message: 'base scenarios require a benign trace and BENIGN label',
          path: ['class'],
        });
      }
      if (scenario.provenance.kind !== 'CURATED' || scenario.mutation !== undefined) {
        context.addIssue({
          code: 'custom',
          message: 'base scenarios must be curated and unmutated',
          path: ['provenance'],
        });
      }
    } else if (
      scenario.provenance.kind !== 'GENERATED' ||
      !scenario.provenance.baseScenarioId ||
      !scenario.provenance.mutationOperator ||
      scenario.provenance.seed === undefined ||
      scenario.mutation === undefined
    ) {
      context.addIssue({
        code: 'custom',
        message: 'mutated scenarios require generated provenance and a mutation record',
        path: ['provenance'],
      });
    }
    if (
      scenario.class === 'ADVERSARIAL' &&
      (labels.has('BENIGN') || scenario.trace.kind !== 'ADVERSARIAL')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'adversarial scenarios require violation labels and an adversarial trace',
        path: ['class'],
      });
    }
    if (scenario.class === 'BENIGN_DRIFT' && scenario.trace.kind !== 'BENIGN_DRIFT') {
      context.addIssue({
        code: 'custom',
        message: 'benign drift scenarios require a BENIGN_DRIFT trace',
        path: ['class'],
      });
    }
    const actionIds = scenario.trace.actions.map((action) => action.id);
    if (new Set(actionIds).size !== actionIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'action IDs must be unique',
        path: ['trace', 'actions'],
      });
    }
    const indexes = scenario.trace.actions
      .map((action) => action.executionIndex)
      .sort((a, b) => a - b);
    if (indexes.some((value, index) => value !== index)) {
      context.addIssue({
        code: 'custom',
        message: 'executionIndex values must be contiguous from zero',
        path: ['trace', 'actions'],
      });
    }
    const effectIds = scenario.trace.expectedEffects.map((effect) => effect.id);
    if (new Set(effectIds).size !== effectIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'effect IDs must be unique',
        path: ['trace', 'expectedEffects'],
      });
    }
  });

export const BenchmarkDatasetSchema = z
  .object({
    schemaVersion: z.literal('0.1'),
    datasetVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    scenarios: z.array(BenchmarkScenarioSchema).min(1),
  })
  .strict()
  .superRefine((dataset, context) => {
    const ids = dataset.scenarios.map((scenario) => scenario.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        message: 'scenario IDs must be unique',
        path: ['scenarios'],
      });
    }
  });

export const SplitManifestSchema = z
  .object({
    schemaVersion: z.literal('0.1'),
    datasetVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    strategy: z.literal('grouped-stratified-60-20-20'),
    salt: z.string().min(16),
    assignments: z.record(z.string(), ScenarioSplitSchema),
    frozen: z.boolean(),
    hiddenTestPolicy: z
      .object({
        visibleDuringDevelopment: z.boolean(),
        modificationRequires: z.literal('independent-reviewer-approval'),
        emergencyProcedure: z.string().min(20),
      })
      .strict(),
    changeHistory: z.array(
      z
        .object({
          version: z.string().regex(/^\d+\.\d+\.\d+$/),
          reason: z.string().min(3),
          pullRequest: z.string().regex(/^#\d+$/),
        })
        .strict(),
    ),
  })
  .strict();

export type BenchmarkScenario = z.infer<typeof BenchmarkScenarioSchema>;
export type BenchmarkDataset = z.infer<typeof BenchmarkDatasetSchema>;
export type ViolationLabel = z.infer<typeof ViolationLabelSchema>;
export type ScenarioSplit = z.infer<typeof ScenarioSplitSchema>;

export function createBenchmarkScenarioJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(BenchmarkScenarioSchema, {
    target: 'draft-2020-12',
    unrepresentable: 'throw',
  });
}
