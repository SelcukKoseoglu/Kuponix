/**
 * Scenario Simulator — bir portföyün her senaryodaki brüt dönüşü.
 * Normal kupon: tüm seçimleri kazandıysa kesin (kuruş) dönüş. Sistem kuponu: yalnızca kazanan kolonların dönüşleri
 * toplanır; kolon sayısı küçükse kolon kolon (kuruşu kuruşuna), büyükse kolonlar dolaşılmadan (kolon başı ortalama tutarla).
 */
import type { MatchSelection, Plan } from '../types';
import { payoutPerColumnUnit, prepareShape, type PreparedShape } from '../lib/payout';
import type { OutcomeSpace } from './correlation';
import { computeRiskMetrics } from './riskMetrics';
import type { RiskMetrics } from './types';

const EXACT_COLUMN_LIMIT = 256;

type CompiledPart =
  | { kind: 'normal'; mask: number; amount: number }
  | { kind: 'system-exact'; columnMasks: number[]; returns: number[] }
  | { kind: 'system-shape'; positions: number[]; shape: PreparedShape; stakePerColumn: number };

function compilePlan(plan: Plan, space: OutcomeSpace, selectionsById: Map<string, MatchSelection>): CompiledPart[] {
  const bit = new Map(space.ids.map((id, i) => [id, i]));
  const maskOf = (ids: string[]) =>
    ids.reduce((m, id) => {
      const b = bit.get(id);
      if (b === undefined) throw new Error(`Senaryo uzayında olmayan seçim: ${id}`);
      return m | (1 << b);
    }, 0);
  return plan.parts.map((part): CompiledPart => {
    if (part.kind === 'normal') return { kind: 'normal', mask: maskOf(part.selectionIds), amount: part.grossReturnKurus };
    if (part.columns.length <= EXACT_COLUMN_LIMIT) {
      return { kind: 'system-exact', columnMasks: part.columns.map((c) => maskOf(c.selectionIds)), returns: part.columns.map((c) => c.returnKurus) };
    }
    const items = part.selectionIds.map((id) => selectionsById.get(id)!);
    return {
      kind: 'system-shape',
      positions: part.selectionIds.map((id) => bit.get(id)!),
      shape: prepareShape({ odds: items.map((s) => s.odds), minMatches: items.map((s) => s.minMatches), sizes: part.sizes }),
      stakePerColumn: part.stakeKurus / part.columns.length,
    };
  });
}

/** Her senaryo için portföyün brüt dönüşü (kuruş). */
export function portfolioGross(plan: Plan, space: OutcomeSpace, selectionsById: Map<string, MatchSelection>): Float64Array {
  const parts = compilePlan(plan, space, selectionsById);
  const maxN = Math.max(1, ...plan.parts.map((p) => p.selectionCount));
  const out = new Float64Array(maxN + 1);
  const scratch = new Float64Array(maxN + 1);
  const gross = new Float64Array(space.masks.length);
  for (let o = 0; o < space.masks.length; o++) {
    const w = space.masks[o];
    let total = 0;
    for (const part of parts) {
      if (part.kind === 'normal') {
        if ((w & part.mask) === part.mask) total += part.amount;
      } else if (part.kind === 'system-exact') {
        for (let c = 0; c < part.columnMasks.length; c++) if ((w & part.columnMasks[c]) === part.columnMasks[c]) total += part.returns[c];
      } else {
        let local = 0;
        for (let i = 0; i < part.positions.length; i++) if (w & (1 << part.positions[i])) local |= 1 << i;
        total += part.stakePerColumn * payoutPerColumnUnit(part.shape, local, out, scratch);
      }
    }
    gross[o] = total;
  }
  return gross;
}

export function evaluatePlanOnSpace(
  plan: Plan,
  space: OutcomeSpace,
  selectionsById: Map<string, MatchSelection>,
): { gross: Float64Array; metrics: RiskMetrics } {
  const gross = portfolioGross(plan, space, selectionsById);
  return { gross, metrics: computeRiskMetrics(gross, space.weights, plan.totalStakeKurus, plan.budgetKurus, space.method) };
}
