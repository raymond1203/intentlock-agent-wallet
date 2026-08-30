import type { EconomicEffect } from '../domain/action-ir.js';

export interface DecodeContext {
  chainId: number;
  target: `0x${string}`;
  caller: `0x${string}`;
  data: `0x${string}`;
  valueWei?: string;
  codehash?: `0x${string}`;
  callPath?: readonly number[];
  phase?: 'PREDICTED' | 'OBSERVED';
}

export interface EffectDecodeResult {
  status: 'COMPLETE' | 'UNKNOWN';
  effects: EconomicEffect[];
}

export interface EffectMismatch {
  key: string;
  predicted: number;
  observed: number;
}

function economicKey(effect: EconomicEffect): string {
  const value = { ...effect, id: undefined, phase: undefined, provenance: undefined };
  return JSON.stringify(value, Object.keys(value).sort());
}

export function comparePredictedAndObserved(
  predicted: readonly EconomicEffect[],
  observed: readonly EconomicEffect[],
): EffectMismatch[] {
  const counts = (effects: readonly EconomicEffect[]): Map<string, number> => {
    const result = new Map<string, number>();
    for (const effect of effects) {
      const key = economicKey(effect);
      result.set(key, (result.get(key) ?? 0) + 1);
    }
    return result;
  };
  const predictedCounts = counts(predicted);
  const observedCounts = counts(observed);
  const keys = new Set([...predictedCounts.keys(), ...observedCounts.keys()]);
  return [...keys].sort().flatMap((key) => {
    const predictedCount = predictedCounts.get(key) ?? 0;
    const observedCount = observedCounts.get(key) ?? 0;
    return predictedCount === observedCount
      ? []
      : [{ key, predicted: predictedCount, observed: observedCount }];
  });
}

export function selectorFromData(data: `0x${string}`): `0x${string}` {
  return data.length >= 10 ? (data.slice(0, 10) as `0x${string}`) : '0x00000000';
}

export function unknownResult(context: DecodeContext, reason: string): EffectDecodeResult {
  return {
    status: 'UNKNOWN',
    effects: [
      {
        id: `unknown:${(context.callPath ?? []).join('.') || 'root'}`,
        phase: context.phase ?? 'PREDICTED',
        provenance: {
          callPath: [...(context.callPath ?? [])],
          target: context.target,
          selector: selectorFromData(context.data),
          ...(context.codehash ? { codehash: context.codehash } : {}),
          source: context.phase === 'OBSERVED' ? 'RECEIPT' : 'CALLDATA',
        },
        kind: 'UNKNOWN',
        chainId: context.chainId,
        reason,
        rawSelector: selectorFromData(context.data),
      },
    ],
  };
}
