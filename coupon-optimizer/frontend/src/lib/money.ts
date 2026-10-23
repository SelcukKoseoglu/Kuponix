/**
 * Para hesapları kuruş bazlı tam sayılarla yapılır (1 TL = 100 kuruş).
 * Float yalnızca ekranda gösterim için kullanılır.
 */
export const KURUS_PER_TL = 100;
export const MIN_NORMAL_STAKE_KURUS = 50 * KURUS_PER_TL;

/**
 * "300", "300,5", "300.50", "1.250,75" gibi girdileri kuruşa çevirir.
 * En fazla 2 ondalık basamak kabul edilir. Geçersizse null döner.
 */
export function parseMoneyToKurus(input: string): number | null {
  const raw = input.replace(/\s/g, '').replace(/₺|TL/gi, '');
  if (!raw) return null;
  const normalized =
    raw.includes(',') && raw.includes('.') ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, frac = ''] = normalized.split('.');
  const kurus = Number(whole) * KURUS_PER_TL + Number(frac.padEnd(2, '0'));
  return Number.isSafeInteger(kurus) ? kurus : null;
}

/** "2,15" veya "2.15" gibi ondalık girdileri sayıya çevirir. */
export function parseDecimalInput(input: string): number | null {
  const normalized = input.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** Yalnızca rakamlardan oluşan tam sayı girdisi. */
export function parseIntegerInput(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}

const tlFormatter = new Intl.NumberFormat('tr-TR', {
  style: 'currency',
  currency: 'TRY',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatTL(kurus: number): string {
  return tlFormatter.format(kurus / KURUS_PER_TL);
}

/** Kuruşu form alanına yazılabilecek metne çevirir: 30000 → "300", 3350 → "33,50". */
export function kurusToInput(kurus: number): string {
  if (kurus % KURUS_PER_TL === 0) return String(kurus / KURUS_PER_TL);
  return (kurus / KURUS_PER_TL).toFixed(2).replace('.', ',');
}

export function formatOdds(odds: number): string {
  return odds.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatNumber(value: number, digits = 1): string {
  return value.toLocaleString('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
