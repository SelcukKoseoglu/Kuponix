/**
 * System Betting Decision Engine — sistem kuponu bu bütçe ve tahminlerle anlamlı bir avantaj sağlıyor mu?
 * Bütün gerekçeler hesaplanan metriklerden üretilir. Sistem "daha çok kombinasyon kapsadığı" için tercih edilmez.
 */
import { formatTL } from '../lib/money';
import { ENGINE_CONFIG } from './config';
import type { Alternative, PortfolioEvaluation, RiskMetrics, SelectionAnalysis, SystemDecision, SystemFormatRow } from './types';

const pct = (x: number) => `%${(x * 100).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}`;
const signedTL = (k: number) => `${k > 0 ? '+' : ''}${formatTL(k)}`;

/** Şeffaf sistem verimlilik skoru (ağırlıklar merkezi yapılandırmada); kazanma olasılığı değildir. */
export function systemEfficiencyScore(metrics: RiskMetrics, stress: RiskMetrics, perColumnKurus: number, maxSelectionExposurePct: number) {
  const w = ENGINE_CONFIG.systemEfficiencyWeights;
  const S = Math.max(1, metrics.stakeKurus);
  return (
    w.expectedReturn * (metrics.expectedNetKurus / S) +
    w.expectedShortfall * (metrics.expectedShortfall5Kurus / S) -
    w.totalLoss * metrics.probTotalLoss +
    w.columnStake * Math.min(1, perColumnKurus / ENGINE_CONFIG.systemDecision.meaningfulColumnStakeKurus) -
    w.concentration * (maxSelectionExposurePct / 100) -
    w.uncertainty * (Math.max(0, metrics.expectedNetKurus - stress.expectedNetKurus) / S)
  );
}

export type DecisionInput = {
  allowSystem: boolean;
  poolAnalyses: SelectionAnalysis[];
  chosen: PortfolioEvaluation | null;
  normalAlt: Alternative | undefined;
  systemAlt: Alternative | undefined;
  /** Sistem içeren ve içermeyen en iyi portföylerin aynı senaryolardaki brüt dönüşleri (kolon kurtarma analizi). */
  systemSavesProbability: number | null;
  formats: SystemFormatRow[];
};

