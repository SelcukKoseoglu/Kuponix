/**
 * Strateji faydası (CRRA). Servet oranı w = (bütçe − yatırılan + brüt dönüş) / bütçe.
 *  γ = 1: u(w) = ln w  → beklenen log servet büyümesi (tam Kelly).
 *  γ ≠ 1: u(w) = (w^(1−γ) − 1) / (1−γ).
 * Bütçenin tamamı yatırılır ve her şey kaybedilirse w = 0 → u = −∞; bu yüzden hiçbir strateji bütçenin tamamını
 * kaybetme riskini kabul etmez. Skor, faydanın kesinlik eşdeğeri net getirisidir (TL karşılığı, "optimizasyon skoru").
 */
export function utility(w: number, gamma: number): number {
  if (w <= 0) return Number.NEGATIVE_INFINITY;
  return gamma === 1 ? Math.log(w) : (w ** (1 - gamma) - 1) / (1 - gamma);
}

export function inverseUtility(u: number, gamma: number): number {
  if (u === Number.NEGATIVE_INFINITY) return 0;
  return gamma === 1 ? Math.exp(u) : Math.max(0, (1 - gamma) * u + 1) ** (1 / (1 - gamma));
}

export function expectedUtility(gross: Float64Array, weights: Float64Array, stakeKurus: number, budgetKurus: number, gamma: number): number {
  let eu = 0;
  const base = (budgetKurus - stakeKurus) / budgetKurus;
  for (let i = 0; i < gross.length; i++) {
    if (weights[i] <= 0) continue;
    eu += weights[i] * utility(base + gross[i] / budgetKurus, gamma);
  }
  return eu;
}

/** Kesinlik eşdeğeri net getiri (kuruş): stratejinin risk tutumuna göre bu portföyün "garantili" karşılığı. */
export function certaintyEquivalentKurus(expected: number, budgetKurus: number, gamma: number): number {
  return budgetKurus * (inverseUtility(expected, gamma) - 1);
}
