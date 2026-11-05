/** Arayüz biçimlendirme yardımcıları. Hesaplanamayan değerler sıfır yerine açık bir etiketle gösterilir. */
import { formatTL } from './money';

export const NOT_AVAILABLE = 'Hesaplanamadı';
export const NEEDS_ESTIMATE = 'Tahmin gerekli';

/** Olasılık (0..1) → "%55,2". */
export function formatPct(p: number | null | undefined, digits = 1): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return NOT_AVAILABLE;
  return `%${(p * 100).toLocaleString('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** Olasılık farkı → "+8,49 puan". */
export function formatPoints(diff: number | null | undefined): string {
  if (diff === null || diff === undefined || !Number.isFinite(diff)) return NEEDS_ESTIMATE;
  const v = diff * 100;
  return `${v > 0 ? '+' : ''}${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} puan`;
}

/** Birim başına getiri → "+%18,25". */
export function formatReturn(r: number | null | undefined): string {
  if (r === null || r === undefined || !Number.isFinite(r)) return NEEDS_ESTIMATE;
  const v = r * 100;
  return `${v > 0 ? '+' : ''}%${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatSignedTL(kurus: number | null | undefined): string {
  if (kurus === null || kurus === undefined || !Number.isFinite(kurus)) return NOT_AVAILABLE;
  return `${kurus > 0 ? '+' : ''}${formatTL(kurus)}`;
}

export function formatTLOrNA(kurus: number | null | undefined): string {
  if (kurus === null || kurus === undefined || !Number.isFinite(kurus)) return NOT_AVAILABLE;
  return formatTL(kurus);
}

export const toneOf = (kurus: number | null | undefined): 'positive' | 'negative' | 'default' =>
  kurus === null || kurus === undefined ? 'default' : kurus > 0 ? 'positive' : kurus < 0 ? 'negative' : 'default';
