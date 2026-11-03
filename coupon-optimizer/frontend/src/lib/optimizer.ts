/**
 * Bütçe dağılımı optimizasyonu: alternatif listesi yerine tek bir önerilen kupon seti üretir.
 *
 * Yaklaşım:
 * 1. Havuz: geçerli ve sonucu henüz belli olmayan seçimler. PORTFOLIO_POOL_LIMIT'ten fazlaysa
 *    öznel beklenen dönüşü (olasılık × oran) en yüksek olanlar alınır.
 * 2. Aday kuponlar: 1–4 seçimli tüm normal kuponlar ve 3–5 seçimli tüm "Sistem k,…,n" kuponları taranır. Daha büyük
 *    kombineler ve sistemler (6 maçtan havuzdaki tüm maçlara kadar, her k ile) üç farklı sıralamanın — öznel beklenen
 *    dönüş, güven, güven ÷ oran — ilk n maçından kurulur. Sistem boyutuna ayrıca bir sınır yoktur.
 *    Aynı maçtan iki seçim aynı kupona konmaz. Min. maç kuralına uymayan kolonlar atılır.
 * 3. Ödemeler kolonlar dolaşılmadan kazananların oranlarından hesaplanır (payout.ts). Havuz 12 maça kadarsa tüm 2^m
 *    sonuç, daha büyükse sabit tohumlu örnek senaryolar kullanılır; adaylar arası kovaryans bunlardan çıkarılır
 *    (aynı seçimi paylaşan kuponlar birlikte kazanır/kaybeder).
 * 4. Hedef: beklenen dönüş − λ × standart sapma (λ risk tercihine göre). Bütçe birimlere (ör. 10 TL) bölünür ve
 *    açgözlü dağıtım + birim aktarma ile yerel iyileştirme yapılır (birden çok başlangıç). En fazla MAX_COUPONS kupon.
 * 5. Bir maçın kaç kupona gireceği sınırlanmaz; algoritma uygun görürse bir maç tüm kuponlarda yer alabilir.
 * 6. Sistem ağırlığı (tüm risk tercihlerinde): sistem kurulabiliyorsa öneride en az bir sistem kuponu bulunur ve bütçenin
 *    en az MIN_SYSTEM_SHARE kadarı sistem kuponlarına gider. Bütçe yetiyorsa en az 2 kupona bölünür (tek kupona yatırılmaz).
 *    Bu kurallar karşılanamazsa adım adım gevşetilir ve nedeni not olarak yazılır.
 * 7. Her kupon (normal ve sistem) en az 50 TL; toplam tutar bütçeyi asla aşmaz; bütçenin tamamı dağıtılır.
 */
import type { Comparison, MatchSelection, OptimizationResult, PartInput, Plan, PlanInput, RiskProfile } from '../types';
import { MIN_SYSTEM_SELECTIONS } from './calculator';
import { combinations } from './combinatorics';
import { MIN_STAKE_KURUS, formatTL } from './money';
import { outcomeSet, payoutPerColumnUnit, prepareShape, winningSums, type OutcomeSet, type PreparedShape } from './payout';
import { buildPlan, planSignature } from './plan';
import { RISK_LABELS, RISK_LAMBDA, evaluatePlan, subjectiveProbability } from './probability';
import { describeSelection, matchKey, validateSelection } from './validation';

/** Aynı anda değerlendirilen en fazla maç (seçim) sayısı; tarayıcıda hesaplama süresini makul tutar. */
export const PORTFOLIO_POOL_LIMIT = 16;
export const MAX_COUPONS = 4;
/** Bu boyuta kadar tüm alt kümeler taranır; daha büyük kupon/sistemler sıralama öneklerinden kurulur. */
export const FULL_SCAN_NORMAL_SIZE = 4;
export const FULL_SCAN_SYSTEM_SIZE = 5;
/** Havuzun tüm sonuçları en fazla bu kadarsa kesin hesaplanır (12 maç); üstünde örnek senaryo kullanılır. */
const EXACT_OUTCOME_LIMIT = 4096;
const OUTCOME_SAMPLES = 4096;
/** Tek bir sistem adayının kendi dağılımı bu boyuta kadar kesin, üstünde örneklemle hesaplanır. */
const LOCAL_EXACT_SIZE = 10;
export const SHORTLIST_SIZE = 180;
/** Kısa listede "bu maçlar olmadan" alternatifleri aranacak en gözde maç sayısı (çeşitlilik için). */
const FAVOURITE_GROUPS = 4;
const LOCAL_SEARCH_LIMIT = 400;
/** Bütçenin sistem kuponlarına gidecek en az payı. */
export const MIN_SYSTEM_SHARE = 0.5;
const START_COUNT = 6;

