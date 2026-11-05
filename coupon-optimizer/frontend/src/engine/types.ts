import type { AnalysisSettings, Plan, RiskProfile } from '../types';
import type { DependenceModel, ProbabilityLevel } from './config';

export type SelectionAnalysis = {
  id: string;
  matchId: string;
  /** 1 / oran: oranın ima ettiği ham olasılık (marjdan arındırılmamış). */
  impliedProbability: number;
  estimatedProbability: number | null;
  /** Tahmini − ima edilen olasılık (olasılık birimi; arayüzde yüzde puan). */
  edge: number | null;
  /** 1 birim yatırım için beklenen net getiri: p·oran − 1. */
  ev: number | null;
  /** Güven puanına göre stres aralığı (kalibre edilmemiş). */
  probabilityRange: { low: number; base: number; high: number } | null;
  evLow: number | null;
  evHigh: number | null;
  /** Tam Kelly oranı (p·o − 1)/(o − 1); ≤ 0 ise stake önerisi yoktur. */
  kellyFraction: number | null;
  /** Referans amaçlı Quarter Kelly (yalnızca Kelly > 0 ise). */
  referenceKelly: number | null;
  kellyStatus: 'positive' | 'non-positive' | 'unavailable';
  uncertaintyHalfWidth: number;
};

export type ScenarioMethod = { kind: 'exact'; scenarios: number } | { kind: 'monte-carlo'; simulations: number; seed: number };

export type HistogramBin = { fromKurus: number; toKurus: number; probability: number };

export type RiskMetrics = {
  stakeKurus: number;
  remainingKurus: number;
  budgetUsePct: number;
  expectedGrossKurus: number;
  expectedNetKurus: number;
  /** Monte Carlo'da beklenen net getirinin standart hatası; tam sayımda null. */
  expectedNetStdErrorKurus: number | null;
  probPositive: number;
  probNegative: number;
  /** Tüm yatırımın kaybedilme (hiç dönüş olmama) olasılığı. */
  probTotalLoss: number;
  maxNetKurus: number;
  worstNetKurus: number;
  /** Net sonucun 5. yüzdelik dilimi. */
  p5NetKurus: number;
  /** En kötü %5'lik dilimdeki ortalama net sonuç (negatif = kayıp). */
  expectedShortfall5Kurus: number;
  /** Zarar senaryolarında ortalama net sonuç; zarar senaryosu yoksa null. */
  averageLossKurus: number | null;
  histogram: HistogramBin[];
  method: ScenarioMethod;
};

export type ExposureRow = {
  key: string;
  label: string;
  couponCount: number;
  columnCount: number;
  /** Bu seçim/maç kaybederse kaybedilen tutar. */
  exposedStakeKurus: number;
  /** Bütçeye oranı (%). */
  budgetPct: number;
};

export type PortfolioEvaluation = {
  plan: Plan;
  /** Stratejinin modeli altındaki metrikler. */
  metrics: RiskMetrics;
  /** Stres: karamsar olasılık + aynı maç/grup tam bağımlılık varsayımı. */
  stress: RiskMetrics;
  /** Optimizasyon skoru: stratejinin faydasına göre kesinlik eşdeğeri net getiri (TL karşılığı). */
  scoreKurus: number;
  exposures: { selections: ExposureRow[]; matches: ExposureRow[] };
  maxSelectionExposurePct: number;
  maxMatchExposurePct: number;
};

export type AlternativeKind = 'normal' | 'system' | 'mixed' | 'none';

export type Alternative = {
  kind: AlternativeKind;
  label: string;
  evaluation: PortfolioEvaluation | null;
  /** Değerlendirme yoksa nedeni. */
  unavailableReason?: string;
  scoreKurus: number;
  paretoOptimal: boolean;
};

export type SystemFormatRow = {
  label: string;
  sizes: number[];
  columns: number;
  perColumnKurus: number;
  expectedNetKurus: number;
  probPositive: number;
  probTotalLoss: number;
  p5NetKurus: number;
  expectedShortfall5Kurus: number;
  maxSelectionExposurePct: number;
  efficiencyScore: number;
  chosen: boolean;
};

export type SystemDecision = {
  recommended: boolean;
  /** Sistemin neden önerildiği/önerilmediği; hepsi hesaplanan metriklere dayanır. */
  reasons: string[];
  /** Sistem içeren ve içermeyen en iyi portföylerin karşılaştırması. */
  comparison: {
    systemSavesProbability: number;
    expectedNetDiffKurus: number;
    totalLossDiff: number;
    p5DiffKurus: number;
    expectedShortfallDiffKurus: number;
    maxExposureDiffPct: number;
    stressExpectedNetDiffKurus: number;
  } | null;
  formats: SystemFormatRow[];
};

export type StrategyResult = {
  strategy: RiskProfile;
  label: string;
  description: string;
  /** 'none' = bu stratejide kupon oluşturmama önerilir. */
  recommendation: 'portfolio' | 'none';
  portfolio: PortfolioEvaluation | null;
  alternatives: Alternative[];
  systemDecision: SystemDecision;
  explanations: string[];
  warnings: string[];
  model: { gamma: number; probability: ProbabilityLevel; dependence: DependenceModel };
  limits: { maxSelectionExposurePct: number; maxMatchExposurePct: number; maxCouponsPerSelection: number; maxStakeKurus: number };
  /** Aday üretimi kısmi/yaklaşık arama içeriyorsa true. */
  approximate: boolean;
};

export type AnalysisSummary = {
  totalSelections: number;
  pendingSelections: number;
  withProbability: number;
  positiveEdge: number;
  negativeEdge: number;
  matchGroups: number;
  multiSelectionMatchGroups: number;
  customGroups: number;
  usedInPool: number;
  validCandidates: number;
  budgetKurus: number;
  warnings: string[];
};

export type AnalysisResult = {
  summary: AnalysisSummary;
  selections: SelectionAnalysis[];
  strategies: StrategyResult[];
  assumptions: string[];
  settings: AnalysisSettings;
  budgetKurus: number;
  durationMs: number;
};
