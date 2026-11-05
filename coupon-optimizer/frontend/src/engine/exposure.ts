/**
 * Ortak seçim yoğunlaşması: bir seçim (veya maç) kaybederse kaç kupon/kolon ve ne kadar tutar etkilenir.
 * Aynı seçim birden fazla kuponda kullanıldığında bu kuponlar bağımsız fırsatlar değil, aynı riske bağlı tutarlardır.
 */
import type { MatchSelection, Plan } from '../types';
import type { ExposureRow } from './types';

type Acc = { label: string; coupons: number; columns: number; stake: number };

export function computeExposures(
  plan: Plan,
  selectionsById: Map<string, Pick<MatchSelection, 'id' | 'matchId' | 'matchName' | 'marketSelection'>>,
  budgetKurus: number,
): { selections: ExposureRow[]; matches: ExposureRow[] } {
  const bySelection = new Map<string, Acc>();
  const byMatch = new Map<string, Acc>();
  const get = (map: Map<string, Acc>, key: string, label: string) => {
    if (!map.has(key)) map.set(key, { label, coupons: 0, columns: 0, stake: 0 });
    return map.get(key)!;
  };

  for (const part of plan.parts) {
    const touchedSelections = new Set<string>();
    const touchedMatches = new Set<string>();
    const legs =
      part.kind === 'normal'
        ? [{ ids: part.selectionIds, stake: part.stakeKurus }]
        : part.columns.map((c) => ({ ids: c.selectionIds, stake: c.stakeKurus }));
    for (const leg of legs) {
      const legMatches = new Set<string>();
      for (const id of leg.ids) {
        const s = selectionsById.get(id);
        if (!s) continue;
        const acc = get(bySelection, id, `${s.matchName} · ${s.marketSelection}`);
        acc.columns++;
        acc.stake += leg.stake;
        touchedSelections.add(id);
        legMatches.add(s.matchId);
      }
      for (const matchId of legMatches) {
        const s = leg.ids.map((id) => selectionsById.get(id)).find((x) => x?.matchId === matchId)!;
        const acc = get(byMatch, matchId, s.matchName);
        acc.columns++;
        acc.stake += leg.stake;
        touchedMatches.add(matchId);
      }
    }
    touchedSelections.forEach((id) => bySelection.get(id)!.coupons++);
    touchedMatches.forEach((m) => byMatch.get(m)!.coupons++);
  }

  const rows = (map: Map<string, Acc>): ExposureRow[] =>
    Array.from(map.entries())
      .map(([key, a]) => ({
        key,
        label: a.label,
        couponCount: a.coupons,
        columnCount: a.columns,
        exposedStakeKurus: a.stake,
        budgetPct: budgetKurus > 0 ? (a.stake / budgetKurus) * 100 : 0,
      }))
      .sort((x, y) => y.exposedStakeKurus - x.exposedStakeKurus);

  return { selections: rows(bySelection), matches: rows(byMatch) };
}
