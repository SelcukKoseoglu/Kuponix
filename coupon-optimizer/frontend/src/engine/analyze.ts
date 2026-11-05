/**
 * Kuponix analiz akışı (belge §10):
 *  1. Girdileri doğrula  2. Tekil değer analizi  3. Tahmin eksikleri  4. Aynı maç / korelasyon grupları
 *  5–7. Normal, sistem ve karma adaylar  8–9. Kolon/tutar ve senaryo sonuçları  10. Bütçe ve maruziyet kısıtları
 *  11. Risk/getiri karşılaştırması  12. Kontrollü, Dengeli, Agresif  13. Anlamlı aday yoksa "Kupon oluşturmama".
 */
import type { AnalysisSettings, JointProbability, MatchSelection, PartInput, Plan, RiskProfile } from '../types';
import { MIN_STAKE_KURUS, formatTL } from '../lib/money';
import { buildPlan } from '../lib/plan';
import { validateSelection } from '../lib/validation';
import { ENGINE_CONFIG, STRATEGIES, STRATEGY_ORDER, type DependenceModel, type ProbabilityLevel } from './config';
import { buildOutcomeSpace, dependencyKey, validateJointProbability, type OutcomeSpace } from './correlation';
import { decideSystem, markPareto, systemEfficiencyScore } from './decision';
import { computeExposures } from './exposure';
import { allocate, candidateVector, generateCandidates, shortlist, type Candidate, type PoolEntry } from './optimizer';
import { computeRiskMetrics, noBetMetrics } from './riskMetrics';
import { portfolioGross } from './scenarios';
import { analyzeSelection, probabilityAt } from './selectionAnalyzer';
import { systemFormats } from './systemFormats';
import type { Alternative, AnalysisResult, PortfolioEvaluation, SelectionAnalysis, StrategyResult, SystemFormatRow } from './types';
import { certaintyEquivalentKurus, expectedUtility } from './utility';

export type AnalyzeInput = {
  selections: MatchSelection[];
  joints: JointProbability[];
  budgetKurus: number;
  settings: AnalysisSettings;
};

/** Bütçenin dağıtıldığı birim: 200 TL ve üstünde 10 TL, 50 TL ve üstünde 5 TL, altında 1 TL. */
export function stakeUnitKurus(budgetKurus: number): number {
  if (budgetKurus >= 20000) return 1000;
  if (budgetKurus >= 5000) return 500;
  return 100;
}

const pct = (x: number) => `%${(x * 100).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}`;

type Model = {
  pool: PoolEntry[];
  poolBits: number[];
  optimizationSpace: OutcomeSpace;
  reportSpace: OutcomeSpace;
  candidates: Candidate[];
  approximate: boolean;
  vectors: Map<string, Float64Array>;
};

type InternalEval = PortfolioEvaluation & { gross: Float64Array };

