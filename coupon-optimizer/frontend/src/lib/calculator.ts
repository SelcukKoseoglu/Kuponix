import type { ExcludedColumn, LossScenario, MatchSelection, NormalCoupon, SystemColumn, SystemCoupon } from '../types';
import { binomial, combinations } from './combinatorics';
import { MIN_STAKE_KURUS, formatTL } from './money';
import { prepareShape, winningColumnCount, winningSums, type PreparedShape } from './payout';
import { describeSelection } from './validation';

export const MIN_SYSTEM_SELECTIONS = 2;
/**
 * Bir sistem kuponunda en fazla seçim. Kupon kuralı değil; tarayıcıda kolon listesi ve senaryo hesabını makul
 * sürede tutan teknik üst sınırdır (motorun aynı anda değerlendirdiği havuz da bu kadardır).
 */
export const MAX_SYSTEM_SELECTIONS = 16;
/** Kolon × sonuç sayısı bunu aşarsa senaryolar kolon kolon değil, kazananların oranlarından hesaplanır. */
const EXACT_SCENARIO_WORK = 4_000_000;
/** Kolon başına teknik alt sınır: 1 kuruş. Platform kuralı değildir; platform limitleri ayarlardan girilir. */
export const MIN_COLUMN_STAKE_KURUS = 1;

export type CalcResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Sistem kuponu için kullanıcı/platform kuralları (hepsi isteğe bağlı). */
export type SystemRules = {
  minSystemStakeKurus?: number;
  minColumnStakeKurus?: number | null;
  maxColumnStakeKurus?: number | null;
};

const fail = <T>(error: string): CalcResult<T> => ({ ok: false, error });

export function oddsToHundredths(odds: number): number {
  return Math.round(odds * 100);
}

