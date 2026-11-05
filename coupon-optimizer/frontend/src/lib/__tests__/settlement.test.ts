import { describe, expect, it } from 'vitest';
import { buildPlan } from '../plan';
import { settlePlan } from '../settlement';
import type { PartInput, SelectionResult } from '../../types';
import { sel, TL } from './fixtures';

const selections = [sel('a', 2), sel('b', 2), sel('c', 2), sel('d', 2)];
const oddsById = new Map(selections.map((s) => [s.id, s.odds]));

function plan(parts: PartInput[], budget = TL(300)) {
  const r = buildPlan({ label: 'T', description: '', parts }, selections, budget);
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
    const sys = plan([{ kind: 'system', selectionIds: ['a', 'b', 'c', 'd'], sizes: [3, 4], allocatedKurus: TL(100) }]);
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
