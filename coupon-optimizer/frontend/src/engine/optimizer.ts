/**
 * Portfolio Optimizer — kuponları tek tek değil, oluşturdukları portföyü birlikte optimize eder.
 *
 * 1. Aday kuponlar: 1–4 seçimli tüm normal kuponlar ve 3–5 seçimli tüm alt kümelerin tüm sistem formatları taranır.
 *    Daha büyük normal/sistem kuponlar, üç sıralamanın (EV, tahmini olasılık, olasılık/oran) önekleriyle kurulur
 *    (yaklaşık arama). Aynı maçtan (veya korelasyon grubundan) iki seçim aynı kupona konmaz.
 * 2. Her aday için 1 TL'lik brüt dönüş vektörü, havuzun ortak senaryo uzayında hesaplanır (bağımlılık modeli dahil).
 * 3. Bütçe birimlere bölünür; stratejinin faydası (CRRA, beklenen log servet ailesi) en çok artacak şekilde birimler
 *    açgözlü eklenir, ardından aktarma/kapatma hamleleriyle yerel iyileştirme yapılır. Fayda artmıyorsa hiçbir şey
 *    eklenmez: "kupon oluşturmama" her zaman geçerli bir sonuçtur. Bütçenin tamamını kullanmak hedef değildir.
 * 4. Kısıtlar: kupon sayısı, toplam tutar (bütçe, en fazla kayıp, strateji tavanı), seçim/maç maruziyeti,
 *    seçim başına kupon sayısı, kolon başı alt/üst tutar, normal kupon ≥ 50 TL, sistem alt tutarı, izin verilen türler.
 */
import type { MatchSelection } from '../types';
import { binomial, combinations } from '../lib/combinatorics';
import { MIN_STAKE_KURUS } from '../lib/money';
import { payoutPerColumnUnit, prepareShape, winningSums, type PreparedShape } from '../lib/payout';
import { ENGINE_CONFIG } from './config';
import type { OutcomeSpace } from './correlation';
import { seededRandom } from './random';
import { systemFormats } from './systemFormats';
import { utility } from './utility';

export type PoolEntry = { selection: MatchSelection; p: number; matchIndex: number; groupKey: string };

export type CandidateRules = {
  unitKurus: number;
  totalUnits: number;
  minSystemStakeKurus: number;
  minColumnStakeKurus: number | null;
  maxColumnStakeKurus: number | null;
  allowNormal: boolean;
  allowSystem: boolean;
};

export type Candidate = {
  key: string;
  kind: 'normal' | 'system';
  /** Havuz dizinleri. */
  indices: number[];
  sizes: number[];
  columns: number;
  shape: PreparedShape | null;
  product: number;
  /** 1 TL için bağımsızlık varsayımıyla ön eleme istatistikleri (yalnızca sıralama için). */
  mean: number;
  variance: number;
  probZero: number;
  minUnits: number;
  maxUnits: number;
  /** Havuz dizinine göre: o seçim kaybederse bu kuponun tutarının kaybedilen oranı. */
  selectionShare: Map<number, number>;
  matchIndices: number[];
};

const sameGroup = (pool: PoolEntry[], indices: number[]) => new Set(indices.map((i) => pool[i].groupKey)).size !== indices.length;

function unitsFor(rules: CandidateRules, minKurus: number, maxKurus: number | null) {
  const minUnits = Math.ceil(minKurus / rules.unitKurus);
  const maxUnits = maxKurus === null ? Number.POSITIVE_INFINITY : Math.floor(maxKurus / rules.unitKurus);
  return { minUnits, maxUnits };
}

function normalCandidate(pool: PoolEntry[], indices: number[], rules: CandidateRules): Candidate | null {
  const items = indices.map((i) => pool[i].selection);
  if (sameGroup(pool, indices) || items.some((s) => s.minMatches > items.length)) return null;
  const { minUnits, maxUnits } = unitsFor(rules, MIN_STAKE_KURUS, null);
  if (minUnits > rules.totalUnits) return null;
  const win = indices.reduce((p, i) => p * pool[i].p, 1);
  const product = items.reduce((p, s) => p * s.odds, 1);
  return {
    key: `N:${[...indices].sort((a, b) => a - b).join(',')}`,
    kind: 'normal',
    indices,
    sizes: [indices.length],
    columns: 1,
    shape: null,
    product,
    mean: win * product,
    variance: product * product * win * (1 - win),
    probZero: 1 - win,
    minUnits,
    maxUnits,
    selectionShare: new Map(indices.map((i) => [i, 1])),
    matchIndices: indices.map((i) => pool[i].matchIndex),
  };
}

