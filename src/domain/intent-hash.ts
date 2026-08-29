import { keccak256, stringToHex } from 'viem';

import { IntentContractSchema, type IntentContract } from './intent-contract.js';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function canonicalIntentJson(contract: IntentContract): string {
  return JSON.stringify(canonicalize(IntentContractSchema.parse(contract)));
}

export function hashIntentContract(contract: IntentContract): `0x${string}` {
  return keccak256(stringToHex(canonicalIntentJson(contract)));
}
