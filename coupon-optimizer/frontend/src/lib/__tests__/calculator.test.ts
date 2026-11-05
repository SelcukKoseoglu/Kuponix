import { describe, expect, it } from 'vitest';
import { calculateNormalCoupon, calculateSystemCoupon, grossReturnKurus, splitStake, systemLabel } from '../calculator';
import { binomial } from '../combinatorics';
import { sel, TL } from './fixtures';

const four = () => [sel('a', 2), sel('b', 2), sel('c', 2), sel('d', 2)];

describe('normal kupon', () => {
  it('oranları çarpar ve teorik brüt dönüşü kuruş hassasiyetinde hesaplar', () => {
    const r = calculateNormalCoupon([sel('a', 2.15), sel('b', 1.8), sel('c', 1.5)], TL(100));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.combinedOdds).toBeCloseTo(5.805, 10);
    expect(r.value.grossReturnKurus).toBe(TL(580.5));
  });

  it('float hatası olmadan yuvarlar', () => {
    expect(grossReturnKurus(TL(50), [1.11, 1.11, 1.11])).toBe(6838);
    expect(grossReturnKurus(1, [1.5])).toBe(2);
  });

  it('50 TL alt sınırını uygular', () => {
    expect(calculateNormalCoupon([sel('a', 2), sel('b', 2)], TL(49.99)).ok).toBe(false);
    expect(calculateNormalCoupon([sel('a', 2), sel('b', 2)], TL(50)).ok).toBe(true);
  });

  it('min. maç sayısını toplam seçim sayısı üzerinden doğrular', () => {
    expect(calculateNormalCoupon([sel('a', 2, 7, 3), sel('b', 2)], TL(100)).ok).toBe(false);
    expect(calculateNormalCoupon([sel('a', 2, 7, 2), sel('b', 2)], TL(100)).ok).toBe(true);
  });
});

