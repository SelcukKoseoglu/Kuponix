import type { ExcludedColumn, LossScenario, MatchSelection, NormalCoupon, SystemColumn, SystemCoupon } from '../types';
import { combinations, systemColumnCount } from './combinatorics';
import { MIN_STAKE_KURUS, formatTL } from './money';
import { prepareShape, winningColumnCount, winningSums, type PreparedShape } from './payout';
import { describeSelection } from './validation';

export const MIN_SYSTEM_SELECTIONS = 3;
/**
 * Bir sistem kuponunda en fazla seçim: aynı anda değerlendirilen maç sayısı kadar (öneri havuzu 16 maç).
 * Bu bir kupon kuralı değil, tarayıcıda hesaplama süresini makul tutan teknik üst sınırdır.
 */
export const MAX_SYSTEM_SELECTIONS = 16;
/** Kolon × sonuç sayısı bunu aşarsa senaryolar kolon kolon değil, kazananların oranlarından hesaplanır. */
const EXACT_SCENARIO_WORK = 4_000_000;
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
  if (!Number.isInteger(stakeKurus) || stakeKurus < MIN_STAKE_KURUS) {
    return fail(`Normal kupon tutarı en az ${formatTL(MIN_STAKE_KURUS)} olmalı.`);
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
  if (!Number.isInteger(allocatedKurus) || allocatedKurus < MIN_STAKE_KURUS) {
    return fail(`Sistem kuponu tutarı en az ${formatTL(MIN_STAKE_KURUS)} olmalı.`);
  }

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
  if (stakeKurus < MIN_STAKE_KURUS) {
    return fail(
      `Sistem kuponunda oynanan tutar en az ${formatTL(MIN_STAKE_KURUS)} olmalı; ${columns.length} kolon × ${formatTL(perColumnKurus)} = ${formatTL(stakeKurus)}. Tutarı biraz artırın.`,
    );
  }
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
      scenarios:
        columns.length * 2 ** n <= EXACT_SCENARIO_WORK
          ? lossScenarios(n, validMasks, columns.map((c) => c.returnKurus))
          : lossScenariosFromShape(
              prepareShape({ odds: selections.map((s) => s.odds), minMatches: selections.map((s) => s.minMatches), minSize }),
              perColumnKurus,
            ),
    },
  };
}

/**
 * Kaybeden seçim sayısına göre senaryo aralıkları: hangi seçimlerin kaybettiğine bağlı olarak
 * en düşük ve en yüksek teorik dönüş. Tüm 2^n sonuç taranır; kolonlar tek tek toplanır (kuruşu kuruşuna).
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

/**
 * lossScenarios'un çok kolonlu sistemler için hali: her sonuçta kazanan kolonların toplamı kolonlar dolaşılmadan,
 * kazananların oranlarından bulunur. Toplam kuruşa yuvarlanır (kolon kolon yuvarlamadan birkaç kuruş sapabilir).
 */
export function lossScenariosFromShape(shape: PreparedShape, perColumnKurus: number): LossScenario[] {
  const n = shape.n;
  const scenarios: LossScenario[] = Array.from({ length: n + 1 }, (_, losers) => ({
    losers,
    minReturnKurus: Number.POSITIVE_INFINITY,
    maxReturnKurus: 0,
    minWinningColumns: Number.POSITIVE_INFINITY,
    maxWinningColumns: 0,
  }));
  const out = new Float64Array(n + 1);
  const scratch = new Float64Array(n + 1);
  const all = n >= 31 ? -1 : (1 << n) - 1;
  for (let lostMask = 0; lostMask < 2 ** n; lostMask++) {
    const winners = all & ~lostMask;
    winningSums(shape, winners, out, scratch);
    let sum = 0;
    for (let j = shape.minSize; j <= n; j++) sum += out[j];
    const total = Math.round(sum * perColumnKurus);
    const winning = winningColumnCount(shape, winners);
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
