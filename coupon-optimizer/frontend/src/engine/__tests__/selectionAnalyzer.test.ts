import { describe, expect, it } from 'vitest';
import { analyzeSelection, expectedValue, impliedProbability, kellyFraction, probabilityRange } from '../selectionAnalyzer';
import { uncertaintyHalfWidth } from '../config';
import { psel, sel } from '../../lib/__tests__/fixtures';

describe('Selection Analyzer', () => {
  it('1. ima edilen olasılık = 1 / oran', () => {
    expect(impliedProbability(2.15)).toBeCloseTo(0.4651, 4);
    expect(analyzeSelection(sel('a', 2)).impliedProbability).toBe(0.5);
  });

  it('2. Edge = tahmini − ima edilen (belgedeki örnek: +8.49 puan)', () => {
    const a = analyzeSelection(psel('a', 2.15, 0.55));
    expect(a.edge! * 100).toBeCloseTo(8.49, 2);
  });

  it('3. EV = p·oran − 1 (belgedeki örnek: 0.1825)', () => {
    expect(expectedValue(0.55, 2.15)).toBeCloseTo(0.1825, 10);
    expect(analyzeSelection(psel('a', 2.15, 0.55)).ev).toBeCloseTo(0.1825, 10);
  });

  it('4. tahmini olasılık yoksa EV/Edge/Kelly uydurulmaz; ima edilen olasılık yerine kullanılmaz', () => {
    const a = analyzeSelection(sel('a', 2.15, 9));
    expect(a.estimatedProbability).toBeNull();
    expect(a.ev).toBeNull();
    expect(a.edge).toBeNull();
    expect(a.kellyFraction).toBeNull();
    expect(a.probabilityRange).toBeNull();
    expect(a.kellyStatus).toBe('unavailable');
  });

  it('5. Kelly ≤ 0 ise stake önerisi yok olarak işaretlenir; pozitifse Quarter Kelly referans gösterilir', () => {
    expect(kellyFraction(0.55, 2.15)).toBeCloseTo((0.55 * 2.15 - 1) / 1.15, 12);
    const negative = analyzeSelection(psel('a', 1.5, 0.5));
    expect(negative.kellyFraction).toBeLessThan(0);
    expect(negative.kellyStatus).toBe('non-positive');
    expect(negative.referenceKelly).toBeNull();
    const positive = analyzeSelection(psel('b', 2.15, 0.55));
    expect(positive.kellyStatus).toBe('positive');
    expect(positive.referenceKelly).toBeCloseTo(positive.kellyFraction! * 0.25, 12);
  });

  it('6. güven puanı olasılık olarak kullanılmaz: EV değişmez, yalnızca belirsizlik aralığı değişir', () => {
    const low = analyzeSelection(psel('a', 2, 0.6, 2));
    const high = analyzeSelection(psel('a', 2, 0.6, 10));
    expect(low.ev).toBe(high.ev);
    expect(low.probabilityRange!.base).toBe(0.6);
    expect(high.probabilityRange!.base).toBe(0.6);
    expect(low.probabilityRange!.high - low.probabilityRange!.low).toBeGreaterThan(high.probabilityRange!.high - high.probabilityRange!.low);
  });

  it('belirsizlik aralığı merkezi yapılandırmadan gelir ve sınırlanır', () => {
    expect(uncertaintyHalfWidth(1)).toBeCloseTo(0.2, 12);
    expect(uncertaintyHalfWidth(10)).toBeCloseTo(0.02, 12);
    const r = probabilityRange(0.05, 1);
    expect(r.low).toBe(0.01);
    expect(probabilityRange(0.95, 1).high).toBe(0.99);
  });
});