/** Bütçenin dağıtıldığı birim: 200 TL ve üstünde 10 TL, 50 TL ve üstünde 5 TL, altında 1 TL. */
export function stakeUnitKurus(budgetKurus: number): number {
  if (budgetKurus >= 20000) return 1000;
  if (budgetKurus >= 5000) return 500;
  return 100;
}

type Candidate = {
  kind: 'normal' | 'system';
  /** Havuzdaki seçim dizinleri. */
  indices: number[];
  minSize: number;
  /** Sistem: seçimlerin şekli (kolon başına ödeme hesabı için); normal: null. */
  shape: PreparedShape | null;
  /** Geçerli kolon sayısı (normal: 1). */
  columns: number;
  /** Normal kupon için oranların çarpımı. */
  product: number;
  /** 1 TL'lik kupon için öznel ortalama dönüş, standart sapma ve hiç dönüş alamama olasılığı. */
  mean: number;
  std: number;
  probNoReturn: number;
  minUnits: number;
  /** Kupondaki maçların grup (maç) dizinleri. */
  groups: number[];
};

function hasSameMatch(items: MatchSelection[]): boolean {
  return new Set(items.map((s) => matchKey(s.matchName))).size !== items.length;
}

/**
 * Sistem kuponunun en az kaç birim alması gerektiği: kolon başına tutar kuruşa aşağı yuvarlandığı için
 * fiili tutarın (kolon başı × kolon sayısı) 50 TL'nin altına düşmemesi gerekir.
 */
export function systemMinUnits(columns: number, unitKurus: number): number {
  return Math.ceil((Math.ceil(MIN_STAKE_KURUS / columns) * columns) / unitKurus);
}

type BuildContext = { pool: MatchSelection[]; probs: number[]; unitKurus: number; totalUnits: number; groupOf: number[] };

/** Normal (kombine) kupon adayı; dağılımı kapalı formdadır: hepsi tutarsa oranların çarpımı, yoksa 0. */
function normalCandidate(ctx: BuildContext, indices: number[]): Candidate | null {
  const items = indices.map((i) => ctx.pool[i]);
  if (hasSameMatch(items) || items.some((s) => s.minMatches > items.length)) return null;
  const minUnits = Math.ceil(MIN_STAKE_KURUS / ctx.unitKurus);
  if (minUnits > ctx.totalUnits) return null;
  const win = indices.reduce((p, i) => p * ctx.probs[i], 1);
  const product = items.reduce((p, s) => p * s.odds, 1);
  return {
    kind: 'normal',
    indices,
    minSize: items.length,
    shape: null,
    columns: 1,
    product,
    mean: win * product,
    std: product * Math.sqrt(win * (1 - win)),
    probNoReturn: 1 - win,
    minUnits,
    groups: indices.map((i) => ctx.groupOf[i]),
  };
}

/**
 * Aynı seçimlerle kurulabilecek tüm "Sistem k,…,n" adayları (2 ≤ k < n). Her sonuç için kazanan kolon toplamları bir kez
 * hesaplanır ve tüm k değerleri için kullanılır. Bütçeye sığmayan (50 TL alt sınırı nedeniyle) biçimler atlanır.
 */