/** Aynı seçimlerle kurulabilen tüm sistem formatları; her senaryoda kolon toplamları bir kez hesaplanır. */
function systemFamily(pool: PoolEntry[], indices: number[], rules: CandidateRules, seed: number): Candidate[] {
  const items = indices.map((i) => pool[i].selection);
  const n = items.length;
  if (n < 3 || sameGroup(pool, indices)) return [];
  const formats = systemFormats(n);
  const allSizes = Array.from({ length: n - ENGINE_CONFIG.minSystemColumnSize + 1 }, (_, i) => ENGINE_CONFIG.minSystemColumnSize + i);
  const shape = prepareShape({ odds: items.map((s) => s.odds), minMatches: items.map((s) => s.minMatches), sizes: allSizes });
  const allowedCount = (j: number) => {
    const seg = shape.segments.find((s) => s.from <= j && j <= s.to)!;
    let c = 0;
    for (let x = seg.allowedMask; x; x &= x - 1) c++;
    return c;
  };

  const viable = formats
    .map((sizes) => {
      const columns = sizes.reduce((sum, j) => sum + shape.columnsBySize[j], 0);
      if (columns === 0) return null;
      const minKurus = Math.max(rules.minSystemStakeKurus, columns, (rules.minColumnStakeKurus ?? 0) * columns);
      const maxKurus = rules.maxColumnStakeKurus === null ? null : rules.maxColumnStakeKurus * columns;
      const { minUnits, maxUnits } = unitsFor(rules, minKurus, maxKurus);
      if (minUnits > Math.min(rules.totalUnits, maxUnits)) return null;
      return { sizes, columns, minUnits, maxUnits };
    })
    .filter((f): f is NonNullable<typeof f> => f !== null);
  if (viable.length === 0) return [];

  // Ön eleme istatistikleri: seçimler bağımsız varsayılır (aynı grup zaten aynı kupona girmez).
  const probs = indices.map((i) => pool[i].p);
  const out = new Float64Array(n + 1);
  const scratch = new Float64Array(n + 1);
  const mean = new Float64Array(viable.length);
  const second = new Float64Array(viable.length);
  const zero = new Float64Array(viable.length);
  const accumulate = (mask: number, weight: number) => {
    winningSums(shape, mask, out, scratch);
    viable.forEach((f, k) => {
      let total = 0;
      for (const j of f.sizes) total += out[j];
      const payout = total / f.columns;
      mean[k] += weight * payout;
      second[k] += weight * payout * payout;
      if (payout === 0) zero[k] += weight;
    });
  };
  if (n <= 10) {
    for (let w = 0; w < 1 << n; w++) {
      let p = 1;
      for (let i = 0; i < n; i++) p *= w & (1 << i) ? probs[i] : 1 - probs[i];
      accumulate(w, p);
    }
  } else {
    const random = seededRandom(seed);
    const samples = ENGINE_CONFIG.optimizerSamples;
    for (let s = 0; s < samples; s++) {
      let w = 0;
      for (let i = 0; i < n; i++) if (random() < probs[i]) w |= 1 << i;
      accumulate(w, 1 / samples);
    }
  }

  return viable.map((f, k) => {
    const selectionShare = new Map<number, number>();
    indices.forEach((poolIndex, local) => {
      let containing = 0;
      for (const j of f.sizes) {
        const allowed = allowedCount(j);
        if (items[local].minMatches <= j) containing += binomial(allowed - 1, j - 1);
      }
      selectionShare.set(poolIndex, containing / f.columns);
    });
    return {
      key: `S${f.sizes.join(',')}:${[...indices].sort((a, b) => a - b).join(',')}`,
      kind: 'system' as const,
      indices,
      sizes: f.sizes,
      columns: f.columns,
      shape,
      product: 0,
      mean: mean[k],
      variance: Math.max(0, second[k] - mean[k] * mean[k]),
      probZero: zero[k],
      minUnits: f.minUnits,
      maxUnits: f.maxUnits,
      selectionShare,
      matchIndices: indices.map((i) => pool[i].matchIndex),
    };
  });
}

