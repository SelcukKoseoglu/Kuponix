import { describe, expect, it } from 'vitest';
import { calculateNormalCoupon, calculateSystemCoupon, grossReturnKurus, systemLabel } from '../calculator';
import { binomial, systemColumnCount } from '../combinatorics';
import { sel, TL } from './fixtures';

describe('normal kupon', () => {
  it('oranları çarpar ve teorik brüt dönüşü kuruş hassasiyetinde hesaplar', () => {
    const r = calculateNormalCoupon([sel('a', 2.15), sel('b', 1.8), sel('c', 1.5)], TL(100));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.combinedOdds).toBeCloseTo(5.805, 10);
    expect(r.value.grossReturnKurus).toBe(TL(580.5));
  });

  it('float hatası olmadan yuvarlar (0.1 × 3 türü sorunlar)', () => {
    // 50 TL × 1.11 × 1.11 × 1.11 = 68.38... → 68,38 TL (kesin: 68.381550)
    expect(grossReturnKurus(TL(50), [1.11, 1.11, 1.11])).toBe(6838);
    // yarım kuruş yukarı yuvarlanır: 0,01 TL × 1,50 = 0,015 → 0,02
    expect(grossReturnKurus(1, [1.5])).toBe(2);
  });

  it('50 TL alt sınırını uygular', () => {
    const r = calculateNormalCoupon([sel('a', 2), sel('b', 2)], TL(49.99));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('50');
    expect(calculateNormalCoupon([sel('a', 2), sel('b', 2)], TL(50)).ok).toBe(true);
  });

  it('min. maç sayısı kupondaki seçim sayısından büyükse reddeder', () => {
    expect(calculateNormalCoupon([sel('a', 2, 7, 3), sel('b', 2)], TL(100)).ok).toBe(false);
    expect(calculateNormalCoupon([sel('a', 2, 7, 2), sel('b', 2)], TL(100)).ok).toBe(true);
  });
});

describe('sistem kuponu', () => {
  it('Sistem 3,4: 4 seçimden 5 kolon üretir', () => {
    expect(binomial(4, 3) + binomial(4, 4)).toBe(5);
    expect(systemColumnCount(4, 3)).toBe(5);
    const r = calculateSystemCoupon([sel('a', 2), sel('b', 2), sel('c', 2), sel('d', 2)], 3, TL(100));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.label).toBe('Sistem 3,4');
    expect(r.value.columns).toHaveLength(5);
    expect(r.value.columns.filter((c) => c.size === 3)).toHaveLength(4);
    expect(r.value.perColumnKurus).toBe(TL(20));
    expect(r.value.stakeKurus).toBe(TL(100));
  });

  it('min. maç kuralını ihlal eden kolonları dışlar ve kolon tutarını yeniden hesaplar', () => {
    // 'd' en az 4 seçimli kolonda kullanılabilir → d içeren 3'lü kolonlar (3 adet) dışlanır.
    const r = calculateSystemCoupon([sel('a', 2), sel('b', 2), sel('c', 2), sel('d', 2, 7, 4)], 3, TL(100));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.totalColumns).toBe(5);
    expect(r.value.columns).toHaveLength(2);
    expect(r.value.excludedColumns).toHaveLength(3);
    expect(r.value.excludedColumns.every((c) => c.selectionIds.includes('d') && c.size === 3)).toBe(true);
    expect(r.value.excludedColumns[0].reason).toContain('en az 4');
    expect(r.value.perColumnKurus).toBe(TL(50));
  });

  it('tüm kolonlar dışlanırsa hata verir', () => {
    const r = calculateSystemCoupon([sel('a', 2, 7, 5), sel('b', 2, 7, 4), sel('c', 2, 7, 4)], 2, TL(100));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('geçerli kolon kalmadı');
  });

  it('kolon tutarını kuruşa aşağı yuvarlar; toplam ayrılan tutarı aşmaz', () => {
    // Sistem 2,3: 4 kolon; 100,01 TL kolonlara eşit bölünemez
    const r = calculateSystemCoupon([sel('a', 2), sel('b', 2), sel('c', 2)], 2, TL(100.01));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.columns).toHaveLength(4);
    expect(r.value.perColumnKurus).toBe(2500); // 10001 / 4 = 2500.25 → 2500
    expect(r.value.stakeKurus).toBe(10000);
    expect(r.value.unallocatedKurus).toBe(1);
    expect(r.value.stakeKurus + r.value.unallocatedKurus).toBe(r.value.allocatedKurus);

    const r2 = calculateSystemCoupon([sel('a', 2), sel('b', 2), sel('c', 2), sel('d', 2)], 3, TL(10));
    expect(r2.ok && r2.value.perColumnKurus).toBe(200);
    const r3 = calculateSystemCoupon([sel('a', 2), sel('b', 2), sel('c', 2), sel('d', 2), sel('e', 2)], 4, TL(10));
    // 6 kolon: 1000 / 6 = 166.67 → 166 kuruş, toplam 996, 4 kuruş artar
    expect(r3.ok && r3.value.perColumnKurus).toBe(166);
    expect(r3.ok && r3.value.stakeKurus).toBe(996);
  });

  it('kolon başına tutar 1 kuruşun altına düşerse reddeder; 0/negatif tutarı kabul etmez', () => {
    const four = [sel('a', 2), sel('b', 2), sel('c', 2), sel('d', 2)];
    expect(calculateSystemCoupon(four, 3, 4).ok).toBe(false);
    expect(calculateSystemCoupon(four, 3, 0).ok).toBe(false);
    expect(calculateSystemCoupon(four, 3, -100).ok).toBe(false);
  });

  it('yalnızca geçerli k/n formatlarını kabul eder', () => {
    const three = [sel('a', 2), sel('b', 2), sel('c', 2)];
    expect(calculateSystemCoupon(three, 3, TL(100)).ok).toBe(false); // k = n → normal kupon
    expect(calculateSystemCoupon(three, 1, TL(100)).ok).toBe(false);
    expect(calculateSystemCoupon(three.slice(0, 2), 1, TL(100)).ok).toBe(false);
    expect(systemLabel(2, 4)).toBe('Sistem 2,3,4');
  });

  it('senaryolarda yalnızca kazanan kolonların dönüşünü toplar', () => {
    const r = calculateSystemCoupon([sel('a', 2), sel('b', 2), sel('c', 2), sel('d', 2)], 3, TL(100));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [none, one, two] = r.value.scenarios;
    // Hiç kayıp yok: 4 × (20 × 8) + 20 × 16 = 640 + 320 = 960 TL
    expect(none.maxReturnKurus).toBe(TL(960));
    expect(none.maxWinningColumns).toBe(5);
    // Bir kayıp: yalnızca kaybedeni içermeyen tek 3'lü kolon kazanır: 160 TL
    expect(one.minReturnKurus).toBe(TL(160));
    expect(one.maxReturnKurus).toBe(TL(160));
    expect(one.maxWinningColumns).toBe(1);
    expect(two.maxReturnKurus).toBe(0);
  });
});
