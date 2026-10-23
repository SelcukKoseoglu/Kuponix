/**
 * Bütçe dağılımı optimizasyonu: alternatif listesi yerine tek bir önerilen kupon seti üretir.
 *
 * Yaklaşım:
 * 1. Havuz: geçerli ve sonucu henüz belli olmayan seçimler. PORTFOLIO_POOL_LIMIT'ten fazlaysa
 *    öznel beklenen dönüşü (olasılık × oran) en yüksek olanlar alınır.
 * 2. Aday kuponlar: 1–4 seçimli normal kuponlar ve 3–5 seçimli tüm geçerli "Sistem k,…,n" kuponları.
 *    Aynı maçtan iki seçim aynı kupona konmaz. Min. maç kuralına uymayan kolonlar atılır.
 * 3. Her aday için 1 TL'lik ödeme dağılımı havuzun tüm 2^m sonucu üzerinden çıkarılır,
 *    ardından adaylar arası kovaryans hesaplanır (aynı seçimi paylaşan kuponlar birlikte kazanır/kaybeder).
 * 4. Hedef: beklenen dönüş − λ × standart sapma (λ risk tercihine göre). Bütçe birimlere (ör. 10 TL) bölünür ve
 *    açgözlü dağıtım + birim aktarma ile yerel iyileştirme yapılır (birden çok başlangıç). En fazla MAX_COUPONS kupon.
 * 5. Normal kupon en az 50 TL; toplam tutar bütçeyi asla aşmaz; bütçenin tamamı dağıtılır.
 */
import type { Comparison, MatchSelection, OptimizationResult, PartInput, Plan, PlanInput, RiskProfile } from '../types';
import { MIN_SYSTEM_SELECTIONS } from './calculator';
import { combinations } from './combinatorics';
import { MIN_NORMAL_STAKE_KURUS, formatTL } from './money';
import { buildPlan, planSignature } from './plan';
import { RISK_LABELS, RISK_LAMBDA, evaluatePlan, subjectiveProbability, summarizeDistribution, type PayoutTerm } from './probability';
import { describeSelection, validateSelection } from './validation';

export const PORTFOLIO_POOL_LIMIT = 12;
export const MAX_COUPONS = 4;
export const MAX_NORMAL_SIZE = 4;
export const MAX_PORTFOLIO_SYSTEM_SIZE = 5;
export const SHORTLIST_SIZE = 60;
const LOCAL_SEARCH_LIMIT = 400;
const START_COUNT = 6;

/** Bütçenin dağıtıldığı birim: 200 TL ve üstünde 10 TL, 50 TL ve üstünde 5 TL, altında 1 TL. */
export function stakeUnitKurus(budgetKurus: number): number {
  if (budgetKurus >= 20000) return 1000;
  if (budgetKurus >= 5000) return 500;
  return 100;
}

type Candidate = {
  kind: 'normal' | 'system';
  indices: number[];
  minSize: number;
  /** 1 birim (1 TL) yatırım için ödemeler; maskeler havuz dizinleri üzerinde. */
  terms: PayoutTerm[];
  mean: number;
  std: number;
  probNoReturn: number;
  minUnits: number;
};

const matchKey = (s: MatchSelection) => s.matchName.trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');

function hasSameMatch(items: MatchSelection[]): boolean {
  return new Set(items.map(matchKey)).size !== items.length;
}

