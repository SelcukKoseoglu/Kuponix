/**
 * Risk metrikleri. İşaret konvansiyonu: net = brüt dönüş − yatırılan; negatif net = kayıp.
 * P5: net sonucun 5. yüzdelik dilimi. Expected Shortfall (%5): en kötü %5'lik olasılık kütlesindeki ortalama net
 * sonuç (yine negatif = kayıp). Ağırlıklar senaryo olasılıklarıdır (Monte Carlo'da eşit).
 */
import { ENGINE_CONFIG } from './config';
import type { HistogramBin, RiskMetrics, ScenarioMethod } from './types';

/** Ağırlıklı alt kuyruk: en kötü `level` olasılık kütlesindeki ortalama ve sınır değeri (quantile). */
export function weightedTail(values: Float64Array, weights: Float64Array, level: number): { quantile: number; shortfall: number } {
  const order = Array.from(values.keys()).sort((a, b) => values[a] - values[b]);
  let mass = 0;
  let sum = 0;
  let quantile = values[order[0]];
  let quantileFound = false;
  for (const i of order) {
    const w = weights[i];
    if (w <= 0) continue;
    if (!quantileFound && mass + w >= level - 1e-12) {
      quantile = values[i];
      quantileFound = true;
    }
    const take = Math.min(w, level - mass);
    if (take > 0) {
      sum += take * values[i];
      mass += take;
    }
    if (mass >= level - 1e-12 && quantileFound) break;
  }
  return { quantile, shortfall: mass > 0 ? sum / mass : 0 };
}

function histogram(values: Float64Array, weights: Float64Array, bins: number): HistogramBin[] {
  let min = Infinity;
  let max = -Infinity;
  values.forEach((v, i) => {
    if (weights[i] <= 0) return;
    min = Math.min(min, v);
    max = Math.max(max, v);
  });
  if (!Number.isFinite(min)) return [];
  if (max - min < 1) return [{ fromKurus: Math.round(min), toKurus: Math.round(max), probability: 1 }];
  const width = (max - min) / bins;
  const result: HistogramBin[] = Array.from({ length: bins }, (_, b) => ({
    fromKurus: Math.round(min + b * width),
    toKurus: Math.round(min + (b + 1) * width),
    probability: 0,
  }));
  values.forEach((v, i) => {
    const b = Math.min(bins - 1, Math.floor((v - min) / width));
    result[b].probability += weights[i];
  });
  return result;
}

/** Senaryo başına brüt dönüşlerden (kuruş) risk metriklerini çıkarır. */
export function computeRiskMetrics(
  gross: Float64Array,
  weights: Float64Array,
  stakeKurus: number,
  budgetKurus: number,
  method: ScenarioMethod,
): RiskMetrics {
  const n = gross.length;
  const net = new Float64Array(n);
  let expectedGross = 0;
  let expectedNet = 0;
  let second = 0;
  let probPositive = 0;
  let probNegative = 0;
  let probTotalLoss = 0;
  let maxNet = -Infinity;
  let worstNet = Infinity;
  let lossMass = 0;
  let lossSum = 0;
  for (let i = 0; i < n; i++) {
    const w = weights[i];
    net[i] = gross[i] - stakeKurus;
    if (w <= 0) continue;
    expectedGross += w * gross[i];
    expectedNet += w * net[i];
    second += w * net[i] * net[i];
    if (net[i] > 0.5) probPositive += w;
    if (net[i] < -0.5) {
      probNegative += w;
      lossMass += w;
      lossSum += w * net[i];
    }
    if (stakeKurus > 0 && gross[i] < 0.5) probTotalLoss += w;
    maxNet = Math.max(maxNet, net[i]);
    worstNet = Math.min(worstNet, net[i]);
  }
  const tail = stakeKurus > 0 ? weightedTail(net, weights, ENGINE_CONFIG.tailLevel) : { quantile: 0, shortfall: 0 };
  const variance = Math.max(0, second - expectedNet * expectedNet);
  return {
    stakeKurus,
    remainingKurus: budgetKurus - stakeKurus,
    budgetUsePct: budgetKurus > 0 ? (stakeKurus / budgetKurus) * 100 : 0,
    expectedGrossKurus: Math.round(expectedGross),
    expectedNetKurus: Math.round(expectedNet),
    expectedNetStdErrorKurus: method.kind === 'monte-carlo' ? Math.round(Math.sqrt(variance / method.simulations)) : null,
    probPositive,
    probNegative,
    probTotalLoss,
    maxNetKurus: Math.round(Number.isFinite(maxNet) ? maxNet : 0),
    worstNetKurus: Math.round(Number.isFinite(worstNet) ? worstNet : 0),
    p5NetKurus: Math.round(tail.quantile),
    expectedShortfall5Kurus: Math.round(tail.shortfall),
    averageLossKurus: lossMass > 0 ? Math.round(lossSum / lossMass) : null,
    histogram: stakeKurus > 0 ? histogram(net, weights, ENGINE_CONFIG.histogramBins) : [],
    method,
  };
}

/** "Kupon oluşturmama" alternatifi: hiçbir yatırım yok, her senaryoda net sonuç 0. */
export function noBetMetrics(budgetKurus: number): RiskMetrics {
  return computeRiskMetrics(new Float64Array([0]), new Float64Array([1]), 0, budgetKurus, { kind: 'exact', scenarios: 1 });
}
