/**
 * Kupon sonuçlandırma: kullanıcının işaretlediği maç sonuçlarına göre kuponların gerçek dönüşü ve kâr/zararı.
 * İade (void) seçimin oranı 1,00 sayılır. Bekleyen seçim varsa sonuç kesinleşmemiştir.
 */
import type { CouponPart, Plan, SelectionResult } from '../types';
import { grossReturnKurus } from './calculator';

export type LegStatus = 'won' | 'lost' | 'pending';

export type PartSettlement = {
  part: CouponPart;
  status: LegStatus;
  stakeKurus: number;
  /** Kesinleşmiş dönüş (kazanan kolonlar/kupon). */
  settledReturnKurus: number;
  /** Bekleyen seçimler de kazanırsa ulaşılabilecek toplam dönüş. */
  potentialReturnKurus: number;
  wonColumns: number;
  lostColumns: number;
  pendingColumns: number;
};

export type PlanSettlement = {
  parts: PartSettlement[];
  stakeKurus: number;
  settledReturnKurus: number;
  potentialReturnKurus: number;
  isSettled: boolean;
  /** Kesinleşmiş dönüş − yatırılan. Bekleyen varsa ara durumdur. */
  profitKurus: number;
  pendingSelectionCount: number;
};

type Leg = { ids: string[]; stakeKurus: number };

function settleLeg(leg: Leg, oddsById: Map<string, number>, results: Map<string, SelectionResult>) {
  const statuses = leg.ids.map((id) => results.get(id) ?? 'pending');
  const odds = leg.ids.map((id, i) => (statuses[i] === 'void' ? 1 : oddsById.get(id)!));
  if (statuses.includes('lost')) return { status: 'lost' as const, amount: 0 };
  const amount = grossReturnKurus(leg.stakeKurus, odds);
  return { status: statuses.includes('pending') ? ('pending' as const) : ('won' as const), amount };
}

export function settlePlan(plan: Plan, oddsById: Map<string, number>, results: Map<string, SelectionResult>): PlanSettlement {
  const parts = plan.parts.map((part): PartSettlement => {
    const legs: Leg[] =
      part.kind === 'normal'
        ? [{ ids: part.selectionIds, stakeKurus: part.stakeKurus }]
        : part.columns.map((c) => ({ ids: c.selectionIds, stakeKurus: part.perColumnKurus }));
    let settled = 0;
    let potential = 0;
    let won = 0;
    let lost = 0;
    let pending = 0;
    for (const leg of legs) {
      const r = settleLeg(leg, oddsById, results);
      if (r.status === 'won') {
        settled += r.amount;
        potential += r.amount;
        won++;
      } else if (r.status === 'pending') {
        potential += r.amount;
        pending++;
      } else {
        lost++;
      }
    }
    return {
      part,
      status: pending > 0 ? 'pending' : settled > 0 ? 'won' : 'lost',
      stakeKurus: part.stakeKurus,
      settledReturnKurus: settled,
      potentialReturnKurus: potential,
      wonColumns: won,
      lostColumns: lost,
      pendingColumns: pending,
    };
  });

  const stakeKurus = parts.reduce((s, p) => s + p.stakeKurus, 0);
  const settledReturnKurus = parts.reduce((s, p) => s + p.settledReturnKurus, 0);
  return {
    parts,
    stakeKurus,
    settledReturnKurus,
    potentialReturnKurus: parts.reduce((s, p) => s + p.potentialReturnKurus, 0),
    isSettled: parts.every((p) => p.pendingColumns === 0),
    profitKurus: settledReturnKurus - stakeKurus,
    pendingSelectionCount: plan.selectionIds.filter((id) => (results.get(id) ?? 'pending') === 'pending').length,
  };
}
