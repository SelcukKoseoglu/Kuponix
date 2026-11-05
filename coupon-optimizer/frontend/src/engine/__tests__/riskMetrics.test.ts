import { describe, expect, it } from 'vitest';
import { computeRiskMetrics, noBetMetrics, weightedTail } from '../riskMetrics';
import { buildOutcomeSpace } from '../correlation';
import { evaluatePlanOnSpace } from '../scenarios';
import { computeExposures } from '../exposure';
import { buildPlan } from '../../lib/plan';
import { psel, TL } from '../../lib/__tests__/fixtures';

const exact = { kind: 'exact' as const, scenarios: 4 };

describe('risk metrikleri', () => {
  it('32/33. pozitif net getiri ve tam kayıp olasılığı doğru', () => {
    // 2 seçimli normal kupon, %60 ve %50, oran 2 ve 2, 100 TL → kazanırsa 400 TL.
    const selections = [psel('a', 2, 0.6), psel('b', 2, 0.5)];
    const plan = buildPlan({ label: 'T', description: '', parts: [{ kind: 'normal', selectionIds: ['a', 'b'], stakeKurus: TL(100) }] }, selections, TL(300));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const space = buildOutcomeSpace(
      selections.map((s) => ({ id: s.id, groupKey: `m:${s.id}`, p: s.estimatedProbability! })),
      'independent',
      [],
      { enumerationLimit: 100, samples: 10, seed: 1 },
    );
    const { metrics } = evaluatePlanOnSpace(plan.plan, space, new Map(selections.map((s) => [s.id, s])));
    expect(metrics.probPositive).toBeCloseTo(0.3, 12);
    expect(metrics.probTotalLoss).toBeCloseTo(0.7, 12);
    expect(metrics.probNegative).toBeCloseTo(0.7, 12);
    expect(metrics.expectedGrossKurus).toBe(TL(120));
    expect(metrics.expectedNetKurus).toBe(TL(20));
    expect(metrics.maxNetKurus).toBe(TL(300));
    expect(metrics.worstNetKurus).toBe(-TL(100));
    expect(metrics.remainingKurus).toBe(TL(200));
    expect(metrics.method).toEqual({ kind: 'exact', scenarios: 4 });
  });

  it('34. P5 ve Expected Shortfall (%5) doğru; kuyruk sınırında kısmi ağırlık kullanılır', () => {
    // Net: −100 (%3), −50 (%4), +20 (%93) → en kötü %5 = %3·(−100) + %2·(−50) → ES = −80, P5 = −50.
    const gross = new Float64Array([0, 50, 120]);
    const weights = new Float64Array([0.03, 0.04, 0.93]);
    const m = computeRiskMetrics(gross, weights, 100, 300, exact);
    expect(m.p5NetKurus).toBe(-50);
    expect(m.expectedShortfall5Kurus).toBe(-80);
    expect(m.averageLossKurus).toBe(Math.round((0.03 * -100 + 0.04 * -50) / 0.07));
    const tail = weightedTail(new Float64Array([-100, 0]), new Float64Array([0.5, 0.5]), 0.05);
    expect(tail.shortfall).toBe(-100);
  });

  it('"kupon oluşturmama": her senaryoda net 0, risk yok', () => {
    const m = noBetMetrics(TL(300));
    expect(m.stakeKurus).toBe(0);
    expect(m.expectedNetKurus).toBe(0);
    expect(m.probTotalLoss).toBe(0);
    expect(m.expectedShortfall5Kurus).toBe(0);
    expect(m.remainingKurus).toBe(TL(300));
  });
});

describe('ortak seçim yoğunlaşması', () => {
  it('16/17. aynı seçim farklı kuponlarda kullanılınca maruziyet toplanır', () => {
    const selections = [psel('a', 2, 0.6), psel('b', 2, 0.5), psel('c', 2, 0.5), psel('d', 2, 0.5)];
    const plan = buildPlan(
      {
        label: 'T',
        description: '',
        parts: [
          { kind: 'normal', selectionIds: ['a', 'b'], stakeKurus: TL(60) },
          { kind: 'system', selectionIds: ['a', 'c', 'd'], sizes: [2], allocatedKurus: TL(60) },
        ],
      },
      selections,
      TL(300),
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const { selections: rows, matches } = computeExposures(plan.plan, new Map(selections.map((s) => [s.id, s])), TL(300));
    const a = rows.find((r) => r.key === 'a')!;
    // Normal kuponun tamamı (60) + sistemde a'yı içeren 2 kolon (2 × 20) = 100 TL.
    expect(a.couponCount).toBe(2);
    expect(a.columnCount).toBe(3);
    expect(a.exposedStakeKurus).toBe(TL(100));
    expect(a.budgetPct).toBeCloseTo((100 / 300) * 100, 9);
    expect(rows[0].key).toBe('a'); // en yüksek maruziyet başta
    expect(matches.find((m) => m.key === 'm-a')!.exposedStakeKurus).toBe(TL(100));
  });
});
