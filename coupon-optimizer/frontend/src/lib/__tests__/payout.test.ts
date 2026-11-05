import { describe, expect, it } from 'vitest';
import { calculateSystemCoupon, lossScenarios, lossScenariosFromShape } from '../calculator';
import { combinations } from '../combinatorics';
import { payoutPerColumnUnit, prepareShape, winningColumnCount, type CouponShape } from '../payout';
import { sel, TL } from './fixtures';

/** Kolonları tek tek sayarak kazanan kolonların oran çarpımları toplamı. */
function bruteForce(shape: CouponShape, winners: number) {
  const idx = shape.odds.map((_, i) => i);
  let total = 0;
  let count = 0;
  for (const size of shape.sizes) {
    for (const combo of combinations(idx, size)) {
      if (combo.some((i) => shape.minMatches[i] > size)) continue;
      if (!combo.every((i) => winners & (1 << i))) continue;
      total += combo.reduce((p, i) => p * shape.odds[i], 1);
      count++;
    }
  }
  return { total, count };
}

describe('kolonsuz sistem dönüşü', () => {
  const shapes: CouponShape[] = [
    { odds: [2, 1.5, 3.1, 1.8], minMatches: [1, 1, 1, 1], sizes: [3, 4] },
    { odds: [2.15, 1.65, 1.9, 2.4, 1.45, 2.05], minMatches: [2, 1, 1, 2, 1, 4], sizes: [2, 3, 4, 5, 6] },
    { odds: [2.15, 1.65, 1.9, 2.4, 1.45, 2.05], minMatches: [2, 1, 1, 2, 1, 4], sizes: [3] },
    { odds: [1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0], minMatches: [1, 3, 1, 5, 1, 1, 6, 1], sizes: [2, 4, 7] },
  ];

  it('her sonuçta kolon kolon saymayla aynı toplamı ve kolon sayısını verir (min. maç dahil)', () => {
    const out = new Float64Array(9);
    const scratch = new Float64Array(9);
    for (const raw of shapes) {
      const shape = prepareShape(raw);
      for (let w = 0; w < 1 << shape.n; w++) {
        const expected = bruteForce(raw, w);
        expect(payoutPerColumnUnit(shape, w, out, scratch)).toBeCloseTo(expected.total, 9);
        expect(winningColumnCount(shape, w)).toBe(expected.count);
      }
      expect(shape.columns).toBe(bruteForce(raw, (1 << shape.n) - 1).count);
    }
  });

  it('aynı şekilden farklı boyut alt kümesinin dönüşünü verir', () => {
    const raw = shapes[1];
    const shape = prepareShape(raw);
    const out = new Float64Array(7);
    const scratch = new Float64Array(7);
    for (let w = 0; w < 1 << shape.n; w++) {
      expect(payoutPerColumnUnit(shape, w, out, scratch, [4, 5])).toBeCloseTo(bruteForce({ ...raw, sizes: [4, 5] }, w).total, 9);
    }
  });

  it('senaryolar iki yöntemde de aynı çıkar', () => {
    const selections = [sel('a', 2), sel('b', 1.5), sel('c', 3.1), sel('d', 1.8, 7, 3), sel('e', 2.2)];
    const r = calculateSystemCoupon(selections, [2, 3, 4, 5], TL(260));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ids = selections.map((s) => s.id);
    const masks = r.value.columns.map((c) => c.selectionIds.reduce((m, id) => m | (1 << ids.indexOf(id)), 0));
    const exact = lossScenarios(5, masks, r.value.columns.map((c) => c.returnKurus));
    const fast = lossScenariosFromShape(
      prepareShape({ odds: selections.map((s) => s.odds), minMatches: selections.map((s) => s.minMatches), sizes: [2, 3, 4, 5] }),
      r.value.stakeKurus / r.value.columns.length,
    );
    // Fark yalnızca kolon başı ortalama tutar kullanımından gelir: en fazla Σ (1 kuruş × kolon oranı) + yuvarlama.
    const tolerance = r.value.columns.reduce((s, c) => s + c.combinedOdds, 0) + r.value.columns.length;
    fast.forEach((sc, i) => {
      expect(Math.abs(sc.maxReturnKurus - exact[i].maxReturnKurus)).toBeLessThanOrEqual(tolerance);
      expect(sc.maxWinningColumns).toBe(exact[i].maxWinningColumns);
      expect(sc.minWinningColumns).toBe(exact[i].minWinningColumns);
    });
  });

  it('15 maçlık sistem kuponu hesaplanır', () => {
    const fifteen = Array.from({ length: 15 }, (_, i) => sel(`m${i}`, 1.5 + (i % 3) * 0.1));
    const r = calculateSystemCoupon(fifteen, [13, 14, 15], TL(200));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.columns).toHaveLength(121);
    expect(r.value.label).toBe('Sistem 13,14,15');
    expect(r.value.scenarios[0].maxWinningColumns).toBe(121);
    expect(r.value.scenarios[3].maxReturnKurus).toBe(0);
  });
});