export function analyze(input: AnalyzeInput): AnalysisResult {
  const started = Date.now();
  const { budgetKurus, settings } = input;
  const warnings: string[] = [];
  const assumptions: string[] = [];

  // 1–3. Doğrulama ve tekil analiz
  const seen = new Set<string>();
  const valid = input.selections.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return validateSelection(s).length === 0;
  });
  if (valid.length < input.selections.length) warnings.push(`${input.selections.length - valid.length} seçim geçersiz olduğu için analize alınmadı.`);
  const analyses = valid.map(analyzeSelection);
  const analysisById = new Map(analyses.map((a) => [a.id, a]));
  const pending = valid.filter((s) => (s.result ?? 'pending') === 'pending');
  const withProbability = pending.filter((s) => s.estimatedProbability !== undefined);
  const missing = pending.length - withProbability.length;
  if (missing > 0) {
    warnings.push(
      `${missing} seçimin tahmini olasılığı girilmediği için EV, Kelly ve olasılık tabanlı simülasyon bu seçimler için hesaplanamadı; bu seçimler portföylere alınmadı.`,
    );
  }
  if (pending.length < valid.length) warnings.push(`${valid.length - pending.length} seçimin sonucu işaretlendiği için analize alınmadı.`);

  // 4. Gruplar ve ortak olasılıklar
  const groupMembers = new Map<string, MatchSelection[]>();
  withProbability.forEach((s) => {
    const key = dependencyKey(s);
    groupMembers.set(key, [...(groupMembers.get(key) ?? []), s]);
  });
  const matchIds = new Set(valid.map((s) => s.matchId));
  const multiMatchGroups = Array.from(new Set(valid.map((s) => s.matchId))).filter((m) => valid.filter((s) => s.matchId === m).length > 1);
  const customGroups = new Set(valid.filter((s) => s.correlationGroup).map((s) => dependencyKey(s)));
  const joints = input.joints.filter((j) => {
    const [a, b] = j.selectionIds.map((id) => valid.find((s) => s.id === id));
    if (!a || !b || a.estimatedProbability === undefined || b.estimatedProbability === undefined) return false;
    const error = validateJointProbability(a.estimatedProbability, b.estimatedProbability, j.probability);
    if (error) warnings.push(`${a.matchName}: ${error} Bu ortak olasılık kullanılmadı.`);
    return !error;
  });
  const dependentGroups = Array.from(groupMembers.entries()).filter(([, m]) => m.length > 1);
  if (dependentGroups.length > 0) {
    const names = dependentGroups.map(([, m]) => `${m[0].correlationGroup ? `grup “${m[0].correlationGroup}”` : m[0].matchName} (${m.length} seçim)`).join(', ');
    warnings.push(
      `Aynı maç/korelasyon grubunda birden fazla seçim var: ${names}. Ortak olasılık girilmeyen gruplar için Dengeli ve Agresif bağımsızlık VARSAYIMIYLA, Kontrollü ve stres metrikleri tam pozitif bağımlılık varsayımıyla (varsayımsal korelasyon senaryosu) hesaplanır. Bu seçimler aynı kupona konmaz.`,
    );
  }

  // Havuz (teknik hesaplama sınırı: en fazla maxPoolSize seçim)
  let poolSelections = [...withProbability];
  let pruned = false;
  if (poolSelections.length > ENGINE_CONFIG.maxPoolSize) {
    pruned = true;
    poolSelections = poolSelections
      .sort((a, b) => (analysisById.get(b.id)!.ev ?? 0) - (analysisById.get(a.id)!.ev ?? 0))
      .slice(0, ENGINE_CONFIG.maxPoolSize);
    warnings.push(
      `Teknik hesaplama sınırı: ${withProbability.length} seçimden tahmini EV'si en yüksek ${ENGINE_CONFIG.maxPoolSize} seçim birlikte değerlendirildi (yaklaşık çözüm).`,
    );
  }
  const poolById = new Map(poolSelections.map((s) => [s.id, s]));
  const matchIndex = new Map(Array.from(new Set(poolSelections.map((s) => s.matchId))).map((m, i) => [m, i]));

  const unit = stakeUnitKurus(budgetKurus);
  const totalUnits = Math.floor(budgetKurus / unit);
  const rules = {
    minSystemStakeKurus: settings.minSystemStakeKurus,
    minColumnStakeKurus: settings.minColumnStakeKurus,
    maxColumnStakeKurus: settings.maxColumnStakeKurus,
  };
  const candidateRules = { unitKurus: unit, totalUnits, allowNormal: settings.allowNormal, allowSystem: settings.allowSystem, ...rules };

  const models = new Map<string, Model>();
  const getModel = (level: ProbabilityLevel, dependence: DependenceModel): Model => {
    const key = `${level}|${dependence}`;
    if (models.has(key)) return models.get(key)!;
    const pool: PoolEntry[] = poolSelections.map((s) => ({
      selection: s,
      p: probabilityAt(analysisById.get(s.id)!, level)!,
      matchIndex: matchIndex.get(s.matchId)!,
      groupKey: dependencyKey(s),
    }));
    const modelSelections = pool.map((e) => ({ id: e.selection.id, groupKey: e.groupKey, p: e.p }));
    const optimizationSpace = buildOutcomeSpace(modelSelections, dependence, joints, {
      enumerationLimit: ENGINE_CONFIG.optimizerEnumerationLimit,
      samples: ENGINE_CONFIG.optimizerSamples,
      seed: settings.seed,
    });
    const reportSpace = buildOutcomeSpace(modelSelections, dependence, joints, {
      enumerationLimit: ENGINE_CONFIG.enumerationLimit,
      samples: settings.simulationCount,
      seed: settings.seed + 1,
    });
    reportSpace.notes.forEach((n) => warnings.includes(n) || warnings.push(n));
    const { candidates, approximate } = generateCandidates(pool, candidateRules, settings.seed);
    const model: Model = { pool, poolBits: pool.map((_, i) => i), optimizationSpace, reportSpace, candidates, approximate, vectors: new Map() };
    models.set(key, model);
    return model;
  };

  const stressModel = poolSelections.length > 0 ? getModel('low', 'comonotonic') : null;
  const baseModel = poolSelections.length > 0 ? getModel('base', 'independent') : null;

  /** `fast`: optimizasyon senaryo kümesiyle (daha küçük) hesaplar; format karşılaştırma tablosunda kullanılır. */
  const evaluate = (plan: Plan, model: Model, gamma: number, fast = false): InternalEval => {
    const space = fast ? model.optimizationSpace : model.reportSpace;
    const stressSpace = fast ? stressModel!.optimizationSpace : stressModel!.reportSpace;
    const gross = portfolioGross(plan, space, poolById);
    const metrics = computeRiskMetrics(gross, space.weights, plan.totalStakeKurus, budgetKurus, space.method);
    const stressGross = portfolioGross(plan, stressSpace, poolById);
    const stress = computeRiskMetrics(stressGross, stressSpace.weights, plan.totalStakeKurus, budgetKurus, stressSpace.method);
    const eu = expectedUtility(gross, space.weights, plan.totalStakeKurus, budgetKurus, gamma);
    const exposures = computeExposures(plan, poolById, budgetKurus);
    return {
      plan,
      metrics,
      stress,
      scoreKurus: Math.round(certaintyEquivalentKurus(eu, budgetKurus, gamma)),
      exposures,
      maxSelectionExposurePct: exposures.selections[0]?.budgetPct ?? 0,
      maxMatchExposurePct: exposures.matches[0]?.budgetPct ?? 0,
      gross,
    };
  };

  const toPlan = (units: number[], list: Candidate[], model: Model, label: string): Plan | string => {
    const parts: PartInput[] = [];
    units.forEach((u, i) => {
      if (u === 0) return;
      const c = list[i];
      const selectionIds = c.indices.map((idx) => model.pool[idx].selection.id);
      parts.push(
        c.kind === 'normal' ? { kind: 'normal', selectionIds, stakeKurus: u * unit } : { kind: 'system', selectionIds, sizes: c.sizes, allocatedKurus: u * unit },
      );
    });
    if (parts.length === 0) return 'Kupon oluşturmamaya göre fayda sağlayan bir kupon bulunamadı.';
    const built = buildPlan({ label, description: '', parts }, poolSelections, budgetKurus, rules);
    return built.ok ? built.plan : built.errors.join(' ');
  };

  const strategies: StrategyResult[] = STRATEGY_ORDER.map((key) =>
    runStrategy(key, {
      budgetKurus,
      settings,
      unit,
      totalUnits,
      getModel,
      evaluate,
      toPlan,
      poolSelections,
      analyses: poolSelections.map((s) => analysisById.get(s.id)!),
      pruned,
      matchCount: matchIndex.size,
      rules,
      poolById,
    }),
  );

  // Varsayımlar (belge §12.3: bağımsızlık/korelasyon varsayımı, simülasyon sayısı, yöntem)
  assumptions.push(
    'Olasılıklar senin tahminlerindir; güven puanı olasılığa çevrilmez, yalnızca tahminin etrafındaki stres aralığını belirler (güven 1 → ±20, güven 10 → ±2 yüzde puan; kalibre edilmemiştir).',
    'Farklı maçlar birbirinden bağımsız kabul edilir. Aynı maç veya korelasyon grubundaki seçimler için Dengeli/Agresif bağımsızlık varsayar; Kontrollü ve tüm "stres" metrikleri karamsar olasılık + tam pozitif bağımlılık varsayar.',
    'Optimizasyon hedefi: beklenen log servet ailesinden fayda (CRRA). Agresif γ=1 (tam Kelly büyümesi), Dengeli ve Kontrollü γ=2. Skor, bu faydanın kesinlik eşdeğeri net getirisidir ("optimizasyon skoru"); kazanma olasılığı değildir.',
    'Dönüşler teorik brüt tutarlardır; platformun kesinti, vergi, oran ve ödeme kuralları dahil değildir. Sistem formatlarının platformda oynanabilirliği ayrıca doğrulanmalıdır.',
    `Kolon başı alt sınır: ${settings.minColumnStakeKurus ? formatTL(settings.minColumnStakeKurus) : 'girilmedi (yalnızca 1 kuruş teknik sınır)'}; normal kupon en az ${formatTL(MIN_STAKE_KURUS)}, sistem kuponu en az ${formatTL(settings.minSystemStakeKurus)}.`,
  );
  if (baseModel) {
    const m = baseModel.reportSpace.method;
    assumptions.push(
      m.kind === 'exact'
        ? `Senaryolar tam sayımla hesaplandı (${m.scenarios.toLocaleString('tr-TR')} senaryo).`
        : `Senaryolar Monte Carlo ile hesaplandı (${m.simulations.toLocaleString('tr-TR')} simülasyon, tohum ${m.seed}); sonuçlar örnekleme belirsizliği içerir.`,
    );
  }

  const candidateCount = Array.from(models.values()).reduce((n, m) => Math.max(n, m.candidates.length), 0);
  return {
    summary: {
      totalSelections: input.selections.length,
      pendingSelections: pending.length,
      withProbability: withProbability.length,
      positiveEdge: analyses.filter((a) => (a.edge ?? 0) > 0).length,
      negativeEdge: analyses.filter((a) => a.edge !== null && a.edge < 0).length,
      matchGroups: matchIds.size,
      multiSelectionMatchGroups: multiMatchGroups.length,
      customGroups: customGroups.size,
      usedInPool: poolSelections.length,
      validCandidates: candidateCount,
      budgetKurus,
      warnings,
    },
    selections: analyses,
    strategies,
    assumptions,
    settings,
    budgetKurus,
    durationMs: Date.now() - started,
  };
}