/** Büyük kupon/sistemler için sıralama önekleri; aynı grup ikinci kez alınmaz. */
function orderings(pool: PoolEntry[]): number[][] {
  const ev = (i: number) => pool[i].p * pool[i].selection.odds;
  const rules: ((a: number, b: number) => number)[] = [
    (a, b) => ev(b) - ev(a),
    (a, b) => pool[b].p - pool[a].p || ev(b) - ev(a),
    (a, b) => pool[b].p / pool[b].selection.odds - pool[a].p / pool[a].selection.odds,
  ];
  return rules.map((rule) => {
    const seen = new Set<string>();
    return pool
      .map((_, i) => i)
      .sort(rule)
      .filter((i) => {
        if (seen.has(pool[i].groupKey)) return false;
        seen.add(pool[i].groupKey);
        return true;
      });
  });
}

export function generateCandidates(pool: PoolEntry[], rules: CandidateRules, seed: number): { candidates: Candidate[]; approximate: boolean } {
  const all = pool.map((_, i) => i);
  const byKey = new Map<string, Candidate>();
  const add = (c: Candidate | null) => {
    if (c && !byKey.has(c.key)) byKey.set(c.key, c);
  };
  let approximate = false;
  if (rules.allowNormal) {
    for (let size = 1; size <= Math.min(ENGINE_CONFIG.fullScanNormalSize, all.length); size++) {
      for (const idx of combinations(all, size)) add(normalCandidate(pool, idx, rules));
    }
  }
  if (rules.allowSystem) {
    for (let size = 3; size <= Math.min(ENGINE_CONFIG.fullScanSystemSize, all.length); size++) {
      for (const idx of combinations(all, size)) systemFamily(pool, idx, rules, seed).forEach(add);
    }
  }
  const seenPrefix = new Set<string>();
  for (const order of orderings(pool)) {
    for (let size = ENGINE_CONFIG.fullScanNormalSize + 1; size <= order.length; size++) {
      const prefix = order.slice(0, size);
      approximate = true;
      if (rules.allowNormal) add(normalCandidate(pool, prefix, rules));
      const key = [...prefix].sort((a, b) => a - b).join(',');
      if (rules.allowSystem && size > ENGINE_CONFIG.fullScanSystemSize && !seenPrefix.has(key)) {
        seenPrefix.add(key);
        systemFamily(pool, prefix, rules, seed + size).forEach(add);
      }
    }
  }
  return { candidates: Array.from(byKey.values()), approximate };
}

/** Ön eleme puanı: küçük bir tutarda faydanın yaklaşık değişimi (beklenen getiri − γ/2 · varyans · tutar oranı). */
const screeningScore = (c: Candidate, gamma: number, stakeFraction: number) => c.mean - 1 - 0.5 * gamma * c.variance * stakeFraction;

/** Kısa liste: en iyiler + her maçı içermeyen alternatifler + büyük sistemler (çeşitlilik için). */
export function shortlist(candidates: Candidate[], gamma: number, stakeFraction: number, matchCount: number): Candidate[] {
  const picked = new Set<Candidate>();
  const scores = new Map(candidates.map((c) => [c, screeningScore(c, gamma, stakeFraction)]));
  const scored = [...candidates].sort((a, b) => scores.get(b)! - scores.get(a)!);
  const take = (list: Candidate[], n: number) => list.slice(0, n).forEach((c) => picked.add(c));
  take(scored, 40);
  take(scored.filter((c) => c.kind === 'system'), 20);
  take(scored.filter((c) => c.kind === 'normal'), 15);
  take([...candidates].sort((a, b) => a.probZero - b.probZero || b.mean - a.mean), 8);
  take(scored.filter((c) => c.kind === 'system' && c.indices.length > ENGINE_CONFIG.fullScanSystemSize), 8);
  for (let m = 0; m < matchCount; m++) take(scored.filter((c) => !c.matchIndices.includes(m)), 3);
  return Array.from(picked).slice(0, ENGINE_CONFIG.shortlistSize);
}

