import { describe, expect, it } from 'vitest';
import { systemFormats } from '../systemFormats';
import { calculateSystemCoupon, formatColumnCount } from '../../lib/calculator';
import { sel, TL } from '../../lib/__tests__/fixtures';

const keys = (formats: number[][]) => formats.map((f) => f.join(','));

describe('dinamik sistem formatları', () => {
  it('7. 4 seçim için Sistem 3,4 üretilir ve 5 kolondur', () => {
    expect(keys(systemFormats(4))).toContain('3,4');
    expect(formatColumnCount(4, [3, 4])).toBe(5);
  });

  it('8. 6 seçim için formatlar dinamik üretilir (tek, ikili, üst aralık)', () => {
    const f = keys(systemFormats(6));
    for (const k of ['2', '3', '4', '5', '2,3', '3,4', '4,5', '5,6', '2,3,4,5,6', '3,4,5,6', '4,5,6']) expect(f).toContain(k);
    expect(f).not.toContain('6'); // yalnızca 6'lı = normal kupon
    expect(new Set(f).size).toBe(f.length);
  });

  it('9. sabit 4 seçim sınırı yoktur', () => {
    for (const n of [5, 8, 12, 15]) {
      const f = systemFormats(n);
      expect(f.some((sizes) => sizes.includes(n - 1))).toBe(true);
      expect(Math.max(...f.flat())).toBe(n);
    }
    const twelve = Array.from({ length: 12 }, (_, i) => sel(`s${i}`, 1.4));
    expect(calculateSystemCoupon(twelve, [11, 12], TL(100)).ok).toBe(true);
  });

  it('üretilen her format hesaplayıcıda geçerlidir', () => {
    const six = Array.from({ length: 6 }, (_, i) => sel(`s${i}`, 1.7));
    for (const sizes of systemFormats(6)) {
      const r = calculateSystemCoupon(six, sizes, TL(200));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.columns.length).toBe(formatColumnCount(6, sizes));
    }
  });
});
