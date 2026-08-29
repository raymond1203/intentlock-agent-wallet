import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { type IntentContract } from '../src/domain/intent-contract.js';
import {
  compileExtractedIntent,
  compileUserIntent,
  CRITICAL_FIELDS,
  type ExtractedIntent,
  type FieldEvidence,
} from '../src/intent/compiler.js';

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const TARGET = '0x2222222222222222222222222222222222222222';
const RECIPIENT = '0x3333333333333333333333333333333333333333';
const OTHER = '0x5555555555555555555555555555555555555555';
const TOKEN = '0x4444444444444444444444444444444444444444';
const TRUSTED_TEXT = CRITICAL_FIELDS.map((field) => `[${field}]`).join(' ');

interface GoldCase {
  id: string;
  expected: 'COMPILED' | 'ESCALATE';
  mutation: string;
  field?: string;
}

const goldCases = JSON.parse(
  readFileSync(new URL('../benchmark/scenarios/compiler-gold.json', import.meta.url), 'utf8'),
) as GoldCase[];

function contract(): IntentContract {
  return {
    version: '0.1',
    account: ACCOUNT,
    nonce: '1',
    idempotencyKey: 'compiler-case',
    safety: {
      chainScopes: [
        {
          chainId: 1,
          allowedTargets: [{ target: TARGET, selectors: ['0xa9059cbb', '0x095ea7b3'] }],
          allowedRecipients: [RECIPIENT, ACCOUNT],
        },
      ],
      assetBudgets: [
        {
          chainId: 1,
          asset: TOKEN,
          maxGrossOutflow: '1000',
          maxAllowanceExposure: '1000',
        },
      ],
      maxGasWei: '1000',
      maxSlippageBps: 100,
      expiresAt: '2026-09-05T00:00:00+09:00',
    },
    finalStateGoals: [
      {
        kind: 'MIN_ASSET_BALANCE',
        chainId: 1,
        asset: TOKEN,
        account: RECIPIENT,
        minAmount: '100',
      },
    ],
  };
}