/** 1 TL'lik kupon için her senaryodaki brüt dönüş (havuz senaryo uzayında). */
export function candidateVector(c: Candidate, space: OutcomeSpace, poolBits: number[]): Float64Array {
  const v = new Float64Array(space.masks.length);
  const n = c.indices.length;
  const out = new Float64Array(n + 1);
  const scratch = new Float64Array(n + 1);
  const fullMask = c.indices.reduce((m, i) => m | (1 << poolBits[i]), 0);
  for (let o = 0; o < space.masks.length; o++) {
    const w = space.masks[o];
    if (!c.shape) {
      v[o] = (w & fullMask) === fullMask ? c.product : 0;
      continue;
    }
    let local = 0;
    for (let i = 0; i < n; i++) if (w & (1 << poolBits[c.indices[i]])) local |= 1 << i;
    v[o] = payoutPerColumnUnit(c.shape, local, out, scratch, c.sizes) / c.columns;
  }
  return v;
}

export type AllocationOptions = {
  gamma: number;
  budgetKurus: number;
  unitKurus: number;
  /** Toplam yatırılabilecek en fazla birim. */
  capUnits: number;
  maxCoupons: number;
  maxSelectionExposureKurus: number;
  maxMatchExposureKurus: number;
  maxCouponsPerSelection: number;
  allowNormal: boolean;
  allowSystem: boolean;
  /** En az bir normal ve bir sistem kuponu zorunlu (karma alternatif). */
  requireBoth: boolean;
};

export type Allocation = { units: number[]; expectedUtility: number };

