import type { ExcludedColumn, LossScenario, MatchSelection, NormalCoupon, SystemColumn, SystemCoupon } from '../types';
import { combinations, systemColumnCount } from './combinatorics';
import { MIN_NORMAL_STAKE_KURUS, formatTL } from './money';
import { describeSelection } from './validation';

export const MIN_SYSTEM_SELECTIONS = 3;
/** Sistem kuponunda en fazla bu kadar seçim (Sistem 2..8 = 247 kolon). */
export const MAX_SYSTEM_SELECTIONS = 8;
/** Kolon başına en düşük tutar: 1 kuruş. Platform kuralları ayrıca kontrol edilmelidir. */
export const MIN_COLUMN_STAKE_KURUS = 1;

export type CalcResult<T> = { ok: true; value: T } | { ok: false; error: string };

const fail = <T>(error: string): CalcResult<T> => ({ ok: false, error });

export function oddsToHundredths(odds: number): number {
  return Math.round(odds * 100);
}

/** Oranların çarpımı (yalnızca gösterim amaçlı float). */
export function combinedOdds(odds: readonly number[]): number {
  return odds.reduce((acc, o) => acc * oddsToHundredths(o) / 100, 1);
}

/**
 * Teorik brüt dönüş (kuruş) = tutar × oranların çarpımı.
 * Oranlar yüzde birlik tam sayılara çevrilip BigInt ile kesin çarpılır, sonuç kuruşa yarım-yukarı yuvarlanır.
 */
export function grossReturnKurus(stakeKurus: number, odds: readonly number[]): number {
  const numerator = odds.reduce((acc, o) => acc * BigInt(oddsToHundredths(o)), BigInt(stakeKurus));
  const denominator = BigInt(100) ** BigInt(odds.length);
  return Number((numerator * BigInt(2) + denominator) / (BigInt(2) * denominator));
}

export function systemLabel(minSize: number, n: number): string {
  const sizes: number[] = [];
  for (let j = minSize; j <= n; j++) sizes.push(j);
  return `Sistem ${sizes.join(',')}`;
}

/** Normal kupon: tüm seçimler tek kombine kuponda. */
export function calculateNormalCoupon(selections: readonly MatchSelection[], stakeKurus: number): CalcResult<NormalCoupon> {
  const n = selections.length;
  if (n === 0) return fail('Normal kupon için en az bir seçim gerekir.');
  if (!Number.isInteger(stakeKurus) || stakeKurus < MIN_NORMAL_STAKE_KURUS) {
    return fail(`Normal kupon tutarı en az ${formatTL(MIN_NORMAL_STAKE_KURUS)} olmalı.`);
  }
  const blockers = selections.filter((s) => s.minMatches > n);
  if (blockers.length > 0) {
    const names = blockers.map((s) => `${describeSelection(s)} (min. ${s.minMatches})`).join(', ');
    return fail(`${names} seçimi ${n} seçimli bir normal kuponda kullanılamaz.`);
  }
  const odds = selections.map((s) => s.odds);
  return {
    ok: true,
    value: {
      kind: 'normal',
      selectionIds: selections.map((s) => s.id),
      selectionCount: n,
      stakeKurus,
      combinedOdds: combinedOdds(odds),
      grossReturnKurus: grossReturnKurus(stakeKurus, odds),
    },
  };
}

/**
 * Sistem kuponu "Sistem k..n": n seçimin k'lı, (k+1)'li, …, n'li tüm kombinasyonları.
 * Her kolon min. maç kuralına göre ayrı doğrulanır; geçersiz kolonlar plana alınmaz ve
 * ayrılan tutar geçerli kolonlara bölünür (kuruşa aşağı yuvarlanır, artan kuruş "kullanılmayan" olarak döner).
 */
