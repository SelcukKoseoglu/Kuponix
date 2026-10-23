import { describe, expect, it } from 'vitest';
import { MAX_COUPONS, PORTFOLIO_POOL_LIMIT, generatePlans, stakeUnitKurus } from '../optimizer';
import { buildPlan } from '../plan';
import { MIN_NORMAL_STAKE_KURUS } from '../money';
import type { MatchSelection, Plan } from '../../types';
import { sel, TL } from './fixtures';

const sample: MatchSelection[] = [
  sel('a', 2.15, 7, 2),
  sel('b', 1.65, 8),
  sel('c', 1.9, 6),
  sel('d', 2.4, 5, 2),
  sel('e', 1.45, 9),
  sel('f', 2.05, 6),
];

function assertPlanInvariants(plan: Plan, budget: number, selections = sample) {
  expect(plan.totalStakeKurus).toBeLessThanOrEqual(budget);
  expect(plan.remainingKurus).toBe(budget - plan.totalStakeKurus);
  expect(plan.parts.length).toBeLessThanOrEqual(MAX_COUPONS);
  for (const part of plan.parts) {
    const items = part.selectionIds.map((id) => selections.find((s) => s.id === id)!);
    expect(new Set(items.map((s) => s.matchName)).size).toBe(items.length);
    if (part.kind === 'normal') {
      expect(part.stakeKurus).toBeGreaterThanOrEqual(MIN_NORMAL_STAKE_KURUS);
      items.forEach((s) => expect(s.minMatches).toBeLessThanOrEqual(items.length));
    } else {
      expect(part.perColumnKurus).toBeGreaterThan(0);
      expect(part.stakeKurus).toBe(part.perColumnKurus * part.columns.length);
      for (const col of part.columns) {
        for (const id of col.selectionIds) expect(selections.find((s) => s.id === id)!.minMatches).toBeLessThanOrEqual(col.size);
      }
    }
  }
}