export function allocate(
  candidates: Candidate[],
  vectors: Float64Array[],
  weights: Float64Array,
  options: AllocationOptions,
): Allocation | null {
  const k = candidates.length;
  const N = weights.length;
  const { budgetKurus: B, unitKurus: unit, gamma } = options;
  const allowed = candidates.map((c) => (c.kind === 'normal' ? options.allowNormal : options.allowSystem));

  const evaluate = (units: number[], G: Float64Array) => {
    const S = units.reduce((s, u) => s + u, 0) * unit;
    const base = 1 - S / B;
    let eu = 0;
    for (let o = 0; o < N; o++) if (weights[o] > 0) eu += weights[o] * utility(base + G[o], gamma);
    return eu;
  };
  /** Birim değişikliklerinden sonra kısıtlar sağlanıyor mu? */
  const feasible = (units: number[], enforceBoth = options.requireBoth) => {
    let total = 0;
    let active = 0;
    let normals = 0;
    let systems = 0;
    const selExposure = new Map<number, number>();
    const matchExposure = new Map<number, number>();
    const selCoupons = new Map<number, number>();
    for (let i = 0; i < k; i++) {
      const u = units[i];
      if (u === 0) continue;
      const c = candidates[i];
      if (!allowed[i] || u < c.minUnits || u > c.maxUnits) return false;
      total += u;
      active++;
      if (c.kind === 'normal') normals++;
      else systems++;
      c.selectionShare.forEach((share, s) => {
        selExposure.set(s, (selExposure.get(s) ?? 0) + u * unit * share);
        selCoupons.set(s, (selCoupons.get(s) ?? 0) + 1);
      });
      c.indices.forEach((s, local) => {
        const m = c.matchIndices[local];
        matchExposure.set(m, (matchExposure.get(m) ?? 0) + u * unit * c.selectionShare.get(s)!);
      });
    }
    if (total > options.capUnits || active > options.maxCoupons) return false;
    for (const v of selExposure.values()) if (v > options.maxSelectionExposureKurus + 1e-6) return false;
    for (const v of matchExposure.values()) if (v > options.maxMatchExposureKurus + 1e-6) return false;
    for (const v of selCoupons.values()) if (v > options.maxCouponsPerSelection) return false;
    if (enforceBoth && active > 0 && (normals === 0 || systems === 0)) return false;
    return true;
  };

  const run = (seedSet: number[]): Allocation | null => {
    const units = new Array(k).fill(0);
    const G = new Float64Array(N);
    const addTo = (i: number, d: number, target: Float64Array) => {
      const scale = (d * unit) / B;
      const v = vectors[i];
      for (let o = 0; o < N; o++) target[o] += scale * v[o];
    };
    for (const i of seedSet) {
      units[i] = candidates[i].minUnits;
      addTo(i, units[i], G);
    }
    if (seedSet.length > 0 && !feasible(units)) return null;
    let eu = seedSet.length > 0 ? evaluate(units, G) : 0;
    const trial = new Float64Array(N);

    const tryMove = (changes: [number, number][]): number | null => {
      const next = units.slice();
      for (const [i, d] of changes) next[i] += d;
      if (next.some((u) => u < 0) || !feasible(next)) return null;
      trial.set(G);
      for (const [i, d] of changes) addTo(i, d, trial);
      return evaluate(next, trial);
    };
    const apply = (changes: [number, number][], value: number) => {
      for (const [i, d] of changes) {
        units[i] += d;
        addTo(i, d, G);
      }
      eu = value;
    };

    // Açgözlü ekleme: birim başına faydayı en çok artıran hamle; artış yoksa dur.
    for (let step = 0; step < options.capUnits + k; step++) {
      let best: { changes: [number, number][]; value: number; gain: number } | null = null;
      for (let i = 0; i < k; i++) {
        if (!allowed[i]) continue;
        const d = units[i] > 0 ? 1 : candidates[i].minUnits;
        const value = tryMove([[i, d]]);
        if (value === null) continue;
        const gain = (value - eu) / d;
        if (gain > 1e-12 && (!best || gain > best.gain)) best = { changes: [[i, d]], value, gain };
      }
      if (!best) break;
      apply(best.changes, best.value);
    }

    // Yerel iyileştirme: azaltma/kapatma ve aktarma hamleleri.
    for (let iter = 0; iter < ENGINE_CONFIG.localSearchIterations; iter++) {
      const active = units.map((u, i) => (u > 0 ? i : -1)).filter((i) => i >= 0);
      const neighbours = Array.from(new Set([...active, ...Array.from({ length: Math.min(k, 25) }, (_, i) => i)]));
      let best: { changes: [number, number][]; value: number } | null = null;
      const consider = (changes: [number, number][]) => {
        const value = tryMove(changes);
        if (value !== null && value > eu + 1e-12 && (!best || value > best.value)) best = { changes, value };
      };
      for (const i of active) {
        consider([[i, -1]]);
        consider([[i, -units[i]]]);
        for (const j of neighbours) {
          if (j === i || !allowed[j]) continue;
          const open = units[j] === 0 ? candidates[j].minUnits : 1;
          for (const d of new Set([1, open, units[i]])) if (d <= units[i]) consider([[i, -d], [j, units[j] === 0 ? open : d]]);
        }
      }
      if (!best) break;
      const chosen: { changes: [number, number][]; value: number } = best;
      apply(chosen.changes, chosen.value);
    }
    if (options.requireBoth && !units.some((u, i) => u > 0 && candidates[i].kind === 'normal')) return null;
    return { units, expectedUtility: eu };
  };

  const starts: number[][] = [[]];
  const bestOpen = (kind: 'normal' | 'system') => {
    let bestIndex = -1;
    let bestValue = Number.NEGATIVE_INFINITY;
    candidates.forEach((c, i) => {
      if (c.kind !== kind || !allowed[i]) return;
      const units = new Array(k).fill(0);
      units[i] = c.minUnits;
      if (!feasible(units, false)) return;
      const v = c.mean - 1 - 0.5 * gamma * c.variance * ((c.minUnits * unit) / B);
      if (v > bestValue) {
        bestValue = v;
        bestIndex = i;
      }
    });
    return bestIndex;
  };
  if (options.requireBoth) {
    const n = bestOpen('normal');
    const s = bestOpen('system');
    if (n < 0 || s < 0) return null;
    starts.length = 0;
    starts.push([n, s]);
  } else if (options.allowSystem && options.allowNormal) {
    const s = bestOpen('system');
    if (s >= 0) starts.push([s]);
  }

  let best: Allocation | null = null;
  for (const seed of starts) {
    const result = run(seed);
    if (result && (!best || result.expectedUtility > best.expectedUtility)) best = result;
  }
  return best;
}