type StrategyContext = {
  budgetKurus: number;
  settings: AnalysisSettings;
  unit: number;
  totalUnits: number;
  getModel: (level: ProbabilityLevel, dependence: DependenceModel) => Model;
  evaluate: (plan: Plan, model: Model, gamma: number, fast?: boolean) => InternalEval;
  toPlan: (units: number[], list: Candidate[], model: Model, label: string) => Plan | string;
  poolSelections: MatchSelection[];
  analyses: SelectionAnalysis[];
  pruned: boolean;
  matchCount: number;
  rules: { minSystemStakeKurus: number; minColumnStakeKurus: number | null; maxColumnStakeKurus: number | null };
  poolById: Map<string, MatchSelection>;
};

function runStrategy(key: RiskProfile, ctx: StrategyContext): StrategyResult {
  const cfg = STRATEGIES[key];
  const { budgetKurus, settings, unit } = ctx;
  const selPct = settings.maxSelectionExposurePct ?? cfg.maxSelectionExposurePct;
  const matchPct = settings.maxMatchExposurePct ?? cfg.maxMatchExposurePct;
  const capKurus = Math.min((budgetKurus * cfg.maxBudgetUsePct) / 100, settings.maxLossKurus ?? Number.POSITIVE_INFINITY, budgetKurus - unit);
  const limits = {
    maxSelectionExposurePct: selPct,
    maxMatchExposurePct: matchPct,
    maxCouponsPerSelection: cfg.maxCouponsPerSelection,
    maxStakeKurus: Math.max(0, Math.floor(capKurus / unit) * unit),
  };
  const base: Omit<StrategyResult, 'recommendation' | 'portfolio' | 'alternatives' | 'systemDecision' | 'explanations'> = {
    strategy: key,
    label: cfg.label,
    description: cfg.description,
    warnings: [],
    model: { gamma: cfg.gamma, probability: cfg.probability, dependence: cfg.dependence },
    limits,
    approximate: false,
  };
  const noneAlt: Alternative = { kind: 'none', label: 'Kupon oluşturmama', evaluation: null, scoreKurus: 0, paretoOptimal: true };
  const emptyDecision = (reason: string) => ({ recommended: false, reasons: [reason], comparison: null, formats: [] });

  if (ctx.poolSelections.length === 0) {
    const reason = 'Tahmini olasılık girilmediği için EV ve olasılık tabanlı simülasyon hesaplanamadı; kupon önerilmiyor.';
    return { ...base, recommendation: 'none', portfolio: null, alternatives: [noneAlt], systemDecision: emptyDecision(reason), explanations: [reason] };
  }
  if (limits.maxStakeKurus < MIN_STAKE_KURUS) {
    const reason = `Bu stratejide yatırılabilecek en fazla tutar (${formatTL(limits.maxStakeKurus)}) en küçük kupon tutarının (${formatTL(MIN_STAKE_KURUS)}) altında.`;
    return { ...base, recommendation: 'none', portfolio: null, alternatives: [noneAlt], systemDecision: emptyDecision(reason), explanations: [reason] };
  }

  const model = ctx.getModel(cfg.probability, cfg.dependence);
  const list = shortlist(model.candidates, cfg.gamma, MIN_STAKE_KURUS / budgetKurus, ctx.matchCount);
  const vectors = list.map((c) => {
    if (!model.vectors.has(c.key)) model.vectors.set(c.key, candidateVector(c, model.optimizationSpace, model.poolBits));
    return model.vectors.get(c.key)!;
  });
  const options = {
    gamma: cfg.gamma,
    budgetKurus,
    unitKurus: unit,
    capUnits: Math.floor(limits.maxStakeKurus / unit),
    maxCoupons: ENGINE_CONFIG.maxCoupons,
    maxSelectionExposureKurus: (budgetKurus * selPct) / 100,
    maxMatchExposureKurus: (budgetKurus * matchPct) / 100,
    maxCouponsPerSelection: cfg.maxCouponsPerSelection,
    allowNormal: settings.allowNormal,
    allowSystem: settings.allowSystem,
    requireBoth: false,
  };

  const evals: InternalEval[] = [];
  const makeAlt = (kind: Alternative['kind'], label: string, overrides: Partial<typeof options>): Alternative => {
    const allocation = allocate(list, vectors, model.optimizationSpace.weights, { ...options, ...overrides });
    if (!allocation || allocation.units.every((u) => u === 0)) {
      return { kind, label, evaluation: null, unavailableReason: 'Kısıtlar içinde kupon oluşturmamaya göre fayda sağlayan bir aday bulunamadı.', scoreKurus: 0, paretoOptimal: false };
    }
    const plan = ctx.toPlan(allocation.units, list, model, `${STRATEGIES[key].label} · ${label}`);
    if (typeof plan === 'string') return { kind, label, evaluation: null, unavailableReason: plan, scoreKurus: 0, paretoOptimal: false };
    const evaluation = ctx.evaluate(plan, model, cfg.gamma);
    evals.push(evaluation);
    return { kind, label, evaluation, scoreKurus: evaluation.scoreKurus, paretoOptimal: false };
  };

  const alternatives: Alternative[] = [];
  if (settings.allowNormal) alternatives.push(makeAlt('normal', 'Normal kupon ağırlıklı', { allowSystem: false }));
  if (settings.allowSystem) alternatives.push(makeAlt('system', 'Sistem kuponu ağırlıklı', { allowNormal: false }));
  if (settings.allowNormal && settings.allowSystem) {
    const free = makeAlt('mixed', 'Serbest karışım', {});
    const freeIsMixed = free.evaluation?.plan.couponType === 'Karma';
    alternatives.push(freeIsMixed ? { ...free, label: 'Normal + sistem karma' } : makeAlt('mixed', 'Normal + sistem karma', { requireBoth: true }));
    if (!freeIsMixed && free.evaluation && !alternatives.some((a) => a.evaluation?.plan.id === free.evaluation!.plan.id)) {
      alternatives.push({ ...free, kind: free.evaluation.plan.couponType === 'Sistem' ? 'system' : 'normal' });
    }
  }
  alternatives.push(noneAlt);

  // Benzer/aynı portföyleri tekilleştir (aynı kuponlar aynı tutarlarla).
  const unique: Alternative[] = [];
  for (const alt of alternatives) {
    if (alt.evaluation && unique.some((u) => u.evaluation?.plan.id === alt.evaluation!.plan.id)) continue;
    unique.push(alt);
  }
  markPareto(unique, (a) => (a.kind === 'none' ? noBetMetrics(budgetKurus) : (a.evaluation?.metrics ?? null)));

  const best = unique
    .filter((a) => a.evaluation)
    .sort((a, b) => b.scoreKurus - a.scoreKurus)[0] as Alternative | undefined;
  const chosen = best && best.scoreKurus > 0 ? (best.evaluation as InternalEval) : null;

  // Sistem karar motoru
  const normalAlt = unique.find((a) => a.kind === 'normal');
  const systemAlt = [...unique].filter((a) => a.evaluation?.plan.parts.some((p) => p.kind === 'system')).sort((a, b) => b.scoreKurus - a.scoreKurus)[0];
  const sysRef = (chosen?.plan.parts.some((p) => p.kind === 'system') ? chosen : (systemAlt?.evaluation as InternalEval | undefined)) ?? null;
  const normalEval = normalAlt?.evaluation as InternalEval | undefined;
  let saves: number | null = null;
  if (sysRef && normalEval) {
    saves = 0;
    const w = model.reportSpace.weights;
    for (let o = 0; o < w.length; o++) if (sysRef.gross[o] > 0.5 && normalEval.gross[o] < 0.5) saves += w[o];
  }
  const formats: SystemFormatRow[] = [];
  const sysPartIndex = chosen?.plan.parts.findIndex((p) => p.kind === 'system') ?? -1;
  if (chosen && sysPartIndex >= 0) {
    const part = chosen.plan.input.parts[sysPartIndex];
    if (part.kind === 'system') {
      for (const sizes of systemFormats(part.selectionIds.length).slice(0, 14)) {
        const parts = chosen.plan.input.parts.map((p, i) => (i === sysPartIndex ? { ...part, sizes } : p));
        const built = buildPlan({ ...chosen.plan.input, parts }, ctx.poolSelections, budgetKurus, ctx.rules);
        if (!built.ok) continue;
        const ev = ctx.evaluate(built.plan, model, cfg.gamma, true);
        const sysPart = built.plan.parts[sysPartIndex];
        if (sysPart.kind !== 'system') continue;
        formats.push({
          label: sysPart.label,
          sizes,
          columns: sysPart.columns.length,
          perColumnKurus: sysPart.perColumnKurus,
          expectedNetKurus: ev.metrics.expectedNetKurus,
          probPositive: ev.metrics.probPositive,
          probTotalLoss: ev.metrics.probTotalLoss,
          p5NetKurus: ev.metrics.p5NetKurus,
          expectedShortfall5Kurus: ev.metrics.expectedShortfall5Kurus,
          maxSelectionExposurePct: ev.maxSelectionExposurePct,
          efficiencyScore: systemEfficiencyScore(ev.metrics, ev.stress, sysPart.perColumnKurus, ev.maxSelectionExposurePct),
          chosen: sizes.join(',') === part.sizes.join(','),
        });
      }
    }
  }
  const systemDecision = decideSystem({
    allowSystem: settings.allowSystem,
    poolAnalyses: ctx.analyses,
    chosen,
    normalAlt,
    systemAlt,
    systemSavesProbability: saves,
    formats,
  });

  // Açıklamalar (yalnızca hesaplanan metriklerden)
  const explanations: string[] = [];
  const warnings: string[] = [];
  if (chosen) {
    const m = chosen.metrics;
    const kinds = chosen.plan.parts.map((p) => (p.kind === 'normal' ? 'normal' : p.label)).join(', ');
    explanations.push(
      `${chosen.plan.parts.length} kupon (${kinds}); toplam ${formatTL(m.stakeKurus)} (bütçe kullanımı ${pct(m.budgetUsePct / 100)}), ${formatTL(m.remainingKurus)} kalan.`,
      `Aynı bütçeyle değerlendirilen alternatifler arasında ${cfg.label} hedefinde en yüksek optimizasyon skoru (${formatTL(chosen.scoreKurus)}) bu portföyde; kupon oluşturmamanın skoru 0 TL.`,
    );
    const runnerUp = unique.filter((a) => a.evaluation && a.evaluation.plan.id !== chosen.plan.id).sort((a, b) => b.scoreKurus - a.scoreKurus)[0];
    if (runnerUp?.evaluation) {
      const r = runnerUp.evaluation.metrics;
      explanations.push(
        `“${runnerUp.label}” alternatifine göre beklenen net ${formatTL(m.expectedNetKurus - r.expectedNetKurus)}, P5 ${formatTL(m.p5NetKurus - r.p5NetKurus)}, tam kayıp olasılığı ${pct(r.probTotalLoss)} → ${pct(m.probTotalLoss)}.`,
      );
    }
    const topSel = chosen.exposures.selections[0];
    if (topSel) {
      explanations.push(`En yüksek seçim maruziyeti: ${topSel.label} — kaybederse ${formatTL(topSel.exposedStakeKurus)} etkilenir (bütçeye oranı ${pct(topSel.budgetPct / 100)}, ${topSel.couponCount} kuponda).`);
    }
    if (chosen.stress.expectedNetKurus < 0 && m.expectedNetKurus >= 0) {
      warnings.push('Tahmin belirsizliği altında (karamsar olasılık + aynı maç tam bağımlılık) beklenen net getiri negatife dönüyor.');
    }
    if (m.method.kind === 'monte-carlo' && m.expectedNetStdErrorKurus !== null) {
      warnings.push(`Monte Carlo: beklenen net getiri yaklaşık ±${formatTL(Math.round(1.96 * m.expectedNetStdErrorKurus))} (95%) örnekleme belirsizliği içerir.`);
    }
  } else {
    const bestScore = best ? best.scoreKurus : null;
    explanations.push(
      bestScore !== null
        ? `Hiçbir aday ${cfg.label} hedefinde kupon oluşturmamadan daha iyi sonuç vermedi (en iyi adayın optimizasyon skoru ${formatTL(bestScore)}).`
        : `Kısıtlar içinde ${cfg.label} hedefine göre fayda sağlayan bir aday bulunamadı.`,
      'Kupon oluşturmama bu strateji için öne çıkan alternatiftir.',
    );
  }
  explanations.push(systemDecision.reasons[0]);

  return {
    ...base,
    recommendation: chosen ? 'portfolio' : 'none',
    portfolio: chosen ? stripGross(chosen) : null,
    alternatives: unique.map((a) => (a.evaluation ? { ...a, evaluation: stripGross(a.evaluation as InternalEval) } : a)),
    systemDecision,
    explanations,
    warnings,
    approximate: model.approximate || ctx.pruned || model.optimizationSpace.method.kind === 'monte-carlo',
  };
}

