/** Maç sonucu: bekliyor, tuttu, tutmadı veya iade (oran 1,00 sayılır). */
export type SelectionResult = 'pending' | 'won' | 'lost' | 'void';

export type MatchSelection = {
  id: string;
  /** Aynı maça ait seçimleri gruplayan ortak kimlik. */
  matchId: string;
  matchName: string; // "BJK - CRY"
  marketSelection: string; // "İlk Yarı 0"
  odds: number; // > 1, en fazla 2 ondalık
  minMatches: number; // pozitif tam sayı
  /** Kullanıcının tahminine ne kadar güvendiği (1..10). Olasılık DEĞİLDİR. */
  confidence: number;
  /** Kullanıcının tahmini kazanma olasılığı (0..1). Girilmemişse EV/Edge/Kelly hesaplanmaz. */
  estimatedProbability?: number;
  /** İsteğe bağlı: farklı maçları ilişkili saymak için kullanıcı tanımlı korelasyon grubu. */
  correlationGroup?: string;
  note?: string;
  /** Yoksa "bekliyor" kabul edilir (eski kayıtlarla uyumlu). */
  result?: SelectionResult;
};

/** Aynı maçtaki iki seçimin birlikte gerçekleşme olasılığı (kullanıcı tanımlı ortak olasılık). */
export type JointProbability = { selectionIds: [string, string]; probability: number };

/** Kayıtlı kupondaki seçimin, kuponun oynandığı andaki hali (oran sonradan değişse de hesap bozulmaz). */
export type SelectionSnapshot = Pick<MatchSelection, 'id' | 'matchId' | 'matchName' | 'marketSelection' | 'odds' | 'minMatches' | 'confidence'>;

/** Strateji: Kontrollü, Dengeli, Agresif. */
export type RiskProfile = 'cautious' | 'balanced' | 'aggressive';

/** Analiz ayarları. null = sınır yok / strateji varsayılanı. Tutarlar kuruş. */
export type AnalysisSettings = {
  allowNormal: boolean;
  allowSystem: boolean;
  /** En fazla kayıp (en kötü senaryoda kaybedilebilecek tutar). */
  maxLossKurus: number | null;
  /** Tek seçim yatarsa etkilenecek tutarın bütçeye oranı üst sınırı (%). null → strateji varsayılanı. */
  maxSelectionExposurePct: number | null;
  /** Tek maç yatarsa etkilenecek tutarın bütçeye oranı üst sınırı (%). null → strateji varsayılanı. */
  maxMatchExposurePct: number | null;
  /** Platformun kolon başı alt/üst sınırı (kullanıcı girer; varsayılan yok). */
  minColumnStakeKurus: number | null;
  maxColumnStakeKurus: number | null;
  /** Sistem kuponu toplam tutarı alt sınırı. */
  minSystemStakeKurus: number;
  /** Monte Carlo simülasyon sayısı ve tohum (aynı girdi + aynı tohum = aynı sonuç). */
  simulationCount: number;
  seed: number;
  /** Öne çıkarılacak strateji (isteğe bağlı). */
  preferredStrategy: RiskProfile | null;
};

export type NormalCoupon = {
  kind: 'normal';
  selectionIds: string[];
  selectionCount: number;
  stakeKurus: number;
  combinedOdds: number;
  /** Tüm seçimler kazanırsa teorik brüt dönüş (kesinti/vergi hariç). */
  grossReturnKurus: number;
};

export type SystemColumn = {
  selectionIds: string[];
  size: number;
  combinedOdds: number;
  /** Bu kolona düşen tutar (kalan kuruşlar ilk kolonlara deterministik dağıtılır). */
  stakeKurus: number;
  /** Bu kolon kazanırsa teorik brüt dönüşü. */
  returnKurus: number;
};

export type ExcludedColumn = {
  selectionIds: string[];
  size: number;
  reason: string;
};

export type LossScenario = {
  /** Kaybeden seçim sayısı. */
  losers: number;
  minReturnKurus: number;
  maxReturnKurus: number;
  minWinningColumns: number;
  maxWinningColumns: number;
};

export type SystemCoupon = {
  kind: 'system';
  selectionIds: string[];
  selectionCount: number;
  /** Kolon boyutları, ör. [3, 4] → "Sistem 3,4". */
  sizes: number[];
  label: string;
  /** Formatın teorik kolon sayısı (min. maç kuralı uygulanmadan). */
  totalColumns: number;
  columns: SystemColumn[];
  excludedColumns: ExcludedColumn[];
  /** Kolon başı taban tutar (bazı kolonlar 1 kuruş fazla alabilir). */
  perColumnKurus: number;
  /** Toplam sistem tutarı = kolon tutarlarının toplamı. */
  stakeKurus: number;
  scenarios: LossScenario[];
};

export type CouponPart = NormalCoupon | SystemCoupon;

export type PartInput =
  | { kind: 'normal'; selectionIds: string[]; stakeKurus: number }
  | { kind: 'system'; selectionIds: string[]; sizes: number[]; allocatedKurus: number };

export type PlanInput = {
  label: string;
  description: string;
  parts: PartInput[];
};

export type Plan = {
  id: string;
  label: string;
  description: string;
  input: PlanInput;
  parts: CouponPart[];
  couponType: 'Normal' | 'Sistem' | 'Karma';
  budgetKurus: number;
  totalStakeKurus: number;
  remainingKurus: number;
  selectionIds: string[];
  selectionCount: number;
  columnCount: number;
  edited?: boolean;
};

export type SavedSlip = {
  id: string;
  createdAt: string; // ISO tarih
  budgetKurus: number;
  riskProfile: RiskProfile;
  parts: PartInput[];
  selections: SelectionSnapshot[];
};
