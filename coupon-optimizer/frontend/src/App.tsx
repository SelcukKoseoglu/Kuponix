import { useEffect, useMemo, useState } from 'react';
import type { MatchSelection, OptimizationResult, Plan, RiskProfile, SavedSlip, SelectionResult } from './types';
import { BudgetInput } from './components/BudgetInput';
import { ResponsibleNote } from './components/ResponsibleNote';
import { RiskSelector } from './components/RiskSelector';
import { Stat } from './components/Stat';
import { DataActions } from './features/data/DataActions';
import { Recommendation } from './features/plans/Recommendation';
import { SelectionForm } from './features/selections/SelectionForm';
import { SelectionList } from './features/selections/SelectionList';
import { SavedSlips } from './features/slips/SavedSlips';
import { formatTL, kurusToInput, parseMoneyToKurus } from './lib/money';
import { generatePlans } from './lib/optimizer';
import { createId, loadFromStorage, safeLocalStorage, saveToStorage, snapshotOf, type AppData } from './lib/storage';
import { validateSelection } from './lib/validation';

const DEFAULT_BUDGET = '300';

function initialData(): AppData | null {
  return loadFromStorage(safeLocalStorage());
}

export default function App() {
  const [initial] = useState(initialData);
  const [selections, setSelections] = useState<MatchSelection[]>(initial?.selections ?? []);
  const [slips, setSlips] = useState<SavedSlip[]>(initial?.slips ?? []);
  const [riskProfile, setRiskProfile] = useState<RiskProfile>(initial?.riskProfile ?? 'balanced');
  const [budgetInput, setBudgetInput] = useState(initial?.budgetKurus ? kurusToInput(initial.budgetKurus) : DEFAULT_BUDGET);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [runId, setRunId] = useState(0);
  const [calculatedKey, setCalculatedKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);

  const budgetKurus = parseMoneyToKurus(budgetInput);
  const validBudget = budgetKurus !== null && budgetKurus > 0 ? budgetKurus : null;
  const openSelections = useMemo(() => selections.filter((s) => (s.result ?? 'pending') === 'pending'), [selections]);
  // Sonuç işaretlemek, zaten öneriye alınmamış maçları etkilemediği sürece öneriyi bayatlatmaz.
  const dataKey = useMemo(
    () =>
      JSON.stringify({
        selections: openSelections.map(({ result: _r, ...s }) => s),
        budgetKurus: validBudget,
        riskProfile,
      }),
    [openSelections, validBudget, riskProfile],
  );

  useEffect(() => {
    saveToStorage(safeLocalStorage(), { budgetKurus: validBudget, selections, slips, riskProfile });
  }, [selections, validBudget, slips, riskProfile]);

  const validCount = useMemo(() => selections.filter((s) => validateSelection(s).length === 0).length, [selections]);
  const usedInSlips = useMemo(() => new Set(slips.flatMap((s) => s.selections.map((x) => x.id))), [slips]);
  const editing = selections.find((s) => s.id === editingId) ?? null;

  const handleSubmit = (value: Omit<MatchSelection, 'id'>) => {
    if (editing) {
      setSelections((list) =>
        list.map((s) => (s.id === editing.id ? { ...value, id: s.id, ...(s.result ? { result: s.result } : {}) } : s)),
      );
      setEditingId(null);
    } else {
      const ids = new Set(selections.map((s) => s.id));
      let id = createId();
      while (ids.has(id)) id = createId();
      setSelections((list) => [...list, { ...value, id }]);
    }
  };

  const handleDelete = (id: string) => {
    setSelections((list) => list.filter((s) => s.id !== id));
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

  const handleCalculate = () => {
    setResult(generatePlans(selections, validBudget, riskProfile));
    setRunId((n) => n + 1);
    setCalculatedKey(dataKey);
  };

  const handleSave = (plan: Plan) => {
    const byId = new Map(selections.map((s) => [s.id, s]));
    const snapshots = plan.selectionIds.map((id) => byId.get(id)).filter((s): s is MatchSelection => !!s).map(snapshotOf);
    if (snapshots.length !== plan.selectionIds.length) {
      window.alert('Kupondaki bazı seçimler listeden silinmiş; kaydetmeden önce yeniden hesaplayın.');
      return;
    }
    const slip: SavedSlip = {
      id: createId(),
      createdAt: new Date().toISOString(),
      budgetKurus: plan.budgetKurus,
      riskProfile: result?.riskProfile ?? riskProfile,
      parts: plan.input.parts,
      selections: snapshots,
    };
    setSlips((list) => [...list, slip]);
    setSavedKey(`${runId}:${plan.id}`);
  };

  const handleUpdatePlan = (plan: Plan) => {
    setResult((r) => (r ? { ...r, plan } : r));
  };

  const handleImport = (data: AppData) => {
    setSelections(data.selections);
    setSlips(data.slips);
    setRiskProfile(data.riskProfile);
    if (data.budgetKurus) setBudgetInput(kurusToInput(data.budgetKurus));
    setEditingId(null);
    setResult(null);
  };

  const handleClear = () => {
    setSelections([]);
    setSlips([]);
    setBudgetInput(DEFAULT_BUDGET);
    setEditingId(null);
    setResult(null);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Kupon Planlayıcı</h1>
        <p className="mt-1 text-slate-400">
          Seçimlerini ekle, bütçeni belirle; bütçenin kuponlara en uygun dağılımını gör, maç sonuçlarını işaretleyip kâr/zararını takip et.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <main className="min-w-0 space-y-6">
          <SelectionForm editing={editing} onSubmit={handleSubmit} onCancelEdit={() => setEditingId(null)} />
          <SelectionList
            selections={selections}
            editingId={editingId}
            usedInSlips={usedInSlips}
            onEdit={setEditingId}
            onDelete={handleDelete}
            onSetResult={handleSetResult}
          />
        </main>

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-6 lg:self-start">
          <BudgetInput value={budgetInput} onChange={setBudgetInput} />
          <section className="card space-y-3">
            <RiskSelector value={riskProfile} onChange={setRiskProfile} />
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Toplam seçim" value={selections.length} />
              <Stat label="Geçerli seçim" value={validCount} />
              <Stat label="Sonuç bekleyen" value={openSelections.length} />
              <Stat label="Toplam bütçe" value={validBudget ? formatTL(validBudget) : '—'} />
            </div>
            <button className="btn-primary w-full py-3 text-base" onClick={handleCalculate} disabled={openSelections.length === 0}>
              Kuponları öner
            </button>
            {openSelections.length === 0 && (
              <p className="text-xs text-slate-400">Öneri için sonucu bekleyen en az bir seçim ekleyin.</p>
            )}
          </section>
          <DataActions data={{ budgetKurus: validBudget, selections, slips, riskProfile }} onImport={handleImport} onClear={handleClear} />
        </aside>
      </div>

      {result && (
        <div className="mt-8">
          <Recommendation
            result={result}
            runId={runId}
            stale={calculatedKey !== dataKey}
            saved={!!result.plan && savedKey === `${runId}:${result.plan.id}`}
            selections={selections}
            onUpdatePlan={handleUpdatePlan}
            onSave={handleSave}
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
