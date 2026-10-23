import { useState, type FormEvent } from 'react';
import type { MatchSelection, PartInput, Plan } from '../../types';
import { buildPlan } from '../../lib/plan';
import { MIN_NORMAL_STAKE_KURUS, formatNumber, formatOdds, formatTL, kurusToInput, parseMoneyToKurus } from '../../lib/money';

type Props = {
  plan: Plan;
  selectionsById: Map<string, MatchSelection>;
  onUpdate: (plan: Plan) => void;
};

export function PlanDetails({ plan, selectionsById, onUpdate }: Props) {
  const name = (id: string) => {
    const s = selectionsById.get(id);
    return s ? `${s.matchName} (${s.marketSelection})` : 'Silinmiş seçim';
  };

  return (
    <details className="group rounded-lg border border-slate-800 bg-slate-950/40">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold text-sky-300 hover:text-sky-200">
        Detayları gör
      </summary>
      <div className="space-y-4 border-t border-slate-800 p-3 text-sm">
        <section>
          <h5 className="font-semibold text-slate-200">Öneri nasıl oluşturuldu?</h5>
          <p className="mt-1 text-slate-400">
            1–4 maçlık normal kuponlar ve 3–5 maçlık tüm geçerli sistem kuponları aday olarak üretildi. Her maçın tutma ihtimali senin
            güven puanından alındı (7/10 → %70). Bütçe {formatTL(plan.budgetKurus)} küçük birimlere bölünüp “beklenen dönüş − risk ×
            dalgalanma” hedefini en çok artıran kuponlara dağıtıldı (en fazla 4 kupon, normal kupon en az 50 TL). Aynı maçı paylaşan
            kuponların birlikte kazanıp kaybettiği hesaba katıldı.
          </p>
          <p className="mt-1 text-slate-400">
            Ortalama güven: <b className="text-slate-200">{formatNumber(plan.avgConfidence)}</b> · En düşük güven:{' '}
            <b className="text-slate-200">{plan.minConfidence}</b> · Toplam kolon: <b className="text-slate-200">{plan.columnCount}</b>
          </p>
        </section>

        {plan.parts.map((part, i) =>
          part.kind === 'normal' ? (
            <section key={i}>
              <h5 className="font-semibold text-slate-200">Normal kupon</h5>
              <p className="mt-1 text-slate-400">
                Teorik brüt dönüş = {formatTL(part.stakeKurus)} ×{' '}
                {part.selectionIds.map((id) => formatOdds(selectionsById.get(id)?.odds ?? 0)).join(' × ')} ={' '}
                <b className="text-slate-200">{formatTL(part.grossReturnKurus)}</b>
              </p>
            </section>
          ) : (
            <section key={i}>
              <h5 className="font-semibold text-slate-200">
                {part.label}: {part.columns.length} geçerli kolon × {formatTL(part.perColumnKurus)}
              </h5>
              <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto pr-1">
                {part.columns.map((c, ci) => (
                  <li key={ci} className="rounded-md bg-slate-900 px-2 py-1.5">
                    <div className="flex justify-between gap-2 text-xs text-slate-400">
                      <span>
                        Kolon {ci + 1} · {c.size}'li
                      </span>
                      <span className="tabular-nums">
                        oran {formatOdds(c.combinedOdds)} → {formatTL(c.returnKurus)}
                      </span>
                    </div>
                    <div className="break-words text-xs text-slate-200">{c.selectionIds.map(name).join(' + ')}</div>
                  </li>
                ))}
              </ul>
              {part.excludedColumns.length > 0 && (
                <>
                  <h6 className="mt-3 font-semibold text-amber-200">Çıkarılan kolonlar ({part.excludedColumns.length})</h6>
                  <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto pr-1 text-xs">
                    {part.excludedColumns.map((c, ci) => (
                      <li key={ci} className="rounded-md bg-amber-950/30 px-2 py-1.5">
                        <div className="break-words text-slate-200">{c.selectionIds.map(name).join(' + ')}</div>
                        <div className="text-amber-200/80">{c.reason}</div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          ),
        )}

        <StakeEditor plan={plan} selections={Array.from(selectionsById.values())} onUpdate={onUpdate} />
      </div>
    </details>
  );
}

function StakeEditor({ plan, selections, onUpdate }: { plan: Plan; selections: MatchSelection[]; onUpdate: (p: Plan) => void }) {
  const initial = () => plan.input.parts.map((p) => kurusToInput(p.kind === 'normal' ? p.stakeKurus : p.allocatedKurus));
  const [values, setValues] = useState<string[]>(initial);
  const [errors, setErrors] = useState<string[]>([]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = values.map(parseMoneyToKurus);
    if (parsed.some((v) => v === null)) {
      setErrors(['Tutarlar geçerli TL değerleri olmalı (ör. 120 veya 75,50).']);
      return;
    }
    const parts: PartInput[] = plan.input.parts.map((p, i) =>
      p.kind === 'normal' ? { ...p, stakeKurus: parsed[i]! } : { ...p, allocatedKurus: parsed[i]! },
    );
    const result = buildPlan({ ...plan.input, parts }, selections, plan.budgetKurus);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors([]);
    onUpdate({ ...result.plan, edited: true });
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-slate-800 p-3">
      <h5 className="font-semibold text-slate-200">Tutarları düzenle</h5>
      <p className="mt-1 text-xs text-slate-400">
        Bütçe: {formatTL(plan.budgetKurus)}. Normal kupon en az {formatTL(MIN_NORMAL_STAKE_KURUS)}; sistem tutarı geçerli kolonlara
        bölünür ve kolon başına tutar kuruşa aşağı yuvarlanır.
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {plan.input.parts.map((p, i) => (
          <label key={i} className="block">
            <span className="label text-xs">{p.kind === 'normal' ? 'Normal kupon tutarı (TL)' : 'Sistem kuponu tutarı (TL)'}</span>
            <input
              inputMode="decimal"
              className="input py-1.5"
              value={values[i]}
              onChange={(e) => setValues((v) => v.map((x, j) => (j === i ? e.target.value : x)))}
            />
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
