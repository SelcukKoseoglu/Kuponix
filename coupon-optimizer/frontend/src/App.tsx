import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AnalysisSettings, JointProbability, MatchSelection, Plan, RiskProfile, SavedSlip, SelectionResult } from './types';
import type { AnalysisResult } from './engine/types';
import { BudgetInput } from './components/BudgetInput';
import { ResponsibleNote } from './components/ResponsibleNote';
import { Stat } from './components/Stat';
import { AnalysisView } from './features/analysis/AnalysisView';
import { DataActions } from './features/data/DataActions';
import { SelectionForm, type MatchOption } from './features/selections/SelectionForm';
import { SelectionList } from './features/selections/SelectionList';
import { SettingsPanel } from './features/settings/SettingsPanel';
import { SavedSlips } from './features/slips/SavedSlips';
import { evaluateCustomPlan } from './engine/analyze';
import { runAnalysis } from './engine/client';
import { DEFAULT_SETTINGS } from './engine/config';
import { formatTL, kurusToInput, parseMoneyToKurus } from './lib/money';
import { createId, loadFromStorage, safeLocalStorage, saveToStorage, snapshotOf, type AppData } from './lib/storage';
import { splitMatchName, validateSelection } from './lib/validation';

const DEFAULT_BUDGET = '300';

function initialData(): AppData | null {
  return loadFromStorage(safeLocalStorage());
}