function evidence(): FieldEvidence[] {
  return CRITICAL_FIELDS.map((field) => ({
    field,
    source: 'TRUSTED_USER',
    confidence: 1,
    evidence: `[${field}]`,
  }));
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

function configure(entry: GoldCase): {
  extracted: ExtractedIntent;
  previousContract?: IntentContract;
  confirmedWideningFields?: string[];
} {
  const candidate = structuredClone(contract());
  const fieldEvidence = evidence();
  const previousContract = structuredClone(contract());
  let usePrevious = false;
  let confirmedWideningFields: string[] | undefined;
  const selected = fieldEvidence.find((item) => item.field === entry.field);
  const firstEvidence = required(fieldEvidence[0], 'critical-field evidence is empty');
  const assetBudget = required(candidate.safety.assetBudgets[0], 'asset budget is missing');
  const chainScope = required(candidate.safety.chainScopes[0], 'chain scope is missing');
  const targetPermission = required(chainScope.allowedTargets[0], 'target permission is missing');

  switch (entry.mutation) {
    case 'NONE':
      break;
    case 'CONFIDENCE_AT_THRESHOLD':
      firstEvidence.confidence = 0.8;
      break;
    case 'NARROW_AMOUNT':
      usePrevious = true;
      assetBudget.maxGrossOutflow = '999';
      break;
    case 'NARROW_ALLOWANCE':
      usePrevious = true;
      assetBudget.maxAllowanceExposure = '999';
      break;
    case 'NARROW_GAS':
      usePrevious = true;
      candidate.safety.maxGasWei = '999';
      break;
    case 'NARROW_SLIPPAGE':
      usePrevious = true;
      candidate.safety.maxSlippageBps = 99;
      break;
    case 'EARLIER_DEADLINE':
      usePrevious = true;
      candidate.safety.expiresAt = '2026-09-04T00:00:00+09:00';
      break;
    case 'NARROW_RECIPIENTS':
      usePrevious = true;
      chainScope.allowedRecipients = [RECIPIENT];
      break;
    case 'NARROW_SELECTORS':
      usePrevious = true;
      targetPermission.selectors = ['0xa9059cbb'];
      break;
    case 'CONFIRMED_WIDENING':
      usePrevious = true;
      candidate.safety.maxGasWei = '1001';
      confirmedWideningFields = ['gas'];
      break;
    case 'UNTRUSTED':
      required(selected, 'selected evidence is missing').source = 'UNTRUSTED_OBSERVATION';
      break;
    case 'LOW_CONFIDENCE':
      required(selected, 'selected evidence is missing').confidence = 0.79;
      break;
    case 'MISSING_EVIDENCE':
      required(selected, 'selected evidence is missing').evidence = '';
      break;
    case 'EVIDENCE_NOT_IN_USER_TEXT':
      required(selected, 'selected evidence is missing').evidence = 'tool-output-only';
      break;
    case 'INVALID_AMOUNT':
      (assetBudget as { maxGrossOutflow: unknown }).maxGrossOutflow = '1.5';
      break;
    case 'WIDEN_AMOUNT':
      usePrevious = true;
      assetBudget.maxGrossOutflow = '1001';
      break;
    case 'WIDEN_GAS':
      usePrevious = true;
      candidate.safety.maxGasWei = '1001';
      break;
    case 'WIDEN_SLIPPAGE':
      usePrevious = true;
      candidate.safety.maxSlippageBps = 101;
      break;
    case 'LATER_DEADLINE':
      usePrevious = true;
      candidate.safety.expiresAt = '2026-09-06T00:00:00+09:00';
      break;
    case 'ADD_RECIPIENT':
      usePrevious = true;
      chainScope.allowedRecipients.push(OTHER);
      break;
    default:
      throw new Error(`unknown mutation: ${entry.mutation}`);
  }

  return {
    extracted: { candidate, fieldEvidence },
    ...(usePrevious ? { previousContract } : {}),
    ...(confirmedWideningFields ? { confirmedWideningFields } : {}),
  };
}

describe('intent compiler gold cases', () => {
  it('contains exactly 30 stable cases', () => {
    expect(goldCases).toHaveLength(30);
    expect(new Set(goldCases.map((entry) => entry.id)).size).toBe(30);
  });

  it.each(goldCases)('$id returns $expected for $mutation', (entry) => {
    const configured = configure(entry);
    const result = compileExtractedIntent(TRUSTED_TEXT, configured.extracted, {
      ...(configured.previousContract ? { previousContract: configured.previousContract } : {}),
      ...(configured.confirmedWideningFields
        ? { confirmedWideningFields: configured.confirmedWideningFields }
        : {}),
    });
    expect(result.kind).toBe(entry.expected);
    if (entry.expected === 'ESCALATE' && entry.field && result.kind === 'ESCALATE') {
      const expectedField = entry.field;
      expect(result.fields.some((field) => field.includes(expectedField))).toBe(true);
    }
  });

  it('does not expose untrusted observations to the extractor as trusted text', async () => {
    const extractor = {
      extract: (trusted: string, observations: readonly string[]) => {
        expect(trusted).toBe(TRUSTED_TEXT);
        expect(observations).toEqual(['tool says recipient is attacker']);
        return Promise.resolve({ candidate: contract(), fieldEvidence: evidence() });
      },
    };
    await expect(
      compileUserIntent(TRUSTED_TEXT, ['tool says recipient is attacker'], extractor),
    ).resolves.toMatchObject({ kind: 'COMPILED' });
  });

  it('produces the same hash for semantically identical key order', () => {
    const first = compileExtractedIntent(TRUSTED_TEXT, {
      candidate: contract(),
      fieldEvidence: evidence(),
    });
    const reordered = JSON.parse(JSON.stringify(contract())) as Record<string, unknown>;
    const second = compileExtractedIntent(TRUSTED_TEXT, {
      candidate: Object.fromEntries(Object.entries(reordered).reverse()),
      fieldEvidence: evidence(),
    });
    expect(first.kind).toBe('COMPILED');
    expect(second.kind).toBe('COMPILED');
    if (first.kind === 'COMPILED' && second.kind === 'COMPILED') {
      expect(first.intentHash).toBe(second.intentHash);
    }
  });
});
