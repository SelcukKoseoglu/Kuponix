import type { MatchSelection } from '../../types';

/** Test seçimi: her seçim varsayılan olarak kendi maçındadır (matchId = m-<id>). */
export function sel(id: string, odds: number, confidence = 7, minMatches = 1, extra: Partial<MatchSelection> = {}): MatchSelection {
  return { id, matchId: `m-${id}`, matchName: `Maç ${id}`, marketSelection: 'MS 1', odds, confidence, minMatches, ...extra };
}

/** Tahmini olasılığı olan test seçimi. */
export function psel(id: string, odds: number, p: number, confidence = 7, extra: Partial<MatchSelection> = {}): MatchSelection {
  return sel(id, odds, confidence, 1, { estimatedProbability: p, ...extra });
}

export const TL = (amount: number) => Math.round(amount * 100);
