export type { DecisionEvidence, GuardDecision } from './domain/guard-decision.js';
export {
  AssetBudgetSchema,
  AssetIdSchema,
  createIntentContractJsonSchema,
  EvmAddressSchema,
  FinalStateGoalSchema,
  FunctionSelectorSchema,
  IntentContractSchema,
  SafetyInvariantsSchema,
  type IntentContract,
  UnsignedIntegerStringSchema,
} from './domain/intent-contract.js';
export {
  ActionIRSchema,
  aggregateEffects,
  createActionIrJsonSchema,
  EconomicEffectSchema,
  flattenEffects,
  type ActionIR,
  type EconomicEffect,
  type EffectTotals,
} from './domain/action-ir.js';
export { createSimulationClient } from './evm/client.js';
export { canonicalIntentJson, hashIntentContract } from './domain/intent-hash.js';
export {
  compileExtractedIntent,
  compileUserIntent,
  CRITICAL_FIELDS,
  type CompilerResult,
  type ExtractedIntent,
  type FieldEvidence,
  type IntentExtractor,
} from './intent/compiler.js';
export { evaluateIntent, type FinalGoalCheck, type MonitorInput } from './monitor/monitor.js';
export { REASON_CODES, type ReasonCode } from './monitor/reason-codes.js';
export {
  InMemoryIntentLedger,
  type LedgerSnapshot,
  type ReservationRecord,
  type ReservationStatus,
  type ReserveResult,
} from './monitor/ledger.js';
export {
  createReservationRequest,
  type ReservationAmounts,
  type ReservationLimits,
  type ReservationRequest,
} from './monitor/reservation.js';
export { decodeErc20Calldata, decodeErc20Log, ERC20_ABI } from './effects/erc20-decoder.js';
export {
  decodePermit2Calldata,
  decodePermit2TypedData,
  PERMIT2_ABI,
  PermitSingleTypedDataSchema,
  type PermitSingleTypedData,
} from './effects/permit2-decoder.js';
export {
  comparePredictedAndObserved,
  type DecodeContext,
  type EffectDecodeResult,
  type EffectMismatch,
} from './effects/types.js';
export { decodeSwapRouterCalldata, SWAP_ROUTER_02_ABI } from './effects/swap-decoder.js';
export {
  decodeBatchCalldata,
  ERC7821_ABI,
  type BatchDecodeResult,
  type BatchDecoderOptions,
  type DecoderContract,
  type DecoderContractKind,
} from './effects/batch-decoder.js';
export * from './adapters/metamask/index.js';
export {
  BenchmarkDatasetSchema,
  BenchmarkScenarioSchema,
  createBenchmarkScenarioJsonSchema,
  SplitManifestSchema,
  ViolationLabelSchema,
  type BenchmarkDataset,
  type BenchmarkScenario,
  type ScenarioSplit,
  type ViolationLabel,
} from './benchmark/scenario.js';
export { findDuplicateScenarios, type DuplicateFinding } from './benchmark/dedup.js';
export {
  applyMutation,
  MUTATION_OPERATOR_IDS,
  type MutationOperatorId,
} from './benchmark/mutations/index.js';
export { evaluateLlmVerifier } from './baselines/llm-verifier.js';
export { OpenAiResponsesClient } from './baselines/openai-responses-client.js';
export { evaluatePerCallPolicy } from './baselines/per-call-policy.js';
export {
  evaluateGuardMode,
  GUARD_REASON_CODES,
  GuardModeConfigSchema,
  GuardModeEmulator,
  guardModeConfigFromScenario,
  ROLLING_WINDOW_SECONDS,
  type GuardModeConfig,
  type GuardModeEvaluation,
  type GuardReasonCode,
} from './baselines/guard-mode-emulator.js';
export type { BaselineDecision, BaselineVerdict } from './baselines/types.js';
export {
  AAVE_V3_ABI,
  ACROSS_V3_ABI,
  CCTP_V1_ABI,
  decodeAaveV3,
  decodeAcrossV3,
  decodeCctpV1,
} from './effects/protocol-decoders.js';
export { scoreDecision } from './benchmark/scoring.js';
export {
  evaluatePostState,
  observationKey,
  type OracleInput,
  type OracleResult,
} from './oracle/post-state-oracle.js';
