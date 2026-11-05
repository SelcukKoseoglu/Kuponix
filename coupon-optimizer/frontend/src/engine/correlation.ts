/**
 * Correlation Analyzer — bağımlılık grupları ve senaryo uzayı.
 *
 * Aynı maçtaki seçimler (matchId) ve kullanıcının aynı korelasyon grubuna koyduğu seçimler bir bağımlılık grubu
 * oluşturur. Korelasyon katsayısı bilinmediği için uydurulmaz; iki model kullanılır:
 *  - Bağımsız: grup içi bağımsızlık VARSAYIMI (açıkça etiketlenir).
 *  - Tam pozitif bağımlılık (stres): grup için tek bir U ~ Uniform(0,1); seçim i, U < p_i ise kazanır. Bu, verilen
 *    marjinal olasılıklarla tutarlı GEÇERLİ bir ortak dağılımdır (Fréchet üst sınırı) ve ortak kayıpları en sık
 *    birlikte üreten senaryodur.
 * Kullanıcı aynı maçtaki iki seçim için birlikte gerçekleşme olasılığı girdiyse (ve geçerliyse) o kullanılır.
 */
import type { JointProbability, MatchSelection } from '../types';
import { normalizeSearch } from '../lib/search';
import type { DependenceModel } from './config';
import { seededRandom } from './random';
import type { ScenarioMethod } from './types';

export type ModelSelection = { id: string; groupKey: string; p: number };

export type OutcomeSpace = {
  ids: string[];
  /** Her senaryoda kazanan seçimlerin bit maskesi (bit i = ids[i]). */
  masks: Int32Array;
  weights: Float64Array;
  method: ScenarioMethod;
  /** Bağımsızlık varsayımı altında hesaplanan çok seçimli gruplar. */
  independentGroups: string[];
  /** Tam bağımlılık stres modeli uygulanan gruplar. */
  comonotonicGroups: string[];
  /** Kullanıcı ortak olasılığı uygulanan gruplar. */
  jointGroups: string[];
  notes: string[];
};

/** Bağımlılık grubu anahtarı: kullanıcı korelasyon grubu varsa o, yoksa maç. */
export function dependencyKey(s: Pick<MatchSelection, 'matchId' | 'correlationGroup'>): string {
  return s.correlationGroup ? `g:${normalizeSearch(s.correlationGroup)}` : `m:${s.matchId}`;
}

/** İki olayın ortak olasılığının geçerliliği: max(0, pA + pB − 1) ≤ pAB ≤ min(pA, pB). */
export function validateJointProbability(pA: number, pB: number, pAB: number): string | null {
  if (!Number.isFinite(pAB) || pAB < 0 || pAB > 1) return 'Birlikte gerçekleşme olasılığı %0 ile %100 arasında olmalı.';
  const lower = Math.max(0, pA + pB - 1);
  const upper = Math.min(pA, pB);
  const pct = (x: number) => `%${(x * 100).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`;
  if (pAB < lower - 1e-9) return `Tahminlerinle tutarlı olması için birlikte gerçekleşme olasılığı en az ${pct(lower)} olmalı.`;
  if (pAB > upper + 1e-9) return `Birlikte gerçekleşme olasılığı, iki seçimin tahminlerinin küçüğünü (${pct(upper)}) aşamaz.`;
  return null;
}

type GroupStates = { key: string; states: { mask: number; prob: number }[] };

function comonotonicStates(members: { bit: number; p: number }[]): { mask: number; prob: number }[] {
  const sorted = [...members].sort((a, b) => b.p - a.p);
  const states: { mask: number; prob: number }[] = [];
  let mask = 0;
  states.push({ mask: 0, prob: 1 - sorted[0].p });
  sorted.forEach((m, i) => {
    mask |= 1 << m.bit;
    const next = i + 1 < sorted.length ? sorted[i + 1].p : 0;
    states.push({ mask, prob: m.p - next });
  });
  return states.filter((s) => s.prob > 0);
}

/**
 * Seçimler için senaryo uzayı: tüm durumlar `enumerationLimit`'i aşmıyorsa tam sayım, aşıyorsa tohumlu Monte Carlo.
 */
