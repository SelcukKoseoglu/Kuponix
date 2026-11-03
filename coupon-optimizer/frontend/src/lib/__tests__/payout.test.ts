import { describe, expect, it } from 'vitest';
import { calculateSystemCoupon, lossScenarios, lossScenariosFromShape } from '../calculator';
import { combinations, systemColumnCount } from '../combinatorics';
import { generatePlans } from '../optimizer';
import { outcomeSet, payoutPerColumnUnit, prepareShape, winningColumnCount, type CouponShape } from '../payout';
import { buildPlan } from '../plan';
import { evaluatePlan, planTerms, subjectiveProbability, summarizeDistribution } from '../probability';
import { sel, TL } from './fixtures';

/** Kolonları tek tek sayarak (eski yöntem) kazanan kolonların oran çarpımları toplamı. */
function bruteForce(shape: CouponShape, winners: number) {
  const n = shape.odds.length;
  const idx = shape.odds.map((_, i) => i);
  let total = 0;
  let count = 0;
  for (let size = shape.minSize; size <= n; size++) {
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
    { odds: [2, 1.5, 3.1, 1.8], minMatches: [1, 1, 1, 1], minSize: 3 },
    { odds: [2.15, 1.65, 1.9, 2.4, 1.45, 2.05], minMatches: [2, 1, 1, 2, 1, 4], minSize: 2 },
    { odds: [1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0], minMatches: [1, 3, 1, 5, 1, 1, 6, 1], minSize: 3 },
  ];

  it('her sonuçta kolon kolon saymayla aynı toplamı ve kolon sayısını verir', () => {
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

  it('daha büyük k ile aynı şekilden alt sistem dönüşü verir', () => {
    const raw = shapes[1];
    const shape = prepareShape(raw);
    const out = new Float64Array(7);
    const scratch = new Float64Array(7);
    for (let w = 0; w < 1 << shape.n; w++) {
      expect(payoutPerColumnUnit(shape, w, out, scratch, 4)).toBeCloseTo(bruteForce({ ...raw, minSize: 4 }, w).total, 9);
    }
  });

  it('senaryolar iki yöntemde de aynı çıkar', () => {
    const selections = [sel('a', 2), sel('b', 1.5), sel('c', 3.1), sel('d', 1.8, 7, 3), sel('e', 2.2)];
    const r = calculateSystemCoupon(selections, 2, TL(260));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ids = selections.map((s) => s.id);
    const masks = r.value.columns.map((c) => c.selectionIds.reduce((m, id) => m | (1 << ids.indexOf(id)), 0));
    const exact = lossScenarios(5, masks, r.value.columns.map((c) => c.returnKurus));
    const fast = lossScenariosFromShape(
      prepareShape({ odds: selections.map((s) => s.odds), minMatches: selections.map((s) => s.minMatches), minSize: 2 }),
      r.value.perColumnKurus,
    );
    fast.forEach((sc, i) => {
      expect(Math.abs(sc.maxReturnKurus - exact[i].maxReturnKurus)).toBeLessThanOrEqual(r.value.columns.length);
      expect(sc.maxWinningColumns).toBe(exact[i].maxWinningColumns);
      expect(sc.minWinningColumns).toBe(exact[i].minWinningColumns);
    });
  });

  it('örnek senaryolar tekrarlanabilir; küçük kümede tüm sonuçlar kesin', () => {
    const a = outcomeSet([0.7, 0.6, 0.8], 4096, 100);
    expect(a.masks.length).toBe(8);
    expect(a.weights.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 12);
    const b = outcomeSet(new Array(14).fill(0.7), 4096, 500, 42);
    const c = outcomeSet(new Array(14).fill(0.7), 4096, 500, 42);
    expect(Array.from(b.masks)).toEqual(Array.from(c.masks));
  });
});

describe('büyük sistemler', () => {
  it('15 maçlık sistem kuponu hesaplanır', () => {
    const fifteen = Array.from({ length: 15 }, (_, i) => sel(`m${i}`, 1.5 + (i % 3) * 0.1));
    const r = calculateSystemCoupon(fifteen, 13, TL(200));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.columns).toHaveLength(systemColumnCount(15, 13)); // 105 + 15 + 1 = 121
    expect(r.value.label).toBe('Sistem 13,14,15');
    expect(r.value.scenarios[0].maxWinningColumns).toBe(121);
    expect(r.value.scenarios[3].maxReturnKurus).toBe(0);
  });

  it('plan istatistikleri kolon kolon hesapla uyumlu', () => {
    const selections = [sel('a', 2, 7), sel('b', 1.5, 8), sel('c', 3.1, 5), sel('d', 1.8, 6, 3), sel('e', 2.2, 7)];
    const built = buildPlan(
      {
        strategy: 'recommended',
        label: 'T',
        description: '',
        parts: [
          { kind: 'system', selectionIds: ['a', 'b', 'c', 'd', 'e'], minSize: 2, allocatedKurus: TL(150) },
          { kind: 'normal', selectionIds: ['a', 'b'], stakeKurus: TL(100) },
        ],
      },
      selections,
      TL(300),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const stats = evaluatePlan(built.plan, selections, 'balanced');
    const probs = built.plan.selectionIds.map((id) => subjectiveProbability(selections.find((s) => s.id === id)!.confidence));
    const exact = summarizeDistribution(probs, planTerms(built.plan), built.plan.totalStakeKurus);
    // Kolon kolon yuvarlama farkı en fazla kolon sayısı kadar kuruş olabilir.
    expect(Math.abs(stats.expectedReturnKurus - Math.round(exact.mean))).toBeLessThanOrEqual(30);
    expect(stats.probNoReturn).toBeCloseTo(exact.probNoReturn, 9);
    expect(stats.probProfit).toBeCloseTo(exact.probAbove, 6);
  });

  it('15 maçta 5 maçtan büyük sistemler aday olur ve öneri makul sürede biter', () => {
    const fifteen = Array.from({ length: 15 }, (_, i) => sel(`h${i}`, 1.3 + (i % 4) * 0.1, 9));
    const start = Date.now();
    const sizes = (['cautious', 'balanced', 'aggressive'] as const).flatMap((risk) =>
      generatePlans(fifteen, TL(300), risk).plan!.parts.filter((p) => p.kind === 'system').map((p) => p.selectionCount),
    );
    expect(Date.now() - start).toBeLessThan(8000);
    expect(Math.max(...sizes)).toBeGreaterThan(5);
  });
});
