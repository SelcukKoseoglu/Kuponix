import { describe, expect, it } from 'vitest';
import { analyze } from '../analyze';
import { DEFAULT_SETTINGS, ENGINE_CONFIG } from '../config';
import { computeExposures } from '../exposure';
import { MIN_STAKE_KURUS } from '../../lib/money';
import type { AnalysisSettings, MatchSelection } from '../../types';
import { psel, sel, TL } from '../../lib/__tests__/fixtures';
import type { AnalysisResult, PortfolioEvaluation } from '../types';

/** Kullanıcı tahminleri pozitif değerli 6 maç (her biri ayrı maç). */
const good: MatchSelection[] = [
  psel('a', 2.15, 0.55, 7),
  psel('b', 1.65, 0.66, 8),
  psel('c', 1.9, 0.56, 6),
  psel('d', 2.4, 0.44, 5),
  psel('e', 1.45, 0.72, 9),
  psel('f', 2.05, 0.5, 6),
];

const run = (selections: MatchSelection[], budget = TL(300), settings: Partial<AnalysisSettings> = {}) =>
  analyze({ selections, joints: [], budgetKurus: budget, settings: { ...DEFAULT_SETTINGS, ...settings } });

const evaluations = (r: AnalysisResult): PortfolioEvaluation[] =>
  r.strategies.flatMap((s) => [s.portfolio, ...s.alternatives.map((a) => a.evaluation)]).filter((e): e is PortfolioEvaluation => !!e);