export default function App() {
  const [initial] = useState(initialData);
  const [selections, setSelections] = useState<MatchSelection[]>(initial?.selections ?? []);
  const [joints, setJoints] = useState<JointProbability[]>(initial?.joints ?? []);
  const [slips, setSlips] = useState<SavedSlip[]>(initial?.slips ?? []);
  const [settings, setSettings] = useState<AnalysisSettings>(initial?.settings ?? DEFAULT_SETTINGS);
  const [budgetInput, setBudgetInput] = useState(initial?.budgetKurus ? kurusToInput(initial.budgetKurus) : DEFAULT_BUDGET);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [presetMatchId, setPresetMatchId] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [running, setRunning] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [calculatedKey, setCalculatedKey] = useState<string | null>(null);
  const [openStrategy, setOpenStrategy] = useState<RiskProfile | null>(null);
  const [savedPlanIds, setSavedPlanIds] = useState<Set<string>>(new Set());

  const budgetKurus = parseMoneyToKurus(budgetInput);
  const validBudget = budgetKurus !== null && budgetKurus > 0 ? budgetKurus : null;
  const pending = useMemo(() => selections.filter((s) => (s.result ?? 'pending') === 'pending'), [selections]);
  // Sonuç işaretlemek, analize zaten girmeyen seçimleri etkilemediği sürece analizi bayatlatmaz.
  const dataKey = useMemo(
    () => JSON.stringify({ selections: pending.map(({ result: _r, ...s }) => s), joints, settings, budgetKurus: validBudget }),
    [pending, joints, settings, validBudget],
  );

  useEffect(() => {
    saveToStorage(safeLocalStorage(), { budgetKurus: validBudget, selections, slips, settings, joints });
  }, [selections, validBudget, slips, settings, joints]);

  const validCount = useMemo(() => selections.filter((s) => validateSelection(s).length === 0).length, [selections]);
  const withProbability = pending.filter((s) => s.estimatedProbability !== undefined).length;
  const knownTeams = useMemo(() => selections.flatMap((s) => Object.values(splitMatchName(s.matchName))), [selections]);
  const matches: MatchOption[] = useMemo(() => {
    const map = new Map<string, MatchOption>();
    selections.forEach((s) => {
      const m = map.get(s.matchId);
      map.set(s.matchId, { matchId: s.matchId, matchName: m?.matchName ?? s.matchName, count: (m?.count ?? 0) + 1 });
    });
    return Array.from(map.values());
  }, [selections]);
  const usedInSlips = useMemo(() => new Set(slips.flatMap((s) => s.selections.map((x) => x.id))), [slips]);
  const editing = selections.find((s) => s.id === editingId) ?? null;
  const clearPreset = useCallback(() => setPresetMatchId(null), []);

  const handleSubmit = (value: Omit<MatchSelection, 'id' | 'matchId'>, matchId: string | null) => {
    // Mevcut maç seçildiyse onun kimliği; yoksa (yeni maç) yeni kimlik. Aynı maçtaki seçimler bu kimlikle gruplanır.
    const resolvedMatchId = matchId ?? createId();
    if (editing) {
      setSelections((list) =>
        list.map((s) => (s.id === editing.id ? { ...value, id: s.id, matchId: matchId ?? s.matchId, ...(s.result ? { result: s.result } : {}) } : s)),
      );
      setEditingId(null);
    } else {
      const ids = new Set(selections.map((s) => s.id));
      let id = createId();
      while (ids.has(id)) id = createId();
      setSelections((list) => [...list, { ...value, id, matchId: resolvedMatchId }]);
    }
  };

  const handleDelete = (id: string) => {
    setSelections((list) => list.filter((s) => s.id !== id));
    setJoints((list) => list.filter((j) => !j.selectionIds.includes(id)));
    if (editingId === id) setEditingId(null);
  };

  const handleSetResult = (id: string, value: SelectionResult) => {
    setSelections((list) =>
      list.map((s) => {
        if (s.id !== id) return s;
        const { result: _old, ...rest } = s;
        return value === 'pending' ? rest : { ...rest, result: value };
      }),
    );
  };

  const handleSetJoint = (ids: [string, string], probability: number | null) => {
    setJoints((list) => {
      const rest = list.filter((j) => !(j.selectionIds.includes(ids[0]) && j.selectionIds.includes(ids[1])));
      return probability === null ? rest : [...rest, { selectionIds: ids, probability }];
    });
  };

  const handleAnalyze = () => {
    if (!validBudget) return;
    setRunning(true);
    setAnalysisError(null);
    const key = dataKey;
    runAnalysis({ selections, joints, budgetKurus: validBudget, settings })
      .then((r) => {
        setResult(r);
        setCalculatedKey(key);
        const preferred = settings.preferredStrategy;
        setOpenStrategy(preferred ?? r.strategies.find((s) => s.recommendation === 'portfolio')?.strategy ?? null);
      })
      .catch((error: Error) => setAnalysisError(error.message))
      .finally(() => setRunning(false));
  };

  const handleSave = (strategy: RiskProfile, plan: Plan) => {
    const byId = new Map(selections.map((s) => [s.id, s]));
    const snapshots = plan.selectionIds.map((id) => byId.get(id)).filter((s): s is MatchSelection => !!s).map(snapshotOf);
    if (snapshots.length !== plan.selectionIds.length) {
      window.alert('Kupondaki bazı seçimler listeden silinmiş; kaydetmeden önce yeniden analiz edin.');
      return;
    }
    setSlips((list) => [
      ...list,
      { id: createId(), createdAt: new Date().toISOString(), budgetKurus: plan.budgetKurus, riskProfile: strategy, parts: plan.input.parts, selections: snapshots },
    ]);
    setSavedPlanIds((set) => new Set(set).add(`${strategy}:${plan.id}`));
  };

  const handleApplyStakes = useCallback(
    (strategy: RiskProfile, plan: Plan): string | null => {
      if (!result) return 'Önce analiz edin.';
      const evaluation = evaluateCustomPlan({ selections, joints, budgetKurus: result.budgetKurus, settings: result.settings }, strategy, plan);
      if (typeof evaluation === 'string') return evaluation;
      setResult({
        ...result,
        strategies: result.strategies.map((s) =>
          s.strategy === strategy
            ? {
                ...s,
                recommendation: 'portfolio',
                portfolio: { ...evaluation, plan: { ...evaluation.plan, edited: true } },
                explanations: [`Tutarları sen düzenledin; metrikler ${s.label} modeliyle yeniden hesaplandı.`, ...s.explanations.slice(1)],
              }
            : s,
        ),
      });
      return null;
    },
    [result, selections, joints],
  );

  const handleImport = (data: AppData) => {
    setSelections(data.selections);
    setSlips(data.slips);
    setSettings(data.settings);
    setJoints(data.joints);
    if (data.budgetKurus) setBudgetInput(kurusToInput(data.budgetKurus));
    setEditingId(null);
    setResult(null);
  };

  const handleClear = () => {
    setSelections([]);
    setSlips([]);
    setJoints([]);
    setSettings(DEFAULT_SETTINGS);
    setBudgetInput(DEFAULT_BUDGET);
    setEditingId(null);
    setResult(null);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Kuponix</h1>
        <p className="mt-1 text-slate-300">Kuponunu oluştur. Senaryolarını karşılaştır.</p>
        <p className="mt-1 text-sm text-slate-400">
          Seçimlerini ve tahminlerini gir; normal, sistem ve karma kupon portföylerini — ve hiç kupon oluşturmamayı — aynı bütçe altında
          risk ve getiri açısından karşılaştır. Kuponix tahmin yapmaz, kazanç garantisi vermez.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <main className="min-w-0 space-y-6">
          <SelectionForm
            editing={editing}
            knownTeams={knownTeams}
            matches={matches}
            presetMatchId={presetMatchId}
            onSubmit={handleSubmit}
            onCancelEdit={() => setEditingId(null)}
            onClearPreset={clearPreset}
          />
          <SelectionList
            selections={selections}
            joints={joints}
            editingId={editingId}
            usedInSlips={usedInSlips}
            onEdit={setEditingId}
            onDelete={handleDelete}
            onSetResult={handleSetResult}
            onAddToMatch={(matchId) => {
              setEditingId(null);
              setPresetMatchId(matchId);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            onSetJoint={handleSetJoint}
          />
        </main>

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-6 lg:self-start">
          <BudgetInput value={budgetInput} onChange={setBudgetInput} />
          <SettingsPanel settings={settings} onChange={setSettings} />
          <section className="card space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Toplam seçim" value={selections.length} />
              <Stat label="Geçerli seçim" value={validCount} />
              <Stat label="Tahmini olasılık girilmiş" value={`${withProbability} / ${pending.length}`} tone={withProbability < pending.length ? 'negative' : 'default'} />
              <Stat label="Bütçe" value={validBudget ? formatTL(validBudget) : '—'} />
            </div>
            <button className="btn-primary w-full py-3 text-base" onClick={handleAnalyze} disabled={running || pending.length === 0 || !validBudget}>
              {running ? 'Analiz ediliyor…' : 'Analiz et'}
            </button>
            {pending.length === 0 && <p className="text-xs text-slate-400">Analiz için sonucu bekleyen en az bir seçim ekleyin.</p>}
            {pending.length > 0 && withProbability === 0 && (
              <p className="text-xs text-amber-300">
                Hiçbir seçimde tahmini olasılık yok: analiz çalışır ama EV ve olasılık tabanlı öneri hesaplanamaz. Seçimlerini düzenleyip
                yüzde tahminini gir.
              </p>
            )}
            {analysisError && (
              <p role="alert" className="text-sm text-rose-300">
                {analysisError}
              </p>
            )}
          </section>
          <DataActions data={{ budgetKurus: validBudget, selections, slips, settings, joints }} onImport={handleImport} onClear={handleClear} />
        </aside>
      </div>

      {result && (
        <div className="mt-8">
          <AnalysisView
            result={result}
            stale={calculatedKey !== dataKey}
            selections={selections}
            settings={result.settings}
            openStrategy={openStrategy}
            onOpenStrategy={setOpenStrategy}
            savedPlanIds={savedPlanIds}
            onSave={handleSave}
            onApplyStakes={handleApplyStakes}
          />
        </div>
      )}

      <div className="mt-8">
        <SavedSlips slips={slips} selections={selections} onDelete={(id) => setSlips((list) => list.filter((s) => s.id !== id))} />
      </div>

      <div className="mt-8">
        <ResponsibleNote />
      </div>
    </div>
  );
}
