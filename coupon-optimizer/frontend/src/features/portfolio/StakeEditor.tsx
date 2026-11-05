import { useState, type FormEvent } from 'react';
import type { AnalysisSettings, MatchSelection, PartInput, Plan } from '../../types';
import { buildPlan } from '../../lib/plan';
import { MIN_STAKE_KURUS, formatTL, kurusToInput, parseMoneyToKurus } from '../../lib/money';

type Props = {
  plan: Plan;
  selections: MatchSelection[];
  settings: AnalysisSettings;
  /** Yeni plan geçerliyse çağrılır; değerlendirme hatası varsa metin döner. */
  onApply: (plan: Plan) => string | null;
};

/** Kullanıcının tutarları elle değiştirmesi: aynı kurallarla (bütçe, 50 TL, kolon sınırları) doğrulanır ve yeniden hesaplanır. */
export function StakeEditor({ plan, selections, settings, onApply }: Props) {
  const [values, setValues] = useState<string[]>(() => plan.input.parts.map((p) => kurusToInput(p.kind === 'normal' ? p.stakeKurus : p.allocatedKurus)));
  const [errors, setErrors] = useState<string[]>([]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = values.map(parseMoneyToKurus);
    if (parsed.some((v) => v === null)) return setErrors(['Tutarlar geçerli TL değerleri olmalı (ör. 120 veya 75,50).']);
    const parts: PartInput[] = plan.input.parts.map((p, i) => (p.kind === 'normal' ? { ...p, stakeKurus: parsed[i]! } : { ...p, allocatedKurus: parsed[i]! }));
    const result = buildPlan({ ...plan.input, parts }, selections, plan.budgetKurus, {
      minSystemStakeKurus: settings.minSystemStakeKurus,
      minColumnStakeKurus: settings.minColumnStakeKurus,
      maxColumnStakeKurus: settings.maxColumnStakeKurus,
    });
    if (!result.ok) return setErrors(result.errors);
    const error = onApply(result.plan);
    setErrors(error ? [error] : []);
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-slate-800 p-3">
      <h5 className="text-sm font-semibold text-slate-200">Tutarları düzenle</h5>
      <p className="mt-1 text-xs text-slate-400">
        Bütçe {formatTL(plan.budgetKurus)}. Normal kupon en az {formatTL(MIN_STAKE_KURUS)}, sistem kuponu en az {formatTL(settings.minSystemStakeKurus)}.
        Metrikler aynı strateji modeliyle yeniden hesaplanır.
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {plan.input.parts.map((p, i) => (
          <label key={i} className="block">
            <span className="label text-xs">
              Kupon {i + 1}: {p.kind === 'normal' ? 'normal' : `Sistem ${p.sizes.join(',')}`} (TL)
            </span>
            <input inputMode="decimal" className="input py-1.5" value={values[i]} onChange={(e) => setValues((v) => v.map((x, j) => (j === i ? e.target.value : x)))} />
          </label>
        ))}
      </div>
      {errors.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {errors.map((err, i) => (
            <li key={i} className="field-error">
              {err}
            </li>
          ))}
        </ul>
      )}
      <button type="submit" className="btn-secondary mt-3 py-1.5 text-xs">
        Yeniden hesapla
      </button>
    </form>
  );
}
