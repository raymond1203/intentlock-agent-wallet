import type { EconomicEffect } from '../domain/action-ir.js';

export interface ReceiptReserve {
  chainId: number;
  aToken: string;
  variableDebtToken: string;
}
/** A reserve-token mint/burn changes a position/debt; it is not another underlying payment.
 * Keep ordinary aToken transfers, unknown assets and all non-zero counterparties visible.
 */
export function classifyReceiptEffects(effects: EconomicEffect[], reserves: ReceiptReserve[]) {
  const positionTokenEvents: EconomicEffect[] = [];
  const economicFlows: EconomicEffect[] = [];
  const zero = '0x0000000000000000000000000000000000000000';
  for (const effect of effects) {
    const reserveEvent =
      effect.kind === 'TRANSFER' &&
      (effect.from.toLowerCase() === zero || effect.to.toLowerCase() === zero) &&
      reserves.some(
        (r) =>
          r.chainId === effect.chainId &&
          [r.aToken, r.variableDebtToken].some(
            (a) => a.toLowerCase() === effect.asset.toLowerCase(),
          ),
      );
    (reserveEvent ? positionTokenEvents : economicFlows).push(effect);
  }
  return { economicFlows, positionTokenEvents };
}