function buildCandidate(
  pool: MatchSelection[],
  probs: number[],
  indices: number[],
  kind: Candidate['kind'],
  minSize: number,
  normalMinUnits: number,
): Candidate | null {
  const items = indices.map((i) => pool[i]);
  if (hasSameMatch(items)) return null;
  const n = items.length;
  const local = items.map((_, i) => i);
  const localTerms: PayoutTerm[] = [];

  if (kind === 'normal') {
    if (items.some((s) => s.minMatches > n)) return null;
    localTerms.push({ mask: (1 << n) - 1, amount: items.reduce((p, s) => p * s.odds, 1) });
  } else {
    for (let size = minSize; size <= n; size++) {
      for (const combo of combinations(local, size)) {
        if (combo.some((i) => items[i].minMatches > size)) continue;
        localTerms.push({ mask: combo.reduce((m, i) => m | (1 << i), 0), amount: combo.reduce((p, i) => p * items[i].odds, 1) });
      }
    }
    if (localTerms.length === 0) return null;
    const share = 1 / localTerms.length;
    localTerms.forEach((t) => (t.amount *= share));
  }

  const d = summarizeDistribution(indices.map((i) => probs[i]), localTerms);
  const toPoolMask = (mask: number) => local.reduce((m, i) => (mask & (1 << i) ? m | (1 << indices[i]) : m), 0);
  return {
    kind,
    indices,
    minSize,
    terms: localTerms.map((t) => ({ mask: toPoolMask(t.mask), amount: t.amount })),
    mean: d.mean,
    std: d.stdDev,
    probNoReturn: d.probNoReturn,
    minUnits: kind === 'normal' ? normalMinUnits : 1,
  };
}

function generateCandidates(pool: MatchSelection[], probs: number[], normalMinUnits: number, allowNormal: boolean) {
  const all = pool.map((_, i) => i);
  const candidates: Candidate[] = [];
  if (allowNormal) {
    for (let size = 1; size <= Math.min(MAX_NORMAL_SIZE, pool.length); size++) {
      for (const idx of combinations(all, size)) {
        const c = buildCandidate(pool, probs, idx, 'normal', size, normalMinUnits);
        if (c) candidates.push(c);
      }
    }
  }
  for (let size = MIN_SYSTEM_SELECTIONS; size <= Math.min(MAX_PORTFOLIO_SYSTEM_SIZE, pool.length); size++) {
    for (const idx of combinations(all, size)) {
      for (let k = 2; k < size; k++) {
        const c = buildCandidate(pool, probs, idx, 'system', k, normalMinUnits);
        if (c) candidates.push(c);
      }
    }
  }
  return candidates;
}

const individualScore = (c: Candidate, lambda: number) => c.mean - lambda * c.std;

function shortlist(candidates: Candidate[], lambda: number): Candidate[] {
  const picked = new Set<Candidate>();
  const take = (sorted: Candidate[], n: number) => sorted.slice(0, n).forEach((c) => picked.add(c));
  take([...candidates].sort((a, b) => individualScore(b, lambda) - individualScore(a, lambda)), 40);
  take([...candidates].sort((a, b) => b.mean - a.mean), 10);
  take([...candidates].sort((a, b) => a.probNoReturn - b.probNoReturn || b.mean - a.mean), 10);
  return Array.from(picked).slice(0, SHORTLIST_SIZE);
}

/** Adayların havuzun tüm sonuçları üzerinden ortalama ve kovaryans matrisi. */
function moments(candidates: Candidate[], probs: number[]) {
  const m = probs.length;
  const outcomes = 1 << m;
  const pw = new Float64Array(outcomes);
  for (let w = 0; w < outcomes; w++) {
    let p = 1;
    for (let i = 0; i < m; i++) p *= w & (1 << i) ? probs[i] : 1 - probs[i];
    pw[w] = p;
  }
  const vectors = candidates.map((c) => {
    const v = new Float64Array(outcomes);
    for (let w = 0; w < outcomes; w++) {
      let total = 0;
      for (const t of c.terms) if ((t.mask & w) === t.mask) total += t.amount;
      v[w] = total;
    }
    return v;
  });
  const mu = vectors.map((v) => v.reduce((sum, x, w) => sum + pw[w] * x, 0));
  const k = candidates.length;
  const cov = Array.from({ length: k }, () => new Float64Array(k));
  for (let i = 0; i < k; i++) {
    for (let j = i; j < k; j++) {
      let e = 0;
      const vi = vectors[i];
      const vj = vectors[j];
      for (let w = 0; w < outcomes; w++) if (pw[w] > 0) e += pw[w] * vi[w] * vj[w];
      cov[i][j] = cov[j][i] = e - mu[i] * mu[j];
    }
  }
  return { mu, cov };
}

type State = { w: number[]; s: number[]; q: number; m: number; active: number; used: number };

