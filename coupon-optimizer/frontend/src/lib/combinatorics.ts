export function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  const kk = Math.min(k, n - k);
  let result = 1;
  for (let i = 1; i <= kk; i++) result = (result * (n - kk + i)) / i;
  return Math.round(result);
}

/** Dizinin `size` elemanlı tüm kombinasyonlarını sözlük sırasıyla üretir. */
export function* combinations<T>(items: readonly T[], size: number): Generator<T[]> {
  const n = items.length;
  if (size < 1 || size > n) return;
  const idx = Array.from({ length: size }, (_, i) => i);
  while (true) {
    yield idx.map((i) => items[i]);
    let i = size - 1;
    while (i >= 0 && idx[i] === n - size + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < size; j++) idx[j] = idx[j - 1] + 1;
  }
}

/** "Sistem k..n" formatının kolon sayısı: Σ_{j=k}^{n} C(n, j). */
export function systemColumnCount(n: number, minSize: number): number {
  let total = 0;
  for (let j = minSize; j <= n; j++) total += binomial(n, j);
  return total;
}
