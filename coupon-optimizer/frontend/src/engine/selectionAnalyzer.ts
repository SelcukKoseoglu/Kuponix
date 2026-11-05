/**
 * Selection Analyzer — tekil seçim analizi.
 * Güven puanı olasılığa çevrilmez; yalnızca kullanıcının tahmini olasılığı etrafındaki stres aralığını belirler.
 * Tahmini olasılık yoksa EV/Edge/Kelly hesaplanmaz (null) ve ima edilen olasılık onun yerine kullanılmaz.
 */
import type { MatchSelection } from '../types';
import { ENGINE_CONFIG, uncertaintyHalfWidth, type ProbabilityLevel } from './config';
import type { SelectionAnalysis } from './types';

export const impliedProbability = (odds: number) => 1 / odds;

export const expectedValue = (p: number, odds: number) => p * odds - 1;

/** Tam Kelly oranı: (b·p − q)/b = (p·o − 1)/(o − 1). */
export function kellyFraction(p: number, odds: number): number {
  const b = odds - 1;
  return (b * p - (1 - p)) / b;
}

const clampProbability = (p: number) =>
  Math.min(ENGINE_CONFIG.uncertainty.maxProbability, Math.max(ENGINE_CONFIG.uncertainty.minProbability, p));

/** Güven puanına göre stres aralığı: p ± yarı genişlik (sınırlanmış). Kalibre edilmiş bir güven aralığı değildir. */
export function probabilityRange(p: number, confidence: number): { low: number; base: number; high: number } {
  const hw = uncertaintyHalfWidth(confidence);
  return { low: clampProbability(p - hw), base: p, high: clampProbability(p + hw) };
}

export function analyzeSelection(s: MatchSelection): SelectionAnalysis {
  const implied = impliedProbability(s.odds);
  const hw = uncertaintyHalfWidth(s.confidence);
  const p = s.estimatedProbability;
  if (p === undefined || p === null) {
    return {
      id: s.id,
      matchId: s.matchId,
      impliedProbability: implied,
      estimatedProbability: null,
      edge: null,
      ev: null,
      probabilityRange: null,
      evLow: null,
      evHigh: null,
      kellyFraction: null,
      referenceKelly: null,
      kellyStatus: 'unavailable',
      uncertaintyHalfWidth: hw,
    };
  }
  const range = probabilityRange(p, s.confidence);
  const kelly = kellyFraction(p, s.odds);
  return {
    id: s.id,
    matchId: s.matchId,
    impliedProbability: implied,
    estimatedProbability: p,
    edge: p - implied,
    ev: expectedValue(p, s.odds),
    probabilityRange: range,
    evLow: expectedValue(range.low, s.odds),
    evHigh: expectedValue(range.high, s.odds),
    kellyFraction: kelly,
    referenceKelly: kelly > 0 ? kelly * ENGINE_CONFIG.kellyReferenceFraction : null,
    kellyStatus: kelly > 0 ? 'positive' : 'non-positive',
    uncertaintyHalfWidth: hw,
  };
}

/** Stratejinin kullandığı olasılık düzeyi (tahmini olasılık yoksa null). */
export function probabilityAt(analysis: SelectionAnalysis, level: ProbabilityLevel): number | null {
  if (!analysis.probabilityRange) return null;
  return analysis.probabilityRange[level];
}
