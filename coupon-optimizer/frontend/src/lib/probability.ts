/**
 * Öznel olasılık modeli.
 *
 * "En kârlı" dağılımı hesaplayabilmek için bir olasılık gerekir; elimizdeki tek kaynak kullanıcının güven puanıdır.
 * Varsayım: güven puanı / 10 = kullanıcının kendi tahmini (7 → %70), en fazla %95. Seçimler birbirinden bağımsız sayılır.
 * Bu GERÇEK bir olasılık değildir; sonuçlar ancak kullanıcının tahminleri kadar iyidir.
 */
import type { MatchSelection, Plan, PlanStats, RiskProfile } from '../types';
import { payoutPerColumnUnit, prepareShape } from './payout';

export const MAX_SUBJECTIVE_PROB = 0.95;

/** Optimizasyon hedefi: beklenen dönüş − λ × standart sapma. λ büyüdükçe dağılım/güvence ağırlık kazanır. */
export const RISK_LAMBDA: Record<RiskProfile, number> = {
  cautious: 1,
  balanced: 0.5,
  aggressive: 0,
};

export const RISK_LABELS: Record<RiskProfile, { title: string; description: string }> = {
  cautious: {
    title: 'Temkinli',
    description: 'Hiç dönüş alamama ihtimalini azaltmaya öncelik verir; bütçeyi sistem ağırlıklı olarak daha çok kupona yayar.',
  },
  balanced: {
    title: 'Dengeli',
    description: 'Beklenen kâr ile risk arasında denge kurar; bütçenin en az yarısı sistem kuponlarına gider.',
  },
  aggressive: {
    title: 'Maksimum beklenen kâr',
    description: 'Beklenen dönüşü en yükseğe çıkarır; bütçeyi yine sistem ağırlıklı en az 2 kupona böler, riski en yüksektir.',
  },
};

export function subjectiveProbability(confidence: number): number {
  return Math.min(confidence / 10, MAX_SUBJECTIVE_PROB);
}

/** Bir ödeme terimi: `mask` içindeki seçimlerin hepsi kazanırsa `amount` öder. */
export type PayoutTerm = { mask: number; amount: number };

export type DistributionSummary = {
  mean: number;
  stdDev: number;
  probNoReturn: number;
  /** Dönüşün `threshold` değerini geçme olasılığı. */
  probAbove: number;
  max: number;
};

/** n bağımsız seçimin tüm 2^n sonucu üzerinden toplam ödemenin dağılım özetini çıkarır. */
export function summarizeDistribution(probs: readonly number[], terms: readonly PayoutTerm[], threshold = 0): DistributionSummary {
  const n = probs.length;
  let mean = 0;
  let secondMoment = 0;
  let probNoReturn = 0;
  let probAbove = 0;
  let max = 0;
  for (let winners = 0; winners < 1 << n; winners++) {
    let p = 1;
    for (let i = 0; i < n; i++) p *= winners & (1 << i) ? probs[i] : 1 - probs[i];
    if (p === 0) continue;
    let total = 0;
    for (const t of terms) if ((t.mask & winners) === t.mask) total += t.amount;
    mean += p * total;
    secondMoment += p * total * total;
    if (total === 0) probNoReturn += p;
    if (total > threshold) probAbove += p;
    if (total > max) max = total;
  }
  return { mean, stdDev: Math.sqrt(Math.max(0, secondMoment - mean * mean)), probNoReturn, probAbove, max };
}

/** Planın ödeme terimlerini plan seçimlerinin sırasına göre bit maskeleriyle çıkarır. */
export function planTerms(plan: Plan): PayoutTerm[] {
  const index = new Map(plan.selectionIds.map((id, i) => [id, i]));
  const maskOf = (ids: string[]) => ids.reduce((m, id) => m | (1 << index.get(id)!), 0);
  return plan.parts.flatMap((part) =>
    part.kind === 'normal'
      ? [{ mask: maskOf(part.selectionIds), amount: part.grossReturnKurus }]
      : part.columns.map((c) => ({ mask: maskOf(c.selectionIds), amount: c.returnKurus })),
  );
}

/**
 * Planın dağılım özeti. Tüm 2^n sonuç (n = plandaki seçim sayısı, en fazla 16) taranır; sistem kuponlarının dönüşü
 * kolonlar dolaşılmadan kazananların oranlarından hesaplanır.
 */
export function evaluatePlan(plan: Plan, selections: readonly MatchSelection[], riskProfile: RiskProfile): PlanStats {
  const byId = new Map(selections.map((s) => [s.id, s]));
  const index = new Map(plan.selectionIds.map((id, i) => [id, i]));
  const probs = plan.selectionIds.map((id) => subjectiveProbability(byId.get(id)?.confidence ?? 0));
  const maskOf = (ids: string[]) => ids.reduce((m, id) => m | (1 << index.get(id)!), 0);
  const maxSize = Math.max(...plan.parts.map((p) => p.selectionCount));
  const out = new Float64Array(maxSize + 1);
  const scratch = new Float64Array(maxSize + 1);

  const parts = plan.parts.map((part) => {
    if (part.kind === 'normal') return { mask: maskOf(part.selectionIds), amount: part.grossReturnKurus, positions: [] as number[], shape: null };
    // Seçim listeden silinmişse (öneri bayatsa) oran 1 sayılır; öneri yeniden hesaplanınca düzelir.
    const items = part.selectionIds.map((id) => byId.get(id));
    const shape = prepareShape({
      odds: items.map((s) => s?.odds ?? 1),
      minMatches: items.map((s) => s?.minMatches ?? 1),
      minSize: part.minSize,
    });
    return { mask: 0, amount: part.perColumnKurus, positions: part.selectionIds.map((id) => index.get(id)!), shape };
  });

  const n = probs.length;
  let mean = 0;
  let secondMoment = 0;
  let probNoReturn = 0;
  let probAbove = 0;
  let max = 0;
  for (let winners = 0; winners < 2 ** n; winners++) {
    let p = 1;
    for (let i = 0; i < n; i++) p *= winners & (1 << i) ? probs[i] : 1 - probs[i];
    if (p === 0) continue;
    let total = 0;
    for (const part of parts) {
      if (!part.shape) {
        if ((part.mask & winners) === part.mask) total += part.amount;
        continue;
      }
      let local = 0;
      part.positions.forEach((pos, i) => {
        if (winners & (1 << pos)) local |= 1 << i;
      });
      total += part.amount * payoutPerColumnUnit(part.shape, local, out, scratch);
    }
    mean += p * total;
    secondMoment += p * total * total;
    if (total < 0.5) probNoReturn += p;
    if (total > plan.totalStakeKurus) probAbove += p;
    if (total > max) max = total;
  }
  const d = { mean, stdDev: Math.sqrt(Math.max(0, secondMoment - mean * mean)), probNoReturn, probAbove, max };
  return {
    stakeKurus: plan.totalStakeKurus,
    expectedReturnKurus: Math.round(d.mean),
    expectedProfitKurus: Math.round(d.mean) - plan.totalStakeKurus,
    stdDevKurus: Math.round(d.stdDev),
    probNoReturn: d.probNoReturn,
    probProfit: d.probAbove,
    maxReturnKurus: Math.round(d.max),
    score: d.mean - RISK_LAMBDA[riskProfile] * d.stdDev,
  };
}