export function buildOutcomeSpace(
  selections: readonly ModelSelection[],
  dependence: DependenceModel,
  joints: readonly JointProbability[],
  options: { enumerationLimit: number; samples: number; seed: number },
): OutcomeSpace {
  const ids = selections.map((s) => s.id);
  const byGroup = new Map<string, { bit: number; p: number; id: string }[]>();
  selections.forEach((s, i) => {
    const list = byGroup.get(s.groupKey) ?? [];
    list.push({ bit: i, p: s.p, id: s.id });
    byGroup.set(s.groupKey, list);
  });

  const groups: GroupStates[] = [];
  const independentGroups: string[] = [];
  const comonotonicGroups: string[] = [];
  const jointGroups: string[] = [];
  const notes: string[] = [];
  const single = (bit: number, p: number): { mask: number; prob: number }[] => [
    { mask: 1 << bit, prob: p },
    { mask: 0, prob: 1 - p },
  ];

  for (const [key, members] of byGroup) {
    if (members.length === 1) {
      groups.push({ key, states: single(members[0].bit, members[0].p) });
      continue;
    }
    const joint =
      members.length === 2
        ? joints.find((j) => j.selectionIds.includes(members[0].id) && j.selectionIds.includes(members[1].id))
        : undefined;
    if (joint) {
      const [a, b] = members;
      const lower = Math.max(0, a.p + b.p - 1);
      const upper = Math.min(a.p, b.p);
      let pab = joint.probability;
      if (pab < lower || pab > upper) {
        pab = Math.min(upper, Math.max(lower, pab));
        notes.push('Bir ortak olasılık, bu modeldeki (karamsar) tahminlerle tutarlı olacak şekilde en yakın geçerli değere çekildi.');
      }
      groups.push({
        key,
        states: [
          { mask: (1 << a.bit) | (1 << b.bit), prob: pab },
          { mask: 1 << a.bit, prob: a.p - pab },
          { mask: 1 << b.bit, prob: b.p - pab },
          { mask: 0, prob: 1 - a.p - b.p + pab },
        ].filter((s) => s.prob > 1e-15),
      });
      jointGroups.push(key);
      continue;
    }
    if (dependence === 'comonotonic') {
      groups.push({ key, states: comonotonicStates(members) });
      comonotonicGroups.push(key);
    } else {
      // Bağımsızlık varsayımı: grup üyeleri ayrı ayrı ele alınır.
      members.forEach((m) => groups.push({ key: `${key}#${m.bit}`, states: single(m.bit, m.p) }));
      independentGroups.push(key);
    }
  }

  const total = groups.reduce((n, g) => n * g.states.length, 1);
  if (total <= options.enumerationLimit) {
    const masks = new Int32Array(total);
    const weights = new Float64Array(total);
    const counter = new Array(groups.length).fill(0);
    for (let o = 0; o < total; o++) {
      let mask = 0;
      let prob = 1;
      groups.forEach((g, gi) => {
        const st = g.states[counter[gi]];
        mask |= st.mask;
        prob *= st.prob;
      });
      masks[o] = mask;
      weights[o] = prob;
      for (let gi = 0; gi < groups.length; gi++) {
        counter[gi]++;
        if (counter[gi] < groups[gi].states.length) break;
        counter[gi] = 0;
      }
    }
    return { ids, masks, weights, method: { kind: 'exact', scenarios: total }, independentGroups, comonotonicGroups, jointGroups, notes };
  }

  const random = seededRandom(options.seed);
  const cumulative = groups.map((g) => {
    let acc = 0;
    return g.states.map((s) => (acc += s.prob));
  });
  const masks = new Int32Array(options.samples);
  const weights = new Float64Array(options.samples).fill(1 / options.samples);
  for (let o = 0; o < options.samples; o++) {
    let mask = 0;
    groups.forEach((g, gi) => {
      const u = random() * cumulative[gi][cumulative[gi].length - 1];
      let k = 0;
      while (k < g.states.length - 1 && u >= cumulative[gi][k]) k++;
      mask |= g.states[k].mask;
    });
    masks[o] = mask;
  }
  return {
    ids,
    masks,
    weights,
    method: { kind: 'monte-carlo', simulations: options.samples, seed: options.seed },
    independentGroups,
    comonotonicGroups,
    jointGroups,
    notes,
  };
}