function allocate(
  candidates: Candidate[],
  mu: number[],
  cov: Float64Array[],
  totalUnits: number,
  lambda: number,
  start?: number,
): State {
  const k = candidates.length;
  const st: State = { w: new Array(k).fill(0), s: new Array(k).fill(0), q: 0, m: 0, active: 0, used: 0 };
  const objective = (m: number, q: number) => m - lambda * Math.sqrt(Math.max(q, 0));
  const apply = (i: number, d: number) => {
    st.q += 2 * d * st.s[i] + d * d * cov[i][i];
    st.m += d * mu[i];
    for (let j = 0; j < k; j++) st.s[j] += d * cov[j][i];
    const before = st.w[i];
    st.w[i] += d;
    if (before === 0 && st.w[i] > 0) st.active++;
    else if (before > 0 && st.w[i] === 0) st.active--;
    st.used += d;
  };

  if (start !== undefined && candidates[start].minUnits <= totalUnits) apply(start, candidates[start].minUnits);

  // Açgözlü dağıtım: her adımda birim başına hedefi en çok artıran kupona tutar ekle.
  while (st.used < totalUnits) {
    const f0 = objective(st.m, st.q);
    let best = -1;
    let bestD = 0;
    let bestGain = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < k; i++) {
      const d = st.w[i] > 0 ? 1 : candidates[i].minUnits;
      if (st.used + d > totalUnits) continue;
      if (st.w[i] === 0 && st.active >= MAX_COUPONS) continue;
      const gain = (objective(st.m + d * mu[i], st.q + 2 * d * st.s[i] + d * d * cov[i][i]) - f0) / d;
      if (gain > bestGain) {
        bestGain = gain;
        best = i;
        bestD = d;
      }
    }
    if (best < 0) break;
    apply(best, bestD);
  }

  // Yerel iyileştirme: bir kupondan diğerine tutar aktararak hedefi artır.
  const canHold = (i: number, units: number) => units === 0 || units >= candidates[i].minUnits;
  for (let iter = 0; iter < LOCAL_SEARCH_LIMIT; iter++) {
    const f0 = objective(st.m, st.q);
    let bestMove: [number, number, number] | null = null;
    let bestF = f0 + 1e-9;
    for (let i = 0; i < k; i++) {
      if (st.w[i] === 0) continue;
      for (let j = 0; j < k; j++) {
        if (j === i) continue;
        const options = new Set([1, st.w[i], st.w[j] === 0 ? candidates[j].minUnits : 1]);
        for (const d of options) {
          if (d > st.w[i] || !canHold(i, st.w[i] - d) || !canHold(j, st.w[j] + d)) continue;
          const activeAfter = st.active - (st.w[i] - d === 0 ? 1 : 0) + (st.w[j] === 0 ? 1 : 0);
          if (activeAfter > MAX_COUPONS) continue;
          const q2 = st.q + 2 * d * (st.s[j] - st.s[i]) + d * d * (cov[i][i] + cov[j][j] - 2 * cov[i][j]);
          const f = objective(st.m + d * (mu[j] - mu[i]), q2);
          if (f > bestF) {
            bestF = f;
            bestMove = [i, j, d];
          }
        }
      }
    }
    if (!bestMove) break;
    const [i, j, d] = bestMove;
    apply(i, -d);
    apply(j, d);
  }
  return st;
}

function partFor(c: Candidate, pool: MatchSelection[], amountKurus: number): PartInput {
  const selectionIds = c.indices.map((i) => pool[i].id);
  return c.kind === 'normal'
    ? { kind: 'normal', selectionIds, stakeKurus: amountKurus }
    : { kind: 'system', selectionIds, minSize: c.minSize, allocatedKurus: amountKurus };
}

function describeParts(parts: PartInput[]): string {
  const normals = parts.filter((p) => p.kind === 'normal').length;
  const systems = parts.length - normals;
  const pieces = [normals ? `${normals} normal` : '', systems ? `${systems} sistem` : ''].filter(Boolean).join(' + ');
  return parts.length === 1
    ? `Bütçenin tamamı tek ${normals ? 'normal' : 'sistem'} kupona yatırıldı; seçtiğin risk tercihinde bölmek hedefi iyileştirmedi.`
    : `Bütçe ${pieces} kupona bölündü. Kuponlar birbirinin kayıplarını kısmen dengeler.`;
}