/**
 * Kullanıcının tutarlarını değiştirdiği bir planı, seçilen stratejinin modeli ve stres modeliyle yeniden değerlendirir.
 * Plandaki tüm seçimlerin tahmini olasılığı olmalıdır.
 */
export function evaluateCustomPlan(input: AnalyzeInput, strategy: RiskProfile, plan: Plan): PortfolioEvaluation | string {
  const cfg = STRATEGIES[strategy];
  const byId = new Map(input.selections.map((s) => [s.id, s]));
  const members = plan.selectionIds.map((id) => byId.get(id));
  if (members.some((s) => !s || s.estimatedProbability === undefined)) {
    return 'Plandaki her seçimin tahmini olasılığı olmalı; analizi yeniden çalıştırın.';
  }
  const selections = members as MatchSelection[];
  const analyses = new Map(selections.map((s) => [s.id, analyzeSelection(s)]));
  const space = (level: ProbabilityLevel, dependence: DependenceModel) =>
    buildOutcomeSpace(
      selections.map((s) => ({ id: s.id, groupKey: dependencyKey(s), p: probabilityAt(analyses.get(s.id)!, level)! })),
      dependence,
      input.joints,
      { enumerationLimit: ENGINE_CONFIG.enumerationLimit, samples: input.settings.simulationCount, seed: input.settings.seed + 1 },
    );
  const main = space(cfg.probability, cfg.dependence);
  const stressSpace = space('low', 'comonotonic');
  const selectionsById = new Map(selections.map((s) => [s.id, s]));
  const gross = portfolioGross(plan, main, selectionsById);
  const stressGross = portfolioGross(plan, stressSpace, selectionsById);
  const exposures = computeExposures(plan, selectionsById, input.budgetKurus);
  const eu = expectedUtility(gross, main.weights, plan.totalStakeKurus, input.budgetKurus, cfg.gamma);
  return {
    plan,
    metrics: computeRiskMetrics(gross, main.weights, plan.totalStakeKurus, input.budgetKurus, main.method),
    stress: computeRiskMetrics(stressGross, stressSpace.weights, plan.totalStakeKurus, input.budgetKurus, stressSpace.method),
    scoreKurus: Math.round(certaintyEquivalentKurus(eu, input.budgetKurus, cfg.gamma)),
    exposures,
    maxSelectionExposurePct: exposures.selections[0]?.budgetPct ?? 0,
    maxMatchExposurePct: exposures.matches[0]?.budgetPct ?? 0,
  };
}

function stripGross(e: InternalEval): PortfolioEvaluation {
  const { gross: _gross, ...rest } = e;
  return rest;
}
