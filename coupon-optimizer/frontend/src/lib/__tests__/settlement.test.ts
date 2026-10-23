import { describe, expect, it } from 'vitest';
import { buildPlan } from '../plan';
import { evaluatePlan, summarizeDistribution } from '../probability';
import { settlePlan } from '../settlement';
import type { PartInput, SelectionResult } from '../../types';
import { sel, TL } from './fixtures';

const selections = [sel('a', 2), sel('b', 2), sel('c', 2), sel('d', 2)];
const oddsById = new Map(selections.map((s) => [s.id, s.odds]));

function plan(parts: PartInput[], budget = TL(300)) {
  const r = buildPlan({ strategy: 'recommended', label: 'T', description: '', parts }, selections, budget);
  if (!r.ok) throw new Error(r.errors.join(' '));
  return r.plan;
}

const results = (entries: Record<string, SelectionResult>) => new Map(Object.entries(entries));

describe('kupon sonuçlandırma', () => {
  const normal = plan([{ kind: 'normal', selectionIds: ['a', 'b'], stakeKurus: TL(100) }]);

  it('normal kupon tutarsa kâr hesaplar', () => {
    const s = settlePlan(normal, oddsById, results({ a: 'won', b: 'won' }));
    expect(s.isSettled).toBe(true);
    expect(s.settledReturnKurus).toBe(TL(400));
    expect(s.profitKurus).toBe(TL(300));
  });

  it('bir maç yatarsa normal kupon kaybeder (diğeri beklese bile)', () => {
    const s = settlePlan(normal, oddsById, results({ a: 'lost' }));
    expect(s.isSettled).toBe(true);
    expect(s.settledReturnKurus).toBe(0);
    expect(s.profitKurus).toBe(-TL(100));
  });

  it('bekleyen maç varken sonuç kesinleşmez, olası dönüşü gösterir', () => {
    const s = settlePlan(normal, oddsById, results({ a: 'won' }));
    expect(s.isSettled).toBe(false);
    expect(s.pendingSelectionCount).toBe(1);
    expect(s.potentialReturnKurus).toBe(TL(400));
  });

  it('iade edilen maçın oranı 1,00 sayılır', () => {
    const s = settlePlan(normal, oddsById, results({ a: 'won', b: 'void' }));
    expect(s.settledReturnKurus).toBe(TL(200));
  });

  it('sistem kuponunda yalnızca kazanan kolonların dönüşü toplanır', () => {
    // Sistem 3,4: 5 kolon × 20 TL. d yatarsa yalnızca a+b+c kolonu kazanır: 20 × 8 = 160 TL.
    const sys = plan([{ kind: 'system', selectionIds: ['a', 'b', 'c', 'd'], minSize: 3, allocatedKurus: TL(100) }]);
    const s = settlePlan(sys, oddsById, results({ a: 'won', b: 'won', c: 'won', d: 'lost' }));
    expect(s.parts[0].wonColumns).toBe(1);
    expect(s.parts[0].lostColumns).toBe(4);
    expect(s.settledReturnKurus).toBe(TL(160));
    expect(s.profitKurus).toBe(TL(60));
  });

  it('birden çok kuponun kâr/zararını toplar', () => {
    const mixed = plan([
      { kind: 'normal', selectionIds: ['a', 'b'], stakeKurus: TL(100) },
      { kind: 'normal', selectionIds: ['c', 'd'], stakeKurus: TL(100) },
    ]);
    const s = settlePlan(mixed, oddsById, results({ a: 'won', b: 'won', c: 'won', d: 'lost' }));
    expect(s.stakeKurus).toBe(TL(200));
    expect(s.settledReturnKurus).toBe(TL(400));
    expect(s.profitKurus).toBe(TL(200));
  });
});

describe('öznel olasılık modeli', () => {
  it('beklenen dönüşü ve hiç dönüş alamama ihtimalini hesaplar', () => {
    // 2 maç, %70 ve %80, toplam ödeme 400: beklenen = 400 × 0,56 = 224
    const d = summarizeDistribution([0.7, 0.8], [{ mask: 0b11, amount: 400 }]);
    expect(d.mean).toBeCloseTo(224, 9);
    expect(d.probNoReturn).toBeCloseTo(0.44, 9);
  });

  it('plan istatistiklerini güven puanlarından çıkarır', () => {
    const p = buildPlan(
      { strategy: 'recommended', label: 'T', description: '', parts: [{ kind: 'normal', selectionIds: ['x', 'y'], stakeKurus: TL(100) }] },
      [sel('x', 2, 7), sel('y', 2, 8)],
      TL(100),
    );
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const stats = evaluatePlan(p.plan, [sel('x', 2, 7), sel('y', 2, 8)], 'balanced');
    expect(stats.expectedReturnKurus).toBe(TL(224));
    expect(stats.expectedProfitKurus).toBe(TL(124));
    expect(stats.probProfit).toBeCloseTo(0.56, 9);
  });
});
