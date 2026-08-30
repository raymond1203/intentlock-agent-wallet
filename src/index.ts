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
