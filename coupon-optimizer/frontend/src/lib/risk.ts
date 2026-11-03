/** Kupon setinin maç bazında yoğunlaşma (maruziyet) analizi. */
import type { MatchSelection, Plan } from '../types';
import { planTerms } from './probability';
import { matchKey } from './validation';

export type MatchExposure = {
  matchName: string;
  selectionIds: string[];
  /** Bu maçı içeren kupon sayısı. */
  couponCount: number;
  /** Bu maç yatarsa kaybedilen yatırım: maçı içeren normal kuponlar + sistemlerde maçı içeren kolonlar. */
  exposedStakeKurus: number;
  /** exposedStakeKurus / toplam yatırım. */
  share: number;
  /** Yalnızca bu maç yatar, diğer hepsi tutarsa toplam dönüş. */
  returnIfOnlyThisLosesKurus: number;
};

export function matchExposures(plan: Plan, selections: readonly Pick<MatchSelection, 'id' | 'matchName'>[]): MatchExposure[] {
  const byId = new Map(selections.map((s) => [s.id, s]));
  const groups = new Map<string, { matchName: string; ids: Set<string> }>();
  for (const id of plan.selectionIds) {
    const name = byId.get(id)?.matchName ?? id;
    const key = matchKey(name);
    if (!groups.has(key)) groups.set(key, { matchName: name, ids: new Set() });
    groups.get(key)!.ids.add(id);
  }

  const index = new Map(plan.selectionIds.map((id, i) => [id, i]));
  const terms = planTerms(plan);
  const allWin = (1 << plan.selectionIds.length) - 1;

  return Array.from(groups.values())
    .map(({ matchName, ids }) => {
      const touches = (selectionIds: string[]) => selectionIds.some((id) => ids.has(id));
      let couponCount = 0;
      let exposed = 0;
      for (const part of plan.parts) {
        if (part.kind === 'normal') {
          if (touches(part.selectionIds)) {
            couponCount++;
            exposed += part.stakeKurus;
          }
        } else {
          const hit = part.columns.filter((c) => touches(c.selectionIds)).length;
          if (hit > 0) couponCount++;
          exposed += hit * part.perColumnKurus;
        }
      }
      const lostMask = Array.from(ids).reduce((m, id) => m | (1 << index.get(id)!), 0);
      const winners = allWin & ~lostMask;
      const returnIfOnlyThisLosesKurus = terms.reduce((sum, t) => ((t.mask & winners) === t.mask ? sum + t.amount : sum), 0);
      return {
        matchName,
        selectionIds: Array.from(ids),
        couponCount,
        exposedStakeKurus: exposed,
        share: plan.totalStakeKurus > 0 ? exposed / plan.totalStakeKurus : 0,
        returnIfOnlyThisLosesKurus,
      };
    })
    .sort((a, b) => b.share - a.share || b.couponCount - a.couponCount);
}
