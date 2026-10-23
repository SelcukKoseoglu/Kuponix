import type { MatchSelection } from '../../types';

export function sel(id: string, odds: number, confidence = 7, minMatches = 1): MatchSelection {
  return { id, matchName: `Maç ${id}`, marketSelection: 'MS 1', odds, confidence, minMatches };
}

export const TL = (amount: number) => Math.round(amount * 100);