/** Oranların çarpımı (yalnızca gösterim amaçlı float). */
export function combinedOdds(odds: readonly number[]): number {
  return odds.reduce((acc, o) => (acc * oddsToHundredths(o)) / 100, 1);
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

/** "Sistem 3,4" gibi etiket. */
export function systemLabel(sizes: readonly number[]): string {
  return `Sistem ${[...sizes].sort((a, b) => a - b).join(',')}`;
}

/** Bir formatın teorik kolon sayısı: Σ C(n, j), j ∈ boyutlar. */
export function formatColumnCount(n: number, sizes: readonly number[]): number {
  return sizes.reduce((sum, j) => sum + binomial(n, j), 0);
}

/**
 * Toplam tutarı kolonlara kuruş hassasiyetinde böler: herkese taban tutar, kalan kuruşlar sırayla ilk kolonlara
 * birer birer. Toplam her zaman `totalKurus`'a eşittir ve kolonlar arası fark en fazla 1 kuruştur.
 */
export function splitStake(totalKurus: number, columns: number): number[] {
  const base = Math.floor(totalKurus / columns);
  const remainder = totalKurus - base * columns;
  return Array.from({ length: columns }, (_, i) => base + (i < remainder ? 1 : 0));
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

/** Sistem formatı doğrulaması: boyutlar 1..n tam sayılar; yalnızca n'li kolon (normal kupon) sistem sayılmaz. */
export function validateSystemSizes(n: number, sizes: readonly number[]): string | null {
  if (sizes.length === 0) return 'Sistem formatı en az bir kolon boyutu içermeli.';
  if (sizes.some((j) => !Number.isInteger(j) || j < 1 || j > n)) return `Sistem kolon boyutları 1 ile ${n} arasında olmalı.`;
  if (new Set(sizes).size !== sizes.length) return 'Sistem kolon boyutları tekrar edemez.';
  if (sizes.length === 1 && sizes[0] === n) return `Yalnızca ${n}'li kolon bir normal kupondur, sistem değildir.`;
  return null;
}

/**
 * Sistem kuponu: n seçimin, formattaki her j boyutu için tüm j'li kombinasyonları (ör. Sistem 3,4).
 * Her kolon min. maç kuralına göre ayrı doğrulanır; geçersiz kolonlar plana alınmaz, nedenleriyle raporlanır ve
 * tutar geçerli kolonlara yeniden bölünür.
 */
export function calculateSystemCoupon(
  selections: readonly MatchSelection[],
  sizes: readonly number[],
  allocatedKurus: number,
  rules: SystemRules = {},
): CalcResult<SystemCoupon> {
  const n = selections.length;
  const minSystemStake = rules.minSystemStakeKurus ?? MIN_STAKE_KURUS;
  if (n < MIN_SYSTEM_SELECTIONS) return fail(`Sistem kuponu için en az ${MIN_SYSTEM_SELECTIONS} seçim gerekir.`);
  if (n > MAX_SYSTEM_SELECTIONS) {
    return fail(`Bir sistem kuponunda en fazla ${MAX_SYSTEM_SELECTIONS} seçim hesaplanabilir (teknik hesaplama sınırı).`);
  }
  const sizeError = validateSystemSizes(n, sizes);
  if (sizeError) return fail(sizeError);
  if (!Number.isInteger(allocatedKurus) || allocatedKurus <= 0) return fail("Sistem kuponu tutarı 0'dan büyük olmalı.");
  if (allocatedKurus < minSystemStake) return fail(`Sistem kuponu tutarı en az ${formatTL(minSystemStake)} olmalı.`);

  const sorted = [...sizes].sort((a, b) => a - b);
  const indices = selections.map((_, i) => i);
  const validMasks: number[] = [];
  const valid: { selectionIds: string[]; size: number; odds: number[] }[] = [];
  const excludedColumns: ExcludedColumn[] = [];

  for (const size of sorted) {
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
      valid.push({ selectionIds, size, odds: items.map((s) => s.odds) });
    }
  }

  if (valid.length === 0) return fail('Minimum maç koşulları nedeniyle bu sistem formatında geçerli kolon kalmadı.');

  const stakes = splitStake(allocatedKurus, valid.length);
  const perColumnKurus = stakes[stakes.length - 1];
  if (perColumnKurus < Math.max(MIN_COLUMN_STAKE_KURUS, rules.minColumnStakeKurus ?? 0)) {
    const min = Math.max(MIN_COLUMN_STAKE_KURUS, rules.minColumnStakeKurus ?? 0);
    return fail(`${formatTL(allocatedKurus)}, ${valid.length} kolona bölününce kolon başı ${formatTL(min)} alt sınırının altında kalıyor.`);
  }
  if (rules.maxColumnStakeKurus != null && stakes[0] > rules.maxColumnStakeKurus) {
    return fail(`Kolon başı tutar (${formatTL(stakes[0])}) kolon başı üst sınırı (${formatTL(rules.maxColumnStakeKurus)}) aşıyor.`);
  }

  const columns: SystemColumn[] = valid.map((c, i) => ({
    selectionIds: c.selectionIds,
    size: c.size,
    combinedOdds: combinedOdds(c.odds),
    stakeKurus: stakes[i],
    returnKurus: grossReturnKurus(stakes[i], c.odds),
  }));

  return {
    ok: true,
    value: {
      kind: 'system',
      selectionIds: selections.map((s) => s.id),
      selectionCount: n,
      sizes: sorted,
      label: systemLabel(sorted),
      totalColumns: formatColumnCount(n, sorted),
      columns,
      excludedColumns,
      perColumnKurus,
      stakeKurus: allocatedKurus,
      scenarios:
        columns.length * 2 ** n <= EXACT_SCENARIO_WORK
          ? lossScenarios(n, validMasks, columns.map((c) => c.returnKurus))
          : lossScenariosFromShape(
              prepareShape({ odds: selections.map((s) => s.odds), minMatches: selections.map((s) => s.minMatches), sizes: sorted }),
              allocatedKurus / columns.length,
            ),
    },
  };
}

/**
 * Kaybeden seçim sayısına göre senaryo aralıkları: hangi seçimlerin kaybettiğine bağlı olarak
 * en düşük ve en yüksek teorik dönüş. Tüm 2^n sonuç taranır; kolonlar tek tek toplanır (kuruşu kuruşuna).
 */
export function lossScenarios(n: number, columnMasks: readonly number[], columnReturns: readonly number[]): LossScenario[] {
  const scenarios = emptyScenarios(n);
  for (let lostMask = 0; lostMask < 1 << n; lostMask++) {
    let total = 0;
    let winning = 0;
    columnMasks.forEach((mask, i) => {
      if ((mask & lostMask) === 0) {
        total += columnReturns[i];
        winning++;
      }
    });
    record(scenarios[popcount(lostMask)], total, winning);
  }
  return scenarios;
}

/**
 * lossScenarios'un çok kolonlu sistemler için hali: her sonuçta kazanan kolonların toplamı kolonlar dolaşılmadan,
 * kazananların oranlarından bulunur (kolon başı ortalama tutarla; kolon kolon yuvarlamadan birkaç kuruş sapabilir).
 */
export function lossScenariosFromShape(shape: PreparedShape, stakePerColumnKurus: number): LossScenario[] {
  const n = shape.n;
  const scenarios = emptyScenarios(n);
  const out = new Float64Array(n + 1);
  const scratch = new Float64Array(n + 1);
  const all = (1 << n) - 1;
  for (let lostMask = 0; lostMask < 2 ** n; lostMask++) {
    const winners = all & ~lostMask;
    winningSums(shape, winners, out, scratch);
    let sum = 0;
    for (const j of shape.sizes) sum += out[j];
    record(scenarios[popcount(lostMask)], Math.round(sum * stakePerColumnKurus), winningColumnCount(shape, winners));
  }
  return scenarios;
}

function emptyScenarios(n: number): LossScenario[] {
  return Array.from({ length: n + 1 }, (_, losers) => ({
    losers,
    minReturnKurus: Number.POSITIVE_INFINITY,
    maxReturnKurus: 0,
    minWinningColumns: Number.POSITIVE_INFINITY,
    maxWinningColumns: 0,
  }));
}

function record(sc: LossScenario, total: number, winning: number) {
  sc.minReturnKurus = Math.min(sc.minReturnKurus, total);
  sc.maxReturnKurus = Math.max(sc.maxReturnKurus, total);
  sc.minWinningColumns = Math.min(sc.minWinningColumns, winning);
  sc.maxWinningColumns = Math.max(sc.maxWinningColumns, winning);
}

function popcount(x: number): number {
  let count = 0;
  while (x) {
    x &= x - 1;
    count++;
  }
  return count;
}