describe('Portfolio Optimizer', () => {
  const result = run(good);

  it('20/22. toplam bütçe aşılmaz; normal ve sistem tutarları birlikte kontrol edilir', () => {
    for (const e of evaluations(result)) {
      const total = e.plan.parts.reduce((s, p) => s + p.stakeKurus, 0);
      expect(total).toBe(e.plan.totalStakeKurus);
      expect(total).toBeLessThan(TL(300)); // bütçenin tamamı hiçbir zaman riske atılmaz
      expect(e.metrics.remainingKurus).toBe(TL(300) - total);
    }
  });

  it('21. normal kupon ≥ 50 TL; sistem kolon tutarları toplam sistem tutarıyla tutarlı', () => {
    for (const e of evaluations(result)) {
      for (const p of e.plan.parts) {
        if (p.kind === 'normal') expect(p.stakeKurus).toBeGreaterThanOrEqual(MIN_STAKE_KURUS);
        else expect(p.columns.reduce((s, c) => s + c.stakeKurus, 0)).toBe(p.stakeKurus);
      }
    }
  });

  it('23. seçim/maç maruziyet sınırları uygulanır (kullanıcı ayarı)', () => {
    const r = run(good, TL(300), { maxSelectionExposurePct: 20, maxMatchExposurePct: 20 });
    for (const e of evaluations(r)) {
      expect(e.maxSelectionExposurePct).toBeLessThanOrEqual(20 + 1e-6);
      expect(e.maxMatchExposurePct).toBeLessThanOrEqual(20 + 1e-6);
    }
    for (const s of r.strategies) expect(s.limits.maxSelectionExposurePct).toBe(20);
  });

  it('24. aynı portföy tekrarları tekilleştirilir', () => {
    for (const s of result.strategies) {
      const ids = s.alternatives.filter((a) => a.evaluation).map((a) => a.evaluation!.plan.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('25. Kontrollü, Dengeli ve Agresif farklı hedef/modellerle çalışır', () => {
    const [cautious, balanced, aggressive] = result.strategies;
    expect(cautious.model).toEqual({ gamma: 2, probability: 'low', dependence: 'comonotonic' });
    expect(balanced.model.gamma).toBe(2);
    expect(aggressive.model.gamma).toBe(1);
    const stake = (s: typeof cautious) => s.portfolio?.metrics.stakeKurus ?? 0;
    expect(stake(aggressive)).toBeGreaterThanOrEqual(stake(balanced));
    expect(stake(balanced)).toBeGreaterThanOrEqual(stake(cautious));
    expect(cautious.limits.maxStakeKurus).toBeLessThanOrEqual(aggressive.limits.maxStakeKurus);
  });

  it('26. geçerli aday yoksa "kupon oluşturmama" önerilir (negatif EV)', () => {
    const bad = [psel('a', 1.5, 0.5), psel('b', 1.8, 0.45), psel('c', 2.2, 0.35), psel('d', 1.3, 0.6)];
    const r = run(bad);
    for (const s of r.strategies) {
      expect(s.recommendation).toBe('none');
      expect(s.portfolio).toBeNull();
      expect(s.alternatives.some((a) => a.kind === 'none')).toBe(true);
      expect(s.explanations.join(' ')).toContain('Kupon oluşturmama');
    }
  });

  it('27. sistem, normal kupona göre avantajlı değilse önerilmez', () => {
    // Tek bir güçlü seçim + değeri negatif seçimler: sistem kolonları ancak kötü seçimleri içerebilir.
    const r = run([psel('a', 2.2, 0.62), psel('b', 1.4, 0.6), psel('c', 1.5, 0.55), psel('d', 1.6, 0.5)]);
    for (const s of r.strategies) {
      const hasSystem = !!s.portfolio?.plan.parts.some((p) => p.kind === 'system');
      expect(s.systemDecision.recommended).toBe(hasSystem);
      if (!hasSystem) expect(s.systemDecision.reasons.join(' ')).toMatch(/önerilmedi|bulunamadı|pozitif değil/);
    }
    const off = run(good, TL(300), { allowSystem: false });
    for (const s of off.strategies) {
      expect(s.portfolio?.plan.parts.every((p) => p.kind === 'normal') ?? true).toBe(true);
      expect(s.systemDecision.reasons[0]).toContain('kapalı');
      expect(s.alternatives.some((a) => a.kind === 'system')).toBe(false);
    }
  });

  it('en fazla kayıp sınırı toplam tutarı sınırlar', () => {
    const r = run(good, TL(300), { maxLossKurus: TL(60) });
    for (const e of evaluations(r)) expect(-e.metrics.worstNetKurus).toBeLessThanOrEqual(TL(60));
  });

  it('tahmini olasılık yoksa öneri ve olasılık tabanlı simülasyon yapılmaz', () => {
    const r = run([sel('a', 2), sel('b', 1.8), sel('c', 1.6)]);
    expect(r.summary.withProbability).toBe(0);
    for (const s of r.strategies) {
      expect(s.recommendation).toBe('none');
      expect(s.explanations[0]).toContain('Tahmini olasılık girilmediği');
    }
  });

  it('aynı maçtaki seçimler aynı kupona konmaz ve bağımsızlık varsayımı uyarısı verilir', () => {
    const sameMatch = [...good, psel('a2', 1.9, 0.56, 6, { matchId: 'm-a', matchName: 'Maç a' })];
    const r = run(sameMatch);
    expect(r.summary.warnings.join(' ')).toContain('bağımsızlık VARSAYIMIYLA');
    for (const e of evaluations(r)) {
      for (const p of e.plan.parts) expect(p.selectionIds.includes('a') && p.selectionIds.includes('a2')).toBe(false);
    }
  });

  it('35. simülasyon sayısı, tohum ve varsayımlar sonuçta belirtilir; büyük havuzda Monte Carlo kullanılır', () => {
    const many = Array.from({ length: 15 }, (_, i) => psel(`s${i}`, 1.6 + (i % 4) * 0.15, 0.62 - (i % 4) * 0.04, 7));
    const r = run(many, TL(300), { simulationCount: 5000, seed: 99 });
    const portfolio = r.strategies.find((s) => s.portfolio)?.portfolio;
    expect(portfolio?.metrics.method).toEqual({ kind: 'monte-carlo', simulations: 5000, seed: 100 });
    expect(r.assumptions.join(' ')).toContain('5.000 simülasyon');
    expect(r.strategies.every((s) => s.approximate)).toBe(true);
    // Aynı girdi + aynı tohum → aynı sonuç.
    const again = run(many, TL(300), { simulationCount: 5000, seed: 99 });
    expect(again.strategies.map((s) => s.portfolio?.plan.id ?? null)).toEqual(r.strategies.map((s) => s.portfolio?.plan.id ?? null));
  });

  it('teknik havuz sınırı aşılınca kullanıcı uyarılır', () => {
    const many = Array.from({ length: ENGINE_CONFIG.maxPoolSize + 4 }, (_, i) => psel(`s${i}`, 1.8, 0.58, 6));
    const r = run(many);
    expect(r.summary.usedInPool).toBe(ENGINE_CONFIG.maxPoolSize);
    expect(r.summary.warnings.join(' ')).toContain('Teknik hesaplama sınırı');
  });

  it('portföy maruziyetleri yeniden hesaplandığında aynı çıkar', () => {
    const p = result.strategies.find((s) => s.portfolio)!.portfolio!;
    const again = computeExposures(p.plan, new Map(good.map((s) => [s.id, s])), TL(300));
    expect(again.selections[0].exposedStakeKurus).toBe(p.exposures.selections[0].exposedStakeKurus);
  });
});
