/**
 * Kuponix hesap motorunun merkezi yapılandırması. Tüm varsayılanlar burada ve README'de belgelenir.
 * Bu değerler kalibre edilmiş istatistik DEĞİLDİR; ürün tasarımı gereği seçilmiş, değiştirilebilir parametrelerdir.
 */
import type { AnalysisSettings, RiskProfile } from '../types';
import { MIN_STAKE_KURUS } from '../lib/money';

export type DependenceModel = 'independent' | 'comonotonic';
export type ProbabilityLevel = 'low' | 'base' | 'high';

export type StrategyConfig = {
  label: string;
  description: string;
  /**
   * Göreli risk kaçınma katsayısı (CRRA). Fayda u(w) = ln w (γ = 1) veya (w^(1−γ) − 1)/(1−γ); w = nihai servet / bütçe.
   * γ = 1 beklenen log servet büyümesidir (tam Kelly); γ büyüdükçe kayıplar daha ağır cezalandırılır.
   */
  gamma: number;
  /** Optimizasyonda kullanılan olasılık: tahmin (base) ya da güven puanına göre karamsar alt sınır (low). */
  probability: ProbabilityLevel;
  /** Aynı maç / korelasyon grubundaki seçimler için bağımlılık modeli. */
  dependence: DependenceModel;
  /** Kullanıcı ayar girmezse geçerli maruziyet sınırları (bütçeye oranla %). */
  maxSelectionExposurePct: number;
  maxMatchExposurePct: number;
  /** Bir seçimin yer alabileceği en fazla kupon sayısı. */
  maxCouponsPerSelection: number;
  /** Bütçenin en fazla kullanılabilecek kısmı (%). */
  maxBudgetUsePct: number;
};

export const STRATEGIES: Record<RiskProfile, StrategyConfig> = {
  cautious: {
    label: 'Kontrollü',
    description:
      'Kayıp riskini ve yoğunlaşmayı sınırlar: tahminlerin güven puanına göre karamsar alt değerleriyle ve aynı maçtaki seçimler birlikte kaybedecekmiş gibi (tam bağımlılık) hesaplar; sınırlar daha sıkıdır.',
    gamma: 2,
    probability: 'low',
    dependence: 'comonotonic',
    maxSelectionExposurePct: 35,
    maxMatchExposurePct: 35,
    maxCouponsPerSelection: 2,
    maxBudgetUsePct: 60,
  },
  balanced: {
    label: 'Dengeli',
    description: 'Beklenen net getiri ile kayıp riski arasında denge kurar; çeşitlendirme ve kolon verimliliğini birlikte değerlendirir.',
    gamma: 2,
    probability: 'base',
    dependence: 'independent',
    maxSelectionExposurePct: 60,
    maxMatchExposurePct: 60,
    maxCouponsPerSelection: 3,
    maxBudgetUsePct: 100,
  },
  aggressive: {
    label: 'Agresif',
    description:
      'Beklenen log servet büyümesini (tam Kelly yaklaşımı) en yükseğe çıkarır; daha yüksek dalgalanmayı kabul eder. Daha yüksek kazanç veya kazanma olasılığı garantisi değildir.',
    gamma: 1,
    probability: 'base',
    dependence: 'independent',
    maxSelectionExposurePct: 100,
    maxMatchExposurePct: 100,
    maxCouponsPerSelection: 4,
    maxBudgetUsePct: 100,
  },
};

export const STRATEGY_ORDER: RiskProfile[] = ['cautious', 'balanced', 'aggressive'];

export const ENGINE_CONFIG = {
  /**
   * Güven puanı → tahmin belirsizliği. Güven puanı olasılığa çevrilmez; yalnızca tahmini olasılığın etrafındaki
   * stres aralığının yarı genişliğini (yüzde puan) belirler: güven 1 → ±20 puan, güven 10 → ±2 puan (doğrusal).
   */
  uncertainty: { halfWidthAtConfidence1: 0.2, halfWidthAtConfidence10: 0.02, minProbability: 0.01, maxProbability: 0.99 },
  /** Kelly yalnızca referans: tam Kelly'nin bu oranı (Quarter Kelly) gösterilir. */
  kellyReferenceFraction: 0.25,
  /** Senaryo sayısı bu değeri aşmıyorsa tam sayım, aşıyorsa Monte Carlo kullanılır (raporlama). */
  enumerationLimit: 16_384,
  /** Optimizasyon sırasında kullanılan senaryo kümesi (daha hızlı; sonuçlar ayrıca tam ölçekte yeniden hesaplanır). */
  optimizerEnumerationLimit: 4_096,
  optimizerSamples: 2_048,
  /** Aynı anda değerlendirilen en fazla seçim: teknik hesaplama sınırı, bahis kuralı değildir. */
  maxPoolSize: 16,
  /** Bir portföydeki en fazla kupon sayısı. */
  maxCoupons: 4,
  /** Bu boyuta kadar tüm alt kümeler taranır; daha büyükleri sıralama öneklerinden kurulur (yaklaşık arama). */
  fullScanNormalSize: 4,
  fullScanSystemSize: 5,
  /** Sistem kolonlarının en küçük boyutu (tekli kolonlu sistemler aday yapılmaz). */
  minSystemColumnSize: 2,
  shortlistSize: 100,
  localSearchIterations: 30,
  /** Kuyruk riski düzeyi: P5 ve Expected Shortfall (%5). */
  tailLevel: 0.05,
  histogramBins: 12,
  /** Sistem karar motoru: kolon başı tutar bunun altına düşerse "anlamlı değil" sayılır (ürün sezgisi, platform kuralı değil). */
  systemDecision: { meaningfulColumnStakeKurus: 100, maxExcludedColumnRatio: 0.5 },
  /**
   * Sistem verimlilik skoru ağırlıkları (her bileşen sistem tutarına oranlanır). Gerçek kazanma olasılığı değildir.
   * skor = beklenenGetiri·w1 + ES·w2 − tamKayıpOlasılığı·w3 + kolonTutarYeterliliği·w4 − yoğunlaşma·w5 − belirsizlikKaybı·w6
   */
  systemEfficiencyWeights: { expectedReturn: 1, expectedShortfall: 0.5, totalLoss: 0.5, columnStake: 0.25, concentration: 0.25, uncertainty: 0.5 },
  workerTimeoutMs: 30_000,
};

export const DEFAULT_SETTINGS: AnalysisSettings = {
  allowNormal: true,
  allowSystem: true,
  maxLossKurus: null,
  maxSelectionExposurePct: null,
  maxMatchExposurePct: null,
  minColumnStakeKurus: null,
  maxColumnStakeKurus: null,
  minSystemStakeKurus: MIN_STAKE_KURUS,
  simulationCount: 20_000,
  seed: 20261105,
  preferredStrategy: null,
};

/** Güven puanına göre belirsizlik yarı genişliği (olasılık birimi). */
export function uncertaintyHalfWidth(confidence: number): number {
  const { halfWidthAtConfidence1: a, halfWidthAtConfidence10: b } = ENGINE_CONFIG.uncertainty;
  const c = Math.min(10, Math.max(1, confidence));
  return a + ((b - a) * (c - 1)) / 9;
}