describe('sistem kuponu', () => {
  it('Sistem 3,4: 4 seçimden 5 kolon üretir', () => {
    expect(binomial(4, 3) + binomial(4, 4)).toBe(5);
    const r = calculateSystemCoupon(four(), [3, 4], TL(100));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.label).toBe('Sistem 3,4');
    expect(r.value.columns).toHaveLength(5);
    expect(r.value.columns.filter((c) => c.size === 3)).toHaveLength(4);
    expect(r.value.perColumnKurus).toBe(TL(20));
  });

  it('tek boyutlu ve ardışık olmayan formatları da hesaplar', () => {
    const s3 = calculateSystemCoupon(four(), [3], TL(100));
    expect(s3.ok && s3.value.columns.length).toBe(4);
    expect(s3.ok && s3.value.label).toBe('Sistem 3');
    const s24 = calculateSystemCoupon(four(), [2, 4], TL(100));
    expect(s24.ok && s24.value.columns.length).toBe(7);
  });

  it('sabit 4 seçim sınırı yoktur: 9 seçimlik sistem hesaplanır', () => {
    const nine = Array.from({ length: 9 }, (_, i) => sel(`s${i}`, 1.5));
    const r = calculateSystemCoupon(nine, [7, 8, 9], TL(100));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.columns).toHaveLength(binomial(9, 7) + binomial(9, 8) + 1);
  });

  it('her kolonun oranı kendi seçimlerinin çarpımıdır', () => {
    const r = calculateSystemCoupon([sel('a', 2), sel('b', 1.5), sel('c', 3)], [2], TL(90));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const odds = Object.fromEntries(r.value.columns.map((c) => [c.selectionIds.join('+'), c.combinedOdds]));
    expect(odds['a+b']).toBeCloseTo(3, 10);
    expect(odds['a+c']).toBeCloseTo(6, 10);
    expect(odds['b+c']).toBeCloseTo(4.5, 10);
  });

  it('kalan kuruşları ilk kolonlara deterministik dağıtır; toplam ayrılan tutara eşittir', () => {
    expect(splitStake(10001, 4)).toEqual([2501, 2500, 2500, 2500]);
    expect(splitStake(10000, 6)).toEqual([1667, 1667, 1667, 1667, 1666, 1666]);
    const r = calculateSystemCoupon([sel('a', 2), sel('b', 2), sel('c', 2)], [2, 3], TL(100.01));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const total = r.value.columns.reduce((s, c) => s + c.stakeKurus, 0);
    expect(total).toBe(TL(100.01));
    expect(r.value.stakeKurus).toBe(TL(100.01));
    expect(r.value.columns.map((c) => c.stakeKurus)).toEqual([2501, 2500, 2500, 2500]);
    // Aynı girdi her zaman aynı dağıtımı verir.
    const again = calculateSystemCoupon([sel('a', 2), sel('b', 2), sel('c', 2)], [2, 3], TL(100.01));
    expect(again.ok && again.value.columns.map((c) => c.stakeKurus)).toEqual(r.value.columns.map((c) => c.stakeKurus));
  });

  it('min. maç kuralını her kolonda ayrı kontrol eder ve dışlanan kolonları nedenleriyle raporlar', () => {
    const r = calculateSystemCoupon([sel('a', 2), sel('b', 2), sel('c', 2), sel('d', 2, 7, 4)], [3, 4], TL(100));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.totalColumns).toBe(5);
    expect(r.value.columns).toHaveLength(2);
    expect(r.value.excludedColumns).toHaveLength(3);
    expect(r.value.excludedColumns.every((c) => c.selectionIds.includes('d') && c.size === 3)).toBe(true);
    expect(r.value.excludedColumns[0].reason).toContain('en az 4');
    expect(r.value.perColumnKurus).toBe(TL(50));
  });

  it('tüm kolonlar dışlanırsa formatı geçersiz sayar', () => {
    const r = calculateSystemCoupon([sel('a', 2, 7, 5), sel('b', 2, 7, 4), sel('c', 2, 7, 4)], [2], TL(100));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('geçerli kolon kalmadı');
  });

  it('sistem alt tutarını, kolon başı alt/üst sınırlarını ve 0/negatif tutarı uygular', () => {
    expect(calculateSystemCoupon(four(), [3, 4], TL(49.99)).ok).toBe(false);
    expect(calculateSystemCoupon(four(), [3, 4], TL(30), { minSystemStakeKurus: TL(30) }).ok).toBe(true);
    expect(calculateSystemCoupon(four(), [3, 4], 0).ok).toBe(false);
    expect(calculateSystemCoupon(four(), [3, 4], -100).ok).toBe(false);
    expect(calculateSystemCoupon(four(), [3, 4], TL(100), { minColumnStakeKurus: TL(25) }).ok).toBe(false);
    expect(calculateSystemCoupon(four(), [3, 4], TL(100), { maxColumnStakeKurus: TL(15) }).ok).toBe(false);
    expect(calculateSystemCoupon(four(), [3, 4], TL(100), { minColumnStakeKurus: TL(20), maxColumnStakeKurus: TL(20) }).ok).toBe(true);
  });

  it('geçersiz formatları reddeder', () => {
    expect(calculateSystemCoupon(four(), [4], TL(100)).ok).toBe(false); // yalnızca 4'lü = normal kupon
    expect(calculateSystemCoupon(four(), [5], TL(100)).ok).toBe(false);
    expect(calculateSystemCoupon(four(), [], TL(100)).ok).toBe(false);
    expect(systemLabel([4, 2, 3])).toBe('Sistem 2,3,4');
  });

  it('senaryolarda yalnızca kazanan kolonların dönüşünü toplar', () => {
    const r = calculateSystemCoupon(four(), [3, 4], TL(100));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [none, one, two] = r.value.scenarios;
    expect(none.maxReturnKurus).toBe(TL(960));
    expect(one.maxReturnKurus).toBe(TL(160));
    expect(one.maxWinningColumns).toBe(1);
    expect(two.maxReturnKurus).toBe(0);
  });
});
