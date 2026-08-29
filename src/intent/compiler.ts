import { IntentContractSchema, type IntentContract } from '../domain/intent-contract.js';
import { hashIntentContract } from '../domain/intent-hash.js';

export const CRITICAL_FIELDS = [
  'account',
  'nonce',
  'chainScopes',
  'targets',
  'selectors',
  'recipients',
  'assetBudgets',
  'gas',
  'slippage',
  'deadline',
  'finalStateGoals',
] as const;

export type CriticalField = (typeof CRITICAL_FIELDS)[number];

export interface FieldEvidence {
  field: CriticalField;
  source: 'TRUSTED_USER' | 'UNTRUSTED_OBSERVATION';
  confidence: number;
  evidence: string;
}

export interface ExtractedIntent {
  candidate: unknown;
  fieldEvidence: readonly FieldEvidence[];
}

export interface IntentExtractor {
  extract(
    trustedUserText: string,
    untrustedObservations: readonly string[],
  ): Promise<ExtractedIntent>;
}

export type CompilerResult =
  | { kind: 'COMPILED'; contract: IntentContract; intentHash: `0x${string}` }
  | {
      kind: 'ESCALATE';
      code: 'INVALID_CONTRACT' | 'MISSING_OR_UNTRUSTED_FIELD' | 'WIDENING_REQUIRES_CONFIRMATION';
      fields: readonly string[];
      prompt: string;
    };

export interface CompileOptions {
  previousContract?: IntentContract;
  confirmedWideningFields?: readonly string[];
  minimumConfidence?: number;
}

function lowerSet(values: readonly string[]): Set<string> {
  return new Set(values.map((value) => value.toLowerCase()));
}

function addedValues(previous: readonly string[], candidate: readonly string[]): boolean {
  const allowed = lowerSet(previous);
  return candidate.some((value) => !allowed.has(value.toLowerCase()));
}

function wideningFields(previous: IntentContract, candidate: IntentContract): string[] {
  const widened = new Set<string>();
  const previousScopes = new Map(
    previous.safety.chainScopes.map((scope) => [scope.chainId, scope]),
  );

  for (const scope of candidate.safety.chainScopes) {
    const oldScope = previousScopes.get(scope.chainId);
    if (!oldScope) {
      widened.add('chainScopes');
      continue;
    }
    if (addedValues(oldScope.allowedRecipients, scope.allowedRecipients)) widened.add('recipients');
    const oldTargets = new Map(
      oldScope.allowedTargets.map((permission) => [permission.target.toLowerCase(), permission]),
    );
    for (const permission of scope.allowedTargets) {
      const oldPermission = oldTargets.get(permission.target.toLowerCase());
      if (!oldPermission) widened.add('targets');
      else if (addedValues(oldPermission.selectors, permission.selectors)) widened.add('selectors');
    }
  }

  const previousBudgets = new Map(
    previous.safety.assetBudgets.map((budget) => [
      `${String(budget.chainId)}:${budget.asset.toLowerCase()}`,
      budget,
    ]),
  );
  for (const budget of candidate.safety.assetBudgets) {
    const oldBudget = previousBudgets.get(
      `${String(budget.chainId)}:${budget.asset.toLowerCase()}`,
    );
    if (
      !oldBudget ||
      BigInt(budget.maxGrossOutflow) > BigInt(oldBudget.maxGrossOutflow) ||
      BigInt(budget.maxAllowanceExposure) > BigInt(oldBudget.maxAllowanceExposure)
    ) {
      widened.add('assetBudgets');
    }
  }

  if (BigInt(candidate.safety.maxGasWei) > BigInt(previous.safety.maxGasWei)) widened.add('gas');
  if (candidate.safety.maxSlippageBps > previous.safety.maxSlippageBps) widened.add('slippage');
  if (Date.parse(candidate.safety.expiresAt) > Date.parse(previous.safety.expiresAt)) {
    widened.add('deadline');
  }
  if (candidate.finalStateGoals.length < previous.finalStateGoals.length) {
    widened.add('finalStateGoals');
  }
  return [...widened].sort();
}

function unresolvedFields(
  trustedUserText: string,
  evidence: readonly FieldEvidence[],
  minimumConfidence: number,
): CriticalField[] {
  const byField = new Map(evidence.map((entry) => [entry.field, entry]));
  return CRITICAL_FIELDS.filter((field) => {
    const entry = byField.get(field);
    return (
      !entry ||
      entry.source !== 'TRUSTED_USER' ||
      entry.confidence < minimumConfidence ||
      entry.evidence.length === 0 ||
      !trustedUserText.includes(entry.evidence)
    );
  });
}

export function compileExtractedIntent(
  trustedUserText: string,
  extracted: ExtractedIntent,
  options: CompileOptions = {},
): CompilerResult {
  const parsed = IntentContractSchema.safeParse(extracted.candidate);
  if (!parsed.success) {
    return {
      kind: 'ESCALATE',
      code: 'INVALID_CONTRACT',
      fields: parsed.error.issues.map((issue) => issue.path.join('.')),
      prompt: '의도 계약의 형식 또는 필수 경계를 확인해 주세요.',
    };
  }

  const unresolved = unresolvedFields(
    trustedUserText,
    extracted.fieldEvidence,
    options.minimumConfidence ?? 0.8,
  );
  if (unresolved.length > 0) {
    return {
      kind: 'ESCALATE',
      code: 'MISSING_OR_UNTRUSTED_FIELD',
      fields: unresolved,
      prompt: `다음 권한 경계를 사용자 입력으로 확인해 주세요: ${unresolved.join(', ')}`,
    };
  }

  if (options.previousContract) {
    const confirmed = new Set(options.confirmedWideningFields ?? []);
    const unconfirmed = wideningFields(options.previousContract, parsed.data).filter(
      (field) => !confirmed.has(field),
    );
    if (unconfirmed.length > 0) {
      return {
        kind: 'ESCALATE',
        code: 'WIDENING_REQUIRES_CONFIRMATION',
        fields: unconfirmed,
        prompt: `기존 의도보다 권한이 넓어집니다. 다음 변경을 확인해 주세요: ${unconfirmed.join(', ')}`,
      };
    }
  }

  return { kind: 'COMPILED', contract: parsed.data, intentHash: hashIntentContract(parsed.data) };
}

export async function compileUserIntent(
  trustedUserText: string,
  untrustedObservations: readonly string[],
  extractor: IntentExtractor,
  options: CompileOptions = {},
): Promise<CompilerResult> {
  const extracted = await extractor.extract(trustedUserText, untrustedObservations);
  return compileExtractedIntent(trustedUserText, extracted, options);
}
