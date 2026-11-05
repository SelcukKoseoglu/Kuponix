/**
 * Dinamik sistem formatı üretimi. n seçim için (sabit bir seçim sınırı yoktur):
 *  - tek boyut:      Sistem j       (2 ≤ j ≤ n−1)
 *  - ardışık ikili:  Sistem j,j+1   (2 ≤ j ≤ n−1; j+1 = n dahil)
 *  - üst aralık:     Sistem k,…,n   (2 ≤ k ≤ n−2)
 * Bunlar matematiksel kombinasyon formatlarıdır; oynanabilirlik bahis platformunun kurallarına göre doğrulanmalıdır.
 */
import { ENGINE_CONFIG } from './config';

export function systemFormats(n: number, minColumnSize = ENGINE_CONFIG.minSystemColumnSize): number[][] {
  const formats = new Map<string, number[]>();
  const add = (sizes: number[]) => formats.set(sizes.join(','), sizes);
  for (let j = minColumnSize; j <= n - 1; j++) {
    add([j]);
    add([j, j + 1]);
  }
  for (let k = minColumnSize; k <= n - 2; k++) add(Array.from({ length: n - k + 1 }, (_, i) => k + i));
  return Array.from(formats.values());
}
