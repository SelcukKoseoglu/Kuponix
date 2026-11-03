/**
 * Kolonları tek tek saymadan sistem kuponu dönüşü.
 *
 * "Sistem k,…,n" kuponunun j'li kolonları, min. maç değeri j'yi aşmayan seçimlerden kurulur. Bir sonuçta kazanan
 * seçimler belliyken, kazanan j'li kolonların oran çarpımları toplamı, kazananların oranları üzerindeki j. dereceden
 * elementer simetrik polinomdur (e_j). e_0…e_n tek bir O(n²) döngüyle bulunur; böylece 15 maçlık bir sistemin binlerce
 * kolonu tek tek dolaşılmaz. Normal kupon, en küçük kolonu n olan sistem gibi ele alınır.
 */
import { binomial } from './combinatorics';

export type CouponShape = {
  odds: readonly number[];
  minMatches: readonly number[];
  /** En küçük kolon boyutu (normal kupon için seçim sayısı). */
  minSize: number;
};

/** Aynı seçim kümesinin kolon kurabildiği boyut aralığı: [from, to] boyutlarında izinli seçimler `allowedMask`. */
export type Segment = { from: number; to: number; allowedMask: number; allowedCount: number };

export type PreparedShape = CouponShape & {
  n: number;
  segments: Segment[];
  /** Boyuta göre geçerli kolon sayısı (j = 0…n). */
  columnsBySize: number[];
  columns: number;
};

const popcount = (x: number) => {
  let c = 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  return c;
};

export function prepareShape(shape: CouponShape): PreparedShape {
  const n = shape.odds.length;
  const segments: Segment[] = [];
  const columnsBySize = new Array(n + 1).fill(0);
  for (let j = shape.minSize; j <= n; j++) {
    let allowedMask = 0;
    for (let i = 0; i < n; i++) if (shape.minMatches[i] <= j) allowedMask |= 1 << i;
    const last = segments[segments.length - 1];
    if (last && last.allowedMask === allowedMask) last.to = j;
    else segments.push({ from: j, to: j, allowedMask, allowedCount: popcount(allowedMask) });
    columnsBySize[j] = binomial(popcount(allowedMask), j);
  }
  return { ...shape, n, segments, columnsBySize, columns: columnsBySize.reduce((a, b) => a + b, 0) };
}

/**
 * Kazanan seçimler `winnersMask` iken j'li geçerli kolonların oran çarpımları toplamını `out[j]` içine yazar.
 * `scratch` uzunluğu en az n + 1 olmalıdır.
 */
export function winningSums(shape: PreparedShape, winnersMask: number, out: Float64Array, scratch: Float64Array): void {
  out.fill(0);
  for (const seg of shape.segments) {
    const mask = seg.allowedMask & winnersMask;
    const e = scratch;
    e.fill(0);
    e[0] = 1;
    let degree = 0;
    for (let i = 0; i < shape.n; i++) {
      if (!(mask & (1 << i))) continue;
      const o = shape.odds[i];
      degree++;
      for (let d = degree; d >= 1; d--) e[d] += e[d - 1] * o;
    }
    for (let j = seg.from; j <= seg.to; j++) out[j] = j <= degree ? e[j] : 0;
  }
}

/** Kazanan seçimler `winnersMask` iken kaç geçerli kolonun kazandığı. */
export function winningColumnCount(shape: PreparedShape, winnersMask: number): number {
  let total = 0;
  for (const seg of shape.segments) {
    const winners = popcount(seg.allowedMask & winnersMask);
    for (let j = seg.from; j <= seg.to; j++) total += binomial(winners, j);
  }
  return total;
}

/**
 * Kuponun kolon başına 1 birim yatırımla toplam dönüşü (kazananlar `winnersMask`). `minSize` şeklinkinden büyük
 * verilirse yalnızca o boyuttan itibaren kolonlar sayılır (aynı seçimlerle farklı sistem biçimleri için).
 */
export function payoutPerColumnUnit(shape: PreparedShape, winnersMask: number, out: Float64Array, scratch: Float64Array, minSize = shape.minSize) {
  winningSums(shape, winnersMask, out, scratch);
  let total = 0;
  for (let j = minSize; j <= shape.n; j++) total += out[j];
  return total;
}

/** Tekrarlanabilir rastgele sayı üreteci (aynı girdi → aynı öneri). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type OutcomeSet = { masks: Int32Array; weights: Float64Array };

/** n seçim için sonuç kümesi: 2^n ≤ exactLimit ise tüm sonuçlar (olasılıklarıyla), değilse sabit tohumlu örnekler. */
export function outcomeSet(probs: readonly number[], exactLimit: number, samples: number, seed = 20261103): OutcomeSet {
  const n = probs.length;
  if (2 ** n <= exactLimit) {
    const count = 1 << n;
    const masks = new Int32Array(count);
    const weights = new Float64Array(count);
    for (let w = 0; w < count; w++) {
      let p = 1;
      for (let i = 0; i < n; i++) p *= w & (1 << i) ? probs[i] : 1 - probs[i];
      masks[w] = w;
      weights[w] = p;
    }
    return { masks, weights };
  }
  const random = seededRandom(seed);
  const masks = new Int32Array(samples);
  const weights = new Float64Array(samples).fill(1 / samples);
  for (let s = 0; s < samples; s++) {
    let w = 0;
    for (let i = 0; i < n; i++) if (random() < probs[i]) w |= 1 << i;
    masks[s] = w;
  }
  return { masks, weights };
}
