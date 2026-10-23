/**
 * Öznel olasılık modeli.
 *
 * "En kârlı" dağılımı hesaplayabilmek için bir olasılık gerekir; elimizdeki tek kaynak kullanıcının güven puanıdır.
 * Varsayım: güven puanı / 10 = kullanıcının kendi tahmini (7 → %70), en fazla %95. Seçimler birbirinden bağımsız sayılır.
 * Bu GERÇEK bir olasılık değildir; sonuçlar ancak kullanıcının tahminleri kadar iyidir.
 */
import type { MatchSelection, Plan, PlanStats, RiskProfile } from '../types';

export const MAX_SUBJECTIVE_PROB = 0.95;

/** Optimizasyon hedefi: beklenen dönüş − λ × standart sapma. λ büyüdükçe dağılım/güvence ağırlık kazanır. */
export const RISK_LAMBDA: Record<RiskProfile, number> = {
  cautious: 1,
  balanced: 0.5,
  aggressive: 0,
};

export const RISK_LABELS: Record<RiskProfile, { title: string; description: string }> = {
  cautious: { title: 'Temkinli', description: 'Hiç dönüş alamama ihtimalini azaltmaya öncelik verir; bütçeyi daha çok kupona yayar.' },
  balanced: { title: 'Dengeli', description: 'Beklenen kâr ile risk arasında denge kurar.' },
  aggressive: {
    title: 'Maksimum beklenen kâr',
    description: 'Yalnızca beklenen dönüşe bakar; genellikle bütçenin tamamını tek kupona koyar ve riski en yüksektir.',
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

export function evaluatePlan(plan: Plan, selections: readonly MatchSelection[], riskProfile: RiskProfile): PlanStats {
  const byId = new Map(selections.map((s) => [s.id, s]));
  const probs = plan.selectionIds.map((id) => subjectiveProbability(byId.get(id)?.confidence ?? 0));
  const d = summarizeDistribution(probs, planTerms(plan), plan.totalStakeKurus);
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
