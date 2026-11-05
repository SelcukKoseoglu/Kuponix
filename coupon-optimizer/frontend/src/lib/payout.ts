/**
 * Kolonları tek tek saymadan sistem kuponu dönüşü.
 *
 * Bir sistem kuponunun j'li kolonları, min. maç değeri j'yi aşmayan seçimlerden kurulur. Bir sonuçta kazanan
 * seçimler belliyken, kazanan j'li kolonların oran çarpımları toplamı, kazananların oranları üzerindeki j. dereceden
 * elementer simetrik polinomdur (e_j). e_0…e_n tek bir O(n²) döngüyle bulunur; böylece binlerce kolon tek tek
 * dolaşılmaz. Normal kupon, tek boyutu n olan sistem gibi ele alınır.
 */
import { binomial } from './combinatorics';

export type CouponShape = {
  odds: readonly number[];
  minMatches: readonly number[];
  /** Kolon boyutları, ör. [3, 4]. Normal kupon için [n]. */
  sizes: readonly number[];
};

/** Aynı izinli seçim kümesine sahip boyut aralığı [from, to]. */
type Segment = { from: number; to: number; allowedMask: number };

export type PreparedShape = {
  odds: readonly number[];
  minMatches: readonly number[];
  sizes: number[];
  n: number;
  segments: Segment[];
  /** Boyuta göre geçerli kolon sayısı (yalnızca formattaki boyutlar için dolu). */
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
  const sizes = Array.from(new Set(shape.sizes)).filter((j) => j >= 1 && j <= n).sort((a, b) => a - b);
  const segments: Segment[] = [];
  const columnsBySize = new Array(n + 1).fill(0);
  if (sizes.length > 0) {
    for (let j = sizes[0]; j <= sizes[sizes.length - 1]; j++) {
      let allowedMask = 0;
      for (let i = 0; i < n; i++) if (shape.minMatches[i] <= j) allowedMask |= 1 << i;
      const last = segments[segments.length - 1];
      if (last && last.allowedMask === allowedMask) last.to = j;
      else segments.push({ from: j, to: j, allowedMask });
    }
    for (const j of sizes) {
      const seg = segments.find((s) => s.from <= j && j <= s.to)!;
      columnsBySize[j] = binomial(popcount(seg.allowedMask), j);
    }
  }
  return {
    odds: shape.odds,
    minMatches: shape.minMatches,
    sizes,
    n,
    segments,
    columnsBySize,
    columns: columnsBySize.reduce((a, b) => a + b, 0),
  };
}

/**
 * Kazanan seçimler `winnersMask` iken j'li geçerli kolonların oran çarpımları toplamını `out[j]` içine yazar
 * (formatın en küçük–en büyük boyutu arasındaki tüm j için). `out` ve `scratch` uzunluğu en az n + 1 olmalıdır.
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

/** Kazanan kolonların oran çarpımları toplamı (kolon başına 1 birim yatırımla toplam brüt dönüş). */
export function payoutPerColumnUnit(
  shape: PreparedShape,
  winnersMask: number,
  out: Float64Array,
  scratch: Float64Array,
  sizes: readonly number[] = shape.sizes,
): number {
  winningSums(shape, winnersMask, out, scratch);
  let total = 0;
  for (const j of sizes) total += out[j];
  return total;
}

/** Kazanan seçimler `winnersMask` iken kaç geçerli kolonun kazandığı. */
export function winningColumnCount(shape: PreparedShape, winnersMask: number): number {
  let total = 0;
  for (const j of shape.sizes) {
    const seg = shape.segments.find((s) => s.from <= j && j <= s.to)!;
    total += binomial(popcount(seg.allowedMask & winnersMask), j);
  }
  return total;
}