export function generatePlans(
  selections: readonly MatchSelection[],
  budgetKurus: number | null,
  riskProfile: RiskProfile = 'balanced',
): OptimizationResult {
  const notes: string[] = [];
  const lambda = RISK_LAMBDA[riskProfile];
  const base: OptimizationResult = {
    plan: null,
    stats: null,
    comparisons: [],
    riskProfile,
    notes,
    budgetKurus: budgetKurus ?? 0,
    validSelectionCount: 0,
    usedPoolSize: 0,
    pruned: false,
  };

  if (budgetKurus === null || !Number.isInteger(budgetKurus) || budgetKurus <= 0) {
    notes.push("Geçerli bir bütçe girin (0'dan büyük).");
    return base;
  }

  const seen = new Set<string>();
  const valid = selections.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return validateSelection(s).length === 0;
  });
  base.validSelectionCount = valid.length;
  if (valid.length < selections.length) {
    notes.push(`${selections.length - valid.length} seçim geçersiz veya tekrar eden kimliğe sahip olduğu için hesaplamaya alınmadı.`);
  }
  const open = valid.filter((s) => (s.result ?? 'pending') === 'pending');
  if (open.length < valid.length) {
    notes.push(`${valid.length - open.length} seçimin sonucu işaretlendiği için yeni öneriye alınmadı.`);
  }
  if (open.length === 0) {
    notes.push('Öneri için sonucu bekleyen en az bir geçerli seçim ekleyin.');
    return base;
  }

  let pool = open;
  if (open.length > PORTFOLIO_POOL_LIMIT) {
    base.pruned = true;
    pool = [...open]
      .sort((a, b) => subjectiveProbability(b.confidence) * b.odds - subjectiveProbability(a.confidence) * a.odds || b.confidence - a.confidence)
      .slice(0, PORTFOLIO_POOL_LIMIT);
    notes.push(
      `Performans sınırı: ${open.length} seçimden, güven puanına göre beklenen dönüşü (güven × oran) en yüksek ${PORTFOLIO_POOL_LIMIT} seçim değerlendirildi.`,
    );
  }
  base.usedPoolSize = pool.length;

  const unusable = pool.filter((s) => s.minMatches > Math.max(MAX_NORMAL_SIZE, MAX_PORTFOLIO_SYSTEM_SIZE));
  if (unusable.length > 0) {
    notes.push(`${unusable.map(describeSelection).join(', ')}: minimum maç sayısı önerilen en büyük kupon boyutundan (5) büyük olduğu için kullanılamadı.`);
  }
  if (new Set(pool.map(matchKey)).size < pool.length) {
    notes.push('Aynı maçtan birden fazla seçim var; bunlar aynı kupona konmadı.');
  }

  const unit = stakeUnitKurus(budgetKurus);
  const totalUnits = Math.floor(budgetKurus / unit);
  const normalMinUnits = Math.ceil(MIN_NORMAL_STAKE_KURUS / unit);
  const allowNormal = budgetKurus >= MIN_NORMAL_STAKE_KURUS;
  if (!allowNormal) notes.push(`Bütçe ${formatTL(MIN_NORMAL_STAKE_KURUS)} altında olduğu için normal kupon kullanılmadı (yalnızca sistem kuponu).`);

  const probs = pool.map((s) => subjectiveProbability(s.confidence));
  const candidates = generateCandidates(pool, probs, normalMinUnits, allowNormal);
  if (candidates.length === 0) {
    notes.push(
      pool.length < MIN_SYSTEM_SELECTIONS && !allowNormal
        ? `Sistem kuponu için en az ${MIN_SYSTEM_SELECTIONS} seçim gerekir.`
        : 'Minimum maç koşulları veya aynı maç kısıtı nedeniyle hiçbir kupon oluşturulamadı.',
    );
    notes.push('Girilen seçimler ve bütçeyle geçerli bir öneri bulunamadı.');
    return base;
  }

  const list = shortlist(candidates, lambda);
  const { mu, cov } = moments(list, probs);
  const order = list.map((_, i) => i).sort((a, b) => individualScore(list[b], lambda) - individualScore(list[a], lambda));
  const starts: (number | undefined)[] = [undefined, ...order.slice(0, START_COUNT)];
  let best: State | null = null;
  let bestF = Number.NEGATIVE_INFINITY;
  for (const start of starts) {
    const st = allocate(list, mu, cov, totalUnits, lambda, start);
    if (st.active === 0) continue;
    const f = st.m - lambda * Math.sqrt(Math.max(st.q, 0));
    if (f > bestF) {
      bestF = f;
      best = st;
    }
  }

  const buildInput = (strategy: PlanInput['strategy'], label: string, parts: PartInput[], description: string): PlanInput => ({
    strategy,
    label,
    description,
    parts,
  });

  let recommended: Plan | null = null;
  if (best) {
    const active = best.w.map((units, i) => ({ i, units })).filter((x) => x.units > 0).sort((a, b) => b.units - a.units);
    const remainder = budgetKurus - best.used * unit;
    const parts = active.map(({ i, units }, idx) => partFor(list[i], pool, units * unit + (idx === 0 ? remainder : 0)));
    const built = buildPlan(buildInput('recommended', 'Önerilen kuponlar', parts, describeParts(parts)), pool, budgetKurus);
    if (built.ok) recommended = built.plan;
    else notes.push(`Önerilen dağılım doğrulanamadı: ${built.errors.join(' ')}`);
  }

  // Karşılaştırma: tüm bütçeyi tek kupona koymak.
  const comparisons: Comparison[] = [];
  const bestOf = (kind: Candidate['kind']) =>
    candidates.filter((c) => c.kind === kind).sort((a, b) => individualScore(b, lambda) - individualScore(a, lambda))[0];
  const singles: [Candidate | undefined, PlanInput['strategy'], string][] = [
    [bestOf('normal'), 'all-in-normal', 'Tamamı tek normal kupona'],
    [bestOf('system'), 'all-in-system', 'Tamamı tek sistem kuponuna'],
  ];
  for (const [c, strategy, label] of singles) {
    if (!c) continue;
    const built = buildPlan(buildInput(strategy, label, [partFor(c, pool, budgetKurus)], ''), pool, budgetKurus);
    if (built.ok) comparisons.push({ label, plan: built.plan, stats: evaluatePlan(built.plan, pool, riskProfile) });
  }

  let stats = recommended ? evaluatePlan(recommended, pool, riskProfile) : null;
  // Güvence: kuruş yuvarlaması vb. nedeniyle tek kupon daha iyi çıkarsa onu öner.
  for (const cmp of comparisons) {
    if (!stats || cmp.stats.score > stats.score + 1) {
      recommended = {
        ...cmp.plan,
        strategy: 'recommended',
        label: 'Önerilen kuponlar',
        description: describeParts(cmp.plan.input.parts),
        input: { ...cmp.plan.input, strategy: 'recommended', label: 'Önerilen kuponlar', description: describeParts(cmp.plan.input.parts) },
      };
      stats = cmp.stats;
    }
  }

  if (!recommended || !stats) {
    notes.push('Girilen seçimler ve bütçeyle geçerli bir öneri bulunamadı.');
    return { ...base, comparisons };
  }

  if (stats.expectedProfitKurus < 0) {
    notes.push(
      'Kendi güven puanlarına göre bile beklenen dönüş yatırılan tutarın altında. Bu, oranların puanlarına göre düşük kaldığı anlamına gelir; oynamamak da bir seçenektir.',
    );
  }

  const recommendedSignature = planSignature(recommended.input);
  return {
    ...base,
    plan: recommended,
    stats,
    comparisons: comparisons.filter((c) => planSignature(c.plan.input) !== recommendedSignature),
    notes: [...notes, `Risk tercihi: ${RISK_LABELS[riskProfile].title}.`],
  };
}