describe('generatePlans — tek önerilen kupon seti', () => {
  it('her risk tercihinde bütçeyi aşmayan, neredeyse tamamını kullanan tek bir öneri üretir', () => {
    for (const risk of ['cautious', 'balanced', 'aggressive'] as const) {
      const result = generatePlans(sample, TL(300), risk);
      expect(result.plan).not.toBeNull();
      assertPlanInvariants(result.plan!, TL(300));
      // Yalnızca sistem kolonlarının kuruş yuvarlaması kadar artık kalabilir.
      expect(result.plan!.remainingKurus).toBeLessThan(TL(1));
    }
  });

  it('maksimum kâr tercihi tüm bütçeyi tek kupona koyar', () => {
    const result = generatePlans(sample, TL(300), 'aggressive');
    expect(result.plan!.parts).toHaveLength(1);
    expect(result.plan!.totalStakeKurus).toBeGreaterThan(TL(299));
  });

  it('temkinli tercih bütçeyi böler ve hiç dönüş alamama ihtimalini düşürür', () => {
    const cautious = generatePlans(sample, TL(300), 'cautious');
    const aggressive = generatePlans(sample, TL(300), 'aggressive');
    expect(cautious.plan!.parts.length).toBeGreaterThan(1);
    expect(cautious.stats!.probNoReturn).toBeLessThan(aggressive.stats!.probNoReturn);
    expect(aggressive.stats!.expectedReturnKurus).toBeGreaterThanOrEqual(cautious.stats!.expectedReturnKurus);
  });

  it('öneri, hedef puanında tek kupon karşılaştırmalarından geri kalmaz', () => {
    for (const risk of ['cautious', 'balanced', 'aggressive'] as const) {
      const result = generatePlans(sample, TL(300), risk);
      for (const c of result.comparisons) expect(result.stats!.score).toBeGreaterThanOrEqual(c.stats.score - TL(1));
    }
  });

  it('sonucu işaretlenmiş maçları yeni öneriye almaz', () => {
    const marked = sample.map((s, i) => (i < 2 ? { ...s, result: i === 0 ? ('won' as const) : ('lost' as const) } : s));
    const result = generatePlans(marked, TL(300));
    expect(result.plan!.selectionIds).not.toContain('a');
    expect(result.plan!.selectionIds).not.toContain('b');
    expect(result.notes.join(' ')).toContain('sonucu işaretlendiği');
  });

  it('aynı maçtan iki seçimi aynı kupona koymaz', () => {
    const sameMatch = [...sample, { ...sel('g', 3.5, 8), matchName: 'Maç e' }];
    const result = generatePlans(sameMatch, TL(300), 'aggressive');
    assertPlanInvariants(result.plan!, TL(300), sameMatch);
  });

  it('bütçe 50 TL altındaysa normal kupon kullanmaz', () => {
    const result = generatePlans(sample, TL(40));
    expect(result.plan).not.toBeNull();
    expect(result.plan!.parts.every((p) => p.kind === 'system')).toBe(true);
    expect(result.notes.join(' ')).toContain('normal kupon');
    assertPlanInvariants(result.plan!, TL(40));
  });

  it('min. maç sayısı 2 olan tek seçimle öneri üretmez', () => {
    const result = generatePlans([sel('a', 2, 9, 2)], TL(100));
    expect(result.plan).toBeNull();
    expect(result.notes.join(' ')).toContain('geçerli bir öneri bulunamadı');
  });

  it('boş listede ve geçersiz bütçede öneri üretmez', () => {
    expect(generatePlans([], TL(300)).plan).toBeNull();
    expect(generatePlans(sample, 0).plan).toBeNull();
    expect(generatePlans(sample, null).plan).toBeNull();
  });

  it('geçersiz seçimleri kullanmaz', () => {
    const result = generatePlans([...sample, { ...sel('x', 2), odds: 0.9 }], TL(300));
    expect(result.validSelectionCount).toBe(sample.length);
    expect(result.plan!.selectionIds).not.toContain('x');
  });

  it(`${PORTFOLIO_POOL_LIMIT} üzeri seçimde havuzu budar ve makul sürede biter`, () => {
    const many = Array.from({ length: 40 }, (_, i) => sel(`s${i}`, 1.3 + (i % 9) * 0.25, 1 + (i % 10), 1 + (i % 3)));
    const start = Date.now();
    const result = generatePlans(many, TL(500));
    expect(Date.now() - start).toBeLessThan(5000);
    expect(result.pruned).toBe(true);
    expect(result.usedPoolSize).toBe(PORTFOLIO_POOL_LIMIT);
    expect(result.notes.join(' ')).toContain('Performans sınırı');
    assertPlanInvariants(result.plan!, TL(500), many);
  });

  it('bütçe birimi bütçeye göre seçilir', () => {
    expect(stakeUnitKurus(TL(300))).toBe(TL(10));
    expect(stakeUnitKurus(TL(120))).toBe(TL(5));
    expect(stakeUnitKurus(TL(30))).toBe(TL(1));
  });
});

describe('buildPlan', () => {
  it('kullanıcı tutarı bütçeyi aşarsa reddeder', () => {
    const r = buildPlan(
      {
        strategy: 'recommended',
        label: 'Test',
        description: '',
        parts: [
          { kind: 'normal', selectionIds: ['b', 'c'], stakeKurus: TL(200) },
          { kind: 'system', selectionIds: ['b', 'c', 'e'], minSize: 2, allocatedKurus: TL(150) },
        ],
      },
      sample,
      TL(300),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toContain('bütçeyi');
  });

  it('kullanıcı normal kupon tutarını 50 TL altına çekemez', () => {
    const r = buildPlan(
      { strategy: 'recommended', label: 'Test', description: '', parts: [{ kind: 'normal', selectionIds: ['b', 'c'], stakeKurus: TL(30) }] },
      sample,
      TL(300),
    );
    expect(r.ok).toBe(false);
  });
});