export function decideSystem(input: DecisionInput): SystemDecision {
  const reasons: string[] = [];
  const chosenHasSystem = !!input.chosen?.plan.parts.some((p) => p.kind === 'system');

  if (input.poolAnalyses.length === 0) {
    return { recommended: false, reasons: ['Tahmini olasılık girilmediği için sistem kuponu olasılık tabanlı olarak değerlendirilemedi.'], comparison: null, formats: [] };
  }
  if (!input.allowSystem) {
    return { recommended: false, reasons: ['Sistem kuponu ayarlardan kapalı.'], comparison: null, formats: [] };
  }
  const positive = input.poolAnalyses.filter((a) => (a.ev ?? 0) > 0);
  if (positive.length === 0) reasons.push('Hiçbir seçimin tahmini EV değeri pozitif değil; bu durumda sistem kuponu da avantaj sağlayamaz.');
  else if (positive.every((a) => (a.evLow ?? 0) <= 0)) {
    reasons.push("Pozitif EV'li seçimlerin avantajı, güven puanına göre karamsar tahminde (alt sınır) kayboluyor.");
  }

  const sys = input.systemAlt?.evaluation ?? null;
  const normal = input.normalAlt?.evaluation ?? null;
  if (!sys) reasons.push(input.systemAlt?.unavailableReason ?? 'Bütçe ve kısıtlar içinde fayda sağlayan bir sistem kuponu bulunamadı.');

  const reference = chosenHasSystem ? input.chosen! : sys;
  let comparison: SystemDecision['comparison'] = null;
  if (reference && normal) {
    const m = reference.metrics;
    const n = normal.metrics;
    comparison = {
      systemSavesProbability: input.systemSavesProbability ?? 0,
      expectedNetDiffKurus: m.expectedNetKurus - n.expectedNetKurus,
      totalLossDiff: m.probTotalLoss - n.probTotalLoss,
      p5DiffKurus: m.p5NetKurus - n.p5NetKurus,
      expectedShortfallDiffKurus: m.expectedShortfall5Kurus - n.expectedShortfall5Kurus,
      maxExposureDiffPct: reference.maxSelectionExposurePct - normal.maxSelectionExposurePct,
      stressExpectedNetDiffKurus: reference.stress.expectedNetKurus - normal.stress.expectedNetKurus,
    };
  }

  if (reference) {
    for (const part of reference.plan.parts) {
      if (part.kind !== 'system') continue;
      if (part.perColumnKurus < ENGINE_CONFIG.systemDecision.meaningfulColumnStakeKurus) {
        reasons.push(`${part.label}: kolon başı tutar ${formatTL(part.perColumnKurus)}; bu kadar küçük kolon tutarları platformda kabul edilmeyebilir.`);
      }
      const excludedRatio = part.excludedColumns.length / Math.max(1, part.totalColumns);
      if (excludedRatio > ENGINE_CONFIG.systemDecision.maxExcludedColumnRatio) {
        reasons.push(`${part.label}: minimum maç kuralları nedeniyle kolonların ${pct(excludedRatio)} kadarı geçersiz kaldı.`);
      }
    }
  }

  if (chosenHasSystem) {
    if (normal && comparison) {
      reasons.unshift(
        `Sistem içeren portföy, yalnızca normal kuponlu en iyi alternatife göre optimizasyon skorunda ${signedTL(input.chosen!.scoreKurus - normal.scoreKurus)} fark yarattı.`,
        `Normal kuponun hiç dönmediği senaryolarda sistemin dönüş sağlama olasılığı ${pct(comparison.systemSavesProbability)}.`,
        `Tam kayıp olasılığı ${pct(normal.metrics.probTotalLoss)} → ${pct(input.chosen!.metrics.probTotalLoss)}; P5 ${signedTL(comparison.p5DiffKurus)}, beklenen net ${signedTL(comparison.expectedNetDiffKurus)} değişti.`,
      );
    } else {
      reasons.unshift('Sistem içeren portföy, kupon oluşturmamaya ve diğer geçerli alternatiflere göre daha yüksek optimizasyon skoru üretti.');
    }
    return { recommended: true, reasons, comparison, formats: input.formats };
  }

  if (sys) {
    const rival = Math.max(0, normal?.scoreKurus ?? 0);
    reasons.unshift(
      `Sistem kuponu önerilmedi; ${normal && normal.scoreKurus > 0 ? 'normal kupona' : 'kupon oluşturmamaya'} kıyasla risk/getiri avantajı bulunamadı (optimizasyon skoru ${formatTL(sys.scoreKurus)} / ${formatTL(rival)}).`,
    );
  }
  return { recommended: false, reasons, comparison, formats: input.formats };
}

/** Pareto: bir alternatif, başka biri beklenen netten, P5'ten ve ES'ten geri kalmayıp tam kayıp riski daha yüksek değilse ve en az birinde kesin geride kalıyorsa elenir. */
export function markPareto(alternatives: Alternative[], metricsOf: (a: Alternative) => RiskMetrics | null): void {
  for (const a of alternatives) {
    const ma = metricsOf(a);
    if (!ma) {
      a.paretoOptimal = false;
      continue;
    }
    a.paretoOptimal = !alternatives.some((b) => {
      if (b === a) return false;
      const mb = metricsOf(b);
      if (!mb) return false;
      const noWorse =
        mb.expectedNetKurus >= ma.expectedNetKurus &&
        mb.p5NetKurus >= ma.p5NetKurus &&
        mb.expectedShortfall5Kurus >= ma.expectedShortfall5Kurus &&
        mb.probTotalLoss <= ma.probTotalLoss;
      const better =
        mb.expectedNetKurus > ma.expectedNetKurus ||
        mb.p5NetKurus > ma.p5NetKurus ||
        mb.expectedShortfall5Kurus > ma.expectedShortfall5Kurus ||
        mb.probTotalLoss < ma.probTotalLoss;
      return noWorse && better;
    });
  }
}