function systemFamily(ctx: BuildContext, indices: number[]): Candidate[] {
  const items = indices.map((i) => ctx.pool[i]);
  const n = items.length;
  if (n < MIN_SYSTEM_SELECTIONS || hasSameMatch(items)) return [];
  const shape = prepareShape({ odds: items.map((s) => s.odds), minMatches: items.map((s) => s.minMatches), minSize: 2 });
  const formats: { k: number; columns: number; minUnits: number }[] = [];
  for (let k = 2; k < n; k++) {
    let columns = 0;
    for (let j = k; j <= n; j++) columns += shape.columnsBySize[j];
    if (columns === 0) continue;
    const minUnits = systemMinUnits(columns, ctx.unitKurus);
    if (minUnits <= ctx.totalUnits) formats.push({ k, columns, minUnits });
  }
  if (formats.length === 0) return [];

  const localProbs = indices.map((i) => ctx.probs[i]);
  const outcomes = outcomeSet(localProbs, 2 ** LOCAL_EXACT_SIZE, OUTCOME_SAMPLES, 7919 + indices.reduce((h, i) => h * 31 + i, 17));
  const sums = new Float64Array(n + 1);
  const scratch = new Float64Array(n + 1);
  const mean = new Float64Array(formats.length);
  const second = new Float64Array(formats.length);
  const zero = new Float64Array(formats.length);
  for (let o = 0; o < outcomes.masks.length; o++) {
    const weight = outcomes.weights[o];
    if (weight === 0) continue;
    winningSums(shape, outcomes.masks[o], sums, scratch);
    let suffix = 0;
    let f = formats.length - 1;
    for (let j = n; j >= 2 && f >= 0; j--) {
      suffix += sums[j];
      while (f >= 0 && formats[f].k === j) {
        const payout = suffix / formats[f].columns;
        mean[f] += weight * payout;
        second[f] += weight * payout * payout;
        if (payout === 0) zero[f] += weight;
        f--;
      }
    }
  }
  return formats.map((fmt, f) => ({
    kind: 'system' as const,
    indices,
    minSize: fmt.k,
    shape,
    columns: fmt.columns,
    product: 0,
    mean: mean[f],
    std: Math.sqrt(Math.max(0, second[f] - mean[f] * mean[f])),
    probNoReturn: zero[f],
    minUnits: fmt.minUnits,
    groups: indices.map((i) => ctx.groupOf[i]),
  }));
}

