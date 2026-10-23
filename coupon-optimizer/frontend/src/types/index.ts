/** Maç sonucu: bekliyor, tuttu, tutmadı veya iade (oran 1,00 sayılır). */
export type SelectionResult = 'pending' | 'won' | 'lost' | 'void';

export type MatchSelection = {
  id: string;
  matchName: string; // "BJK - CRY"
  marketSelection: string; // "İlk Yarı 0"
  odds: number; // > 1, en fazla 2 ondalık
  minMatches: number; // pozitif tam sayı
  confidence: number; // 1..10, öznel kullanıcı girdisi
  note?: string;
  /** Yoksa "bekliyor" kabul edilir (eski kayıtlarla uyumlu). */
  result?: SelectionResult;
};

/** Kayıtlı kupondaki seçimin, kuponun oynandığı andaki hali (oran sonradan değişse de hesap bozulmaz). */
export type SelectionSnapshot = Pick<MatchSelection, 'id' | 'matchName' | 'marketSelection' | 'odds' | 'minMatches' | 'confidence'>;

export type RiskProfile = 'cautious' | 'balanced' | 'aggressive';

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
  minSize: number;
  label: string;
  /** Formatın teorik kolon sayısı (min. maç kuralı uygulanmadan). */
  totalColumns: number;
  columns: SystemColumn[];
  excludedColumns: ExcludedColumn[];
  allocatedKurus: number;
  perColumnKurus: number;
  /** Fiilen oynanan tutar = kolon başına tutar × geçerli kolon sayısı. */
  stakeKurus: number;
  /** Kuruş yuvarlamasından dolayı kullanılmayan ayrılmış tutar. */
  unallocatedKurus: number;
  scenarios: LossScenario[];
};

export type CouponPart = NormalCoupon | SystemCoupon;

export type Strategy = 'recommended' | 'all-in-normal' | 'all-in-system';

export type PartInput =
  | { kind: 'normal'; selectionIds: string[]; stakeKurus: number }
  | { kind: 'system'; selectionIds: string[]; minSize: number; allocatedKurus: number };

export type PlanInput = {
  strategy: Strategy;
  label: string;
  description: string;
  parts: PartInput[];
};

export type Plan = {
  id: string;
  strategy: Strategy;
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
  avgConfidence: number;
  minConfidence: number;
  edited?: boolean;
};

/** Güven puanlarının öznel olasılık sayıldığı varsayım altında plan istatistikleri. */
export type PlanStats = {
  stakeKurus: number;
  expectedReturnKurus: number;
  expectedProfitKurus: number;
  stdDevKurus: number;
  /** Hiç dönüş alamama olasılığı. */
  probNoReturn: number;
  /** Dönüşün yatırılan tutarı geçme olasılığı. */
  probProfit: number;
  maxReturnKurus: number;
  /** Optimizasyon hedefi: beklenen dönüş − λ × standart sapma. */
  score: number;
};

export type Comparison = { label: string; plan: Plan; stats: PlanStats };

export type OptimizationResult = {
  plan: Plan | null;
  stats: PlanStats | null;
  comparisons: Comparison[];
  riskProfile: RiskProfile;
  notes: string[];
  budgetKurus: number;
  validSelectionCount: number;
  usedPoolSize: number;
  pruned: boolean;
};

export type SavedSlip = {
  id: string;
  createdAt: string; // ISO tarih
  budgetKurus: number;
  riskProfile: RiskProfile;
  parts: PartInput[];
  selections: SelectionSnapshot[];
};