export function calculateSystemCoupon(
  selections: readonly MatchSelection[],
  minSize: number,
  allocatedKurus: number,
): CalcResult<SystemCoupon> {
  const n = selections.length;
  if (n < MIN_SYSTEM_SELECTIONS) return fail(`Sistem kuponu için en az ${MIN_SYSTEM_SELECTIONS} seçim gerekir.`);
  if (n > MAX_SYSTEM_SELECTIONS) return fail(`Sistem kuponunda en fazla ${MAX_SYSTEM_SELECTIONS} seçim kullanılabilir.`);
  if (!Number.isInteger(minSize) || minSize < 2 || minSize >= n) {
    return fail(`Geçersiz sistem formatı: ${n} seçim için en küçük kombinasyon 2 ile ${n - 1} arasında olmalı.`);
  }
  if (!Number.isInteger(allocatedKurus) || allocatedKurus <= 0) return fail("Sistem kuponu tutarı 0'dan büyük olmalı.");

  const indices = selections.map((_, i) => i);
  const validMasks: number[] = [];
  const columns: SystemColumn[] = [];
  const excludedColumns: ExcludedColumn[] = [];

  for (let size = minSize; size <= n; size++) {
    for (const combo of combinations(indices, size)) {
      const items = combo.map((i) => selections[i]);
      const blockers = items.filter((s) => s.minMatches > size);
      const selectionIds = items.map((s) => s.id);
      if (blockers.length > 0) {
        const names = blockers.map((s) => `${describeSelection(s)} en az ${s.minMatches} seçimli kolon ister`).join('; ');
        excludedColumns.push({ selectionIds, size, reason: `${size}'li kolon: ${names}.` });
        continue;
      }
      validMasks.push(combo.reduce((mask, i) => mask | (1 << i), 0));
      columns.push({ selectionIds, size, combinedOdds: combinedOdds(items.map((s) => s.odds)), returnKurus: 0 });
    }
  }

  if (columns.length === 0) return fail('Minimum maç koşulları nedeniyle bu sistemde geçerli kolon kalmadı.');

  const perColumnKurus = Math.floor(allocatedKurus / columns.length);
  if (perColumnKurus < MIN_COLUMN_STAKE_KURUS) {
    return fail(
      `${formatTL(allocatedKurus)}, ${columns.length} kolona bölünemeyecek kadar küçük (kolon başına en az ${formatTL(MIN_COLUMN_STAKE_KURUS)}).`,
    );
  }

  const columnOdds = columns.map((c) => c.selectionIds.map((id) => selections.find((s) => s.id === id)!.odds));
  columns.forEach((c, i) => {
    c.returnKurus = grossReturnKurus(perColumnKurus, columnOdds[i]);
  });

  const stakeKurus = perColumnKurus * columns.length;
  return {
    ok: true,
    value: {
      kind: 'system',
      selectionIds: selections.map((s) => s.id),
      selectionCount: n,
      minSize,
      label: systemLabel(minSize, n),
      totalColumns: systemColumnCount(n, minSize),
      columns,
      excludedColumns,
      allocatedKurus,
      perColumnKurus,
      stakeKurus,
      unallocatedKurus: allocatedKurus - stakeKurus,
      scenarios: lossScenarios(n, validMasks, columns.map((c) => c.returnKurus)),
    },
  };
}

/**
 * Kaybeden seçim sayısına göre senaryo aralıkları: hangi seçimlerin kaybettiğine bağlı olarak
 * en düşük ve en yüksek teorik dönüş. Tüm 2^n sonuç taranır (n ≤ 8).
 */
export function lossScenarios(n: number, columnMasks: readonly number[], columnReturns: readonly number[]): LossScenario[] {
  const scenarios: LossScenario[] = Array.from({ length: n + 1 }, (_, losers) => ({
    losers,
    minReturnKurus: Number.POSITIVE_INFINITY,
    maxReturnKurus: 0,
    minWinningColumns: Number.POSITIVE_INFINITY,
    maxWinningColumns: 0,
  }));
  for (let lostMask = 0; lostMask < 1 << n; lostMask++) {
    let total = 0;
    let winning = 0;
    columnMasks.forEach((mask, i) => {
      if ((mask & lostMask) === 0) {
        total += columnReturns[i];
        winning++;
      }
    });
    const sc = scenarios[popcount(lostMask)];
    sc.minReturnKurus = Math.min(sc.minReturnKurus, total);
    sc.maxReturnKurus = Math.max(sc.maxReturnKurus, total);
    sc.minWinningColumns = Math.min(sc.minWinningColumns, winning);
    sc.maxWinningColumns = Math.max(sc.maxWinningColumns, winning);
  }
  return scenarios;
}

function popcount(x: number): number {
  let count = 0;
  while (x) {
    x &= x - 1;
    count++;
  }
  return count;
}