/** Havuzu farklı ölçütlere göre sıralar; aynı maçtan ikinci seçim atlanır. Büyük kupon/sistem önekleri bu sıralardan alınır. */
function orderings(ctx: BuildContext): number[][] {
  const { pool, probs } = ctx;
  const ev = (i: number) => probs[i] * pool[i].odds;
  const rules: ((a: number, b: number) => number)[] = [
    (a, b) => ev(b) - ev(a),
    (a, b) => probs[b] - probs[a] || ev(b) - ev(a),
    (a, b) => pool[b].confidence / pool[b].odds - pool[a].confidence / pool[a].odds,
  ];
  return rules.map((rule) => {
    const seen = new Set<string>();
    return pool
      .map((_, i) => i)
      .sort(rule)
      .filter((i) => {
        const key = matchKey(pool[i].matchName);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  });
}

function generateCandidates(ctx: BuildContext): Candidate[] {
  const all = ctx.pool.map((_, i) => i);
  const byKey = new Map<string, Candidate>();
  const add = (c: Candidate | null) => {
    if (!c) return;
    const key = `${c.kind}:${c.minSize}:${[...c.indices].sort((a, b) => a - b).join(',')}`;
    if (!byKey.has(key)) byKey.set(key, c);
  };
  for (let size = 1; size <= Math.min(FULL_SCAN_NORMAL_SIZE, all.length); size++) {
    for (const idx of combinations(all, size)) add(normalCandidate(ctx, idx));
  }
  for (let size = MIN_SYSTEM_SELECTIONS; size <= Math.min(FULL_SCAN_SYSTEM_SIZE, all.length); size++) {
    for (const idx of combinations(all, size)) systemFamily(ctx, idx).forEach(add);
  }
  const seenPrefixes = new Set<string>();
  for (const order of orderings(ctx)) {
    for (let size = FULL_SCAN_NORMAL_SIZE + 1; size <= order.length; size++) {
      const prefix = order.slice(0, size);
      const key = [...prefix].sort((a, b) => a - b).join(',');
      add(normalCandidate(ctx, prefix));
      if (size > FULL_SCAN_SYSTEM_SIZE && !seenPrefixes.has(key)) {
        seenPrefixes.add(key);
        systemFamily(ctx, prefix).forEach(add);
      }
    }
  }
  return Array.from(byKey.values());
}

const individualScore = (c: Candidate, lambda: number) => c.mean - lambda * c.std;

/**
 * Kısa liste: en iyi adaylar + çeşitlilik için her maçı ve en gözde (en iyi adaylarda en sık geçen) maçların
 * kombinasyonlarını içermeyen en iyi adaylar. Böylece dağıtım farklı maçlara da yayılabilir.
 */
function shortlist(candidates: Candidate[], lambda: number, groupCount: number): { list: Candidate[]; diverseStarts: Candidate[] } {
  const picked = new Set<Candidate>();
  const byScore = [...candidates].sort((a, b) => individualScore(b, lambda) - individualScore(a, lambda));
  const take = (sorted: Candidate[], n: number) => sorted.slice(0, n).forEach((c) => picked.add(c));
  take(byScore, 40);
  take([...candidates].sort((a, b) => b.mean - a.mean), 10);
  take([...candidates].sort((a, b) => a.probNoReturn - b.probNoReturn || b.mean - a.mean), 10);
  // Büyük sistemler (tam taranmayan boyutlar) kısa listede mutlaka temsil edilsin.
  take(byScore.filter((c) => c.kind === 'system' && c.indices.length > FULL_SCAN_SYSTEM_SIZE), 15);
  for (let g = 0; g < groupCount; g++) take(byScore.filter((c) => !c.groups.includes(g)), 5);

  const frequency = new Array(groupCount).fill(0);
  byScore.slice(0, 40).forEach((c) => c.groups.forEach((g) => frequency[g]++));
  const favourites = frequency
    .map((f, g) => ({ f, g }))
    .sort((a, b) => b.f - a.f)
    .slice(0, FAVOURITE_GROUPS)
    .map((x) => x.g);
  const diverseStarts: Candidate[] = [];
  for (let mask = 1; mask < 1 << favourites.length; mask++) {
    const excluded = favourites.filter((_, i) => mask & (1 << i));
    const avoiding = byScore.filter((c) => excluded.every((g) => !c.groups.includes(g)));
    take(avoiding, 4);
    if (avoiding[0] && excluded.length === 1) diverseStarts.push(avoiding[0]);
  }
  return { list: Array.from(picked).slice(0, SHORTLIST_SIZE), diverseStarts };
}

/** Adayların havuz sonuçları (kesin ya da örnek) üzerinden 1 TL'lik ödeme ortalaması ve kovaryans matrisi. */
function moments(candidates: Candidate[], outcomes: OutcomeSet) {
  const count = outcomes.masks.length;
  const maxSize = Math.max(...candidates.map((c) => c.indices.length));
  const sums = new Float64Array(maxSize + 1);
  const scratch = new Float64Array(maxSize + 1);
  const vectors = candidates.map((c) => {
    const v = new Float64Array(count);
    const fullMask = c.indices.reduce((m, i) => m | (1 << i), 0);
    for (let o = 0; o < count; o++) {
      const w = outcomes.masks[o];
      if (!c.shape) {
        v[o] = (w & fullMask) === fullMask ? c.product : 0;
        continue;
      }
      let local = 0;
      for (let i = 0; i < c.indices.length; i++) if (w & (1 << c.indices[i])) local |= 1 << i;
      v[o] = payoutPerColumnUnit(c.shape, local, sums, scratch, c.minSize) / c.columns;
    }
    return v;
  });
  const pw = outcomes.weights;
  const mu = vectors.map((v) => v.reduce((sum, x, o) => sum + pw[o] * x, 0));
  const k = candidates.length;
  const cov = Array.from({ length: k }, () => new Float64Array(k));
  for (let i = 0; i < k; i++) {
    for (let j = i; j < k; j++) {
      let e = 0;
      const vi = vectors[i];
      const vj = vectors[j];
      for (let o = 0; o < count; o++) if (pw[o] > 0) e += pw[o] * vi[o] * vj[o];
      cov[i][j] = cov[j][i] = e - mu[i] * mu[j];
    }
  }
  return { mu, cov };
}

type State = {
  w: number[];
  s: number[];
  q: number;
  m: number;
  active: number;
  used: number;
  systems: number;
  systemUnits: number;
};

/** Dağıtım kuralları: sistem zorunluluğu, sistemlere gidecek en az birim ve tek kupona konabilecek en fazla birim. */
type Rules = { requireSystem: boolean; minSystemUnits: number; maxUnitsPerCoupon: number };

function allocate(
  candidates: Candidate[],
  mu: number[],
  cov: Float64Array[],
  totalUnits: number,
  lambda: number,
  rules: Rules,
  start?: number,
): State {
  const k = candidates.length;
  const st: State = {
    w: new Array(k).fill(0),
    s: new Array(k).fill(0),
    q: 0,
    m: 0,
    active: 0,
    used: 0,
    systems: 0,
    systemUnits: 0,
  };
  const objective = (m: number, q: number) => m - lambda * Math.sqrt(Math.max(q, 0));
  const apply = (i: number, d: number) => {
    st.q += 2 * d * st.s[i] + d * d * cov[i][i];
    st.m += d * mu[i];
    for (let j = 0; j < k; j++) st.s[j] += d * cov[j][i];
    const before = st.w[i];
    st.w[i] += d;
    const opened = before === 0 && st.w[i] > 0;
    const closed = before > 0 && st.w[i] === 0;
    if (opened) st.active++;
    else if (closed) st.active--;
    if (candidates[i].kind === 'system') {
      st.systems += opened ? 1 : closed ? -1 : 0;
      st.systemUnits += d;
    }
    st.used += d;
  };

  if (start !== undefined && candidates[start].minUnits <= Math.min(totalUnits, rules.maxUnitsPerCoupon)) {
    apply(start, candidates[start].minUnits);
  }

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
      if (st.w[i] + d > rules.maxUnitsPerCoupon) continue;
      // Normal kupona eklenen tutar, sistemlere ayrılması gereken payı yiyemez.
      if (candidates[i].kind === 'normal' && totalUnits - st.used - d < rules.minSystemUnits - st.systemUnits) continue;
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
          if (st.w[j] + d > rules.maxUnitsPerCoupon) continue;
          // Sistem kuralları: son sistem kuponu kapatılamaz, sistem payı alt sınırın altına düşemez.
          const iSystem = candidates[i].kind === 'system';
          const jSystem = candidates[j].kind === 'system';
          const systemsAfter = st.systems - (iSystem && st.w[i] - d === 0 ? 1 : 0) + (jSystem && st.w[j] === 0 ? 1 : 0);
          if (rules.requireSystem && systemsAfter === 0) continue;
          if (st.systemUnits - (iSystem ? d : 0) + (jSystem ? d : 0) < rules.minSystemUnits) continue;
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
    ? `Bütçenin tamamı tek ${normals ? 'normal' : 'sistem'} kupona yatırıldı.`
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

  const matchCount = new Set(pool.map((s) => matchKey(s.matchName))).size;
  const unusable = pool.filter((s) => s.minMatches > matchCount);
  if (unusable.length > 0) {
    notes.push(`${unusable.map(describeSelection).join(', ')}: minimum maç sayısı, farklı maç sayısından (${matchCount}) büyük olduğu için kullanılamadı.`);
  }
  if (new Set(pool.map((s) => matchKey(s.matchName))).size < pool.length) {
    notes.push('Aynı maçtan birden fazla seçim var; bunlar aynı kupona konmadı.');
  }

  const unit = stakeUnitKurus(budgetKurus);
  const totalUnits = Math.floor(budgetKurus / unit);
  if (budgetKurus < MIN_STAKE_KURUS) {
    notes.push(`Her kupon en az ${formatTL(MIN_STAKE_KURUS)} olmalı; bütçe bu tutarın altında olduğu için öneri oluşturulamadı.`);
    return base;
  }

  const probs = pool.map((s) => subjectiveProbability(s.confidence));
  const groupKeys = Array.from(new Set(pool.map((s) => matchKey(s.matchName))));
  const groupOf = pool.map((s) => groupKeys.indexOf(matchKey(s.matchName)));
  const candidates = generateCandidates({ pool, probs, unitKurus: unit, totalUnits, groupOf });
  if (candidates.length === 0) {
    notes.push(
      'Minimum maç koşulları veya aynı maç kısıtı nedeniyle hiçbir kupon oluşturulamadı.',
    );
    notes.push('Girilen seçimler ve bütçeyle geçerli bir öneri bulunamadı.');
    return base;
  }

  const { list, diverseStarts } = shortlist(candidates, lambda, groupKeys.length);
  const { mu, cov } = moments(list, outcomeSet(probs, EXACT_OUTCOME_LIMIT, OUTCOME_SAMPLES));
  const order = list.map((_, i) => i).sort((a, b) => individualScore(list[b], lambda) - individualScore(list[a], lambda));
  const defaultStarts: (number | undefined)[] = Array.from(
    new Set([undefined, ...order.slice(0, START_COUNT), ...diverseStarts.map((c) => list.indexOf(c)).filter((i) => i >= 0)]),
  );
  // Sistem zorunluyken her başlangıç farklı bir sistem kuponuyla açılır; hangisinin en iyi olduğunu sonuç belirler.
  const systemStarts = order.filter((i) => list[i].kind === 'system').slice(0, START_COUNT + 4);
  const couponMinUnits = Math.ceil(MIN_STAKE_KURUS / unit);
  const canSplit = totalUnits >= 2 * couponMinUnits;
  const hasSystem = systemStarts.length > 0;
  if (!hasSystem) {
    notes.push(
      `Sistem kuponu için min. maç koşullarına uyan, farklı maçlardan en az ${MIN_SYSTEM_SELECTIONS} seçim gerekir; öneri normal kuponlardan oluştu.`,
    );
  }

  // Kurallar sırayla denenir; karşılanamazsa bir sonraki (daha gevşek) adıma geçilir.
  const split = canSplit ? totalUnits - couponMinUnits : totalUnits;
  const attempts: { rules: Rules; note?: string }[] = [
    { rules: { requireSystem: hasSystem, minSystemUnits: hasSystem ? Math.ceil(MIN_SYSTEM_SHARE * totalUnits) : 0, maxUnitsPerCoupon: split } },
    {
      rules: { requireSystem: hasSystem, minSystemUnits: 0, maxUnitsPerCoupon: split },
      note: `Sistem kuponlarına bütçenin en az %${Math.round(MIN_SYSTEM_SHARE * 100)} payı ayrılamadı; öneride en az bir sistem kuponu var.`,
    },
    {
      rules: { requireSystem: false, minSystemUnits: 0, maxUnitsPerCoupon: split },
      note: 'Bütçe ve min. maç koşulları sistem kuponuna yer bırakmadı; öneri sistemsiz oluşturuldu.',
    },
    {
      rules: { requireSystem: false, minSystemUnits: 0, maxUnitsPerCoupon: totalUnits },
      note: 'Seçimler bütçeyi birden fazla kupona bölmeye yetmedi; tek kupon önerildi.',
    },
  ];
  const search = (rules: Rules): State | null => {
    let bestF = Number.NEGATIVE_INFINITY;
    let state: State | null = null;
    for (const start of rules.requireSystem ? systemStarts : defaultStarts) {
      const st = allocate(list, mu, cov, totalUnits, lambda, rules, start);
      if (st.active === 0 || st.used < totalUnits) continue;
      if (rules.requireSystem && (st.systems === 0 || st.systemUnits < rules.minSystemUnits)) continue;
      const f = st.m - lambda * Math.sqrt(Math.max(st.q, 0));
      if (f > bestF) {
        bestF = f;
        state = st;
      }
    }
    return state;
  };
  let best: State | null = null;
  let usedRules = attempts[0].rules;
  for (const attempt of attempts) {
    best = search(attempt.rules);
    usedRules = attempt.rules;
    if (best) {
      if (attempt.note && attempt !== attempts[0]) notes.push(attempt.note);
      break;
    }
  }
  if (best && usedRules === attempts[0].rules && hasSystem) {
    notes.push(
      `Sistem ağırlıklı dağılım: sistem kuponlarına bütçenin en az %${Math.round(MIN_SYSTEM_SHARE * 100)} payı ayrıldı${canSplit ? ' ve bütçe en az 2 kupona bölündü' : ''}.`,
    );
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
  // Güvence: tek kupon hedefte daha iyiyse ve uygulanan kurallara uyuyorsa onu öner.
  const fitsRules = (plan: Plan) => {
    const systemStake = plan.parts.reduce((sum, p) => sum + (p.kind === 'system' ? p.stakeKurus : 0), 0);
    return (
      (usedRules.maxUnitsPerCoupon >= totalUnits || plan.parts.length >= 2) &&
      (!usedRules.requireSystem || (systemStake > 0 && systemStake >= usedRules.minSystemUnits * unit - unit))
    );
  };
  for (const cmp of comparisons) {
    if (!fitsRules(cmp.plan)) continue;
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
