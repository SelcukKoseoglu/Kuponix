import { useMemo } from 'react';
import type { MatchSelection, OptimizationResult, Plan, PlanStats } from '../../types';
import { Stat } from '../../components/Stat';
import { formatTL } from '../../lib/money';
import { RISK_LABELS, evaluatePlan } from '../../lib/probability';
import { PartSummary } from './PartSummary';
import { PlanDetails } from './PlanDetails';

type Props = {
  result: OptimizationResult;
  runId: number;
  stale: boolean;
  saved: boolean;
  selections: MatchSelection[];
  onUpdatePlan: (plan: Plan) => void;
  onSave: (plan: Plan) => void;
};

const pct = (p: number) => `%${Math.round(p * 100)}`;

export function Recommendation({ result, runId, stale, saved, selections, onUpdatePlan, onSave }: Props) {
  const selectionsById = useMemo(() => new Map(selections.map((s) => [s.id, s])), [selections]);
  const plan = result.plan;
  const stats = useMemo(
    () => (plan ? evaluatePlan(plan, selections, result.riskProfile) : null),
    [plan, selections, result.riskProfile],
  );

  return (
    <section className="space-y-4" aria-live="polite">
      <div>
        <h2 className="text-xl font-semibold">Önerilen kuponlar</h2>
        <p className="text-sm text-slate-400">
          {formatTL(result.budgetKurus)} bütçe, {result.usedPoolSize} maç, risk tercihi: {RISK_LABELS[result.riskProfile].title}.
        </p>
      </div>

      {stale && (
        <p className="rounded-lg border border-sky-800 bg-sky-950/40 px-3 py-2 text-sm text-sky-200">
          Seçimler, bütçe veya risk tercihi son hesaplamadan sonra değişti. Güncel öneri için yeniden hesaplayın.
        </p>
      )}

      {result.notes.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm text-slate-300">
          {result.notes.map((note, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden className="text-slate-500">
                •
              </span>
              <span>{note}</span>
            </li>
          ))}
        </ul>
      )}

      {!plan || !stats ? (
        <div className="card text-center">
          <p className="text-lg font-semibold">Öneri oluşturulamadı</p>
          <p className="mt-1 text-sm text-slate-400">
            Yukarıdaki açıklamalara göre bütçeyi, seçimleri veya minimum maç değerlerini gözden geçirebilirsiniz.
          </p>
        </div>
      ) : (
        <article className="card space-y-4" key={runId}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-slate-300">{plan.description}</p>
              {plan.edited && <p className="mt-1 text-xs text-slate-400">Tutarları sen düzenledin.</p>}
            </div>
            <button className="btn-primary" onClick={() => onSave(plan)} disabled={saved}>
              {saved ? 'Kaydedildi ✓' : 'Bu kuponları oynadım, kaydet'}
            </button>
          </div>

          <StatsGrid stats={stats} remainingKurus={plan.remainingKurus} />

          <div className="grid gap-3 md:grid-cols-2">
            {plan.parts.map((part, i) => (
              <PartSummary key={i} part={part} index={i} selectionsById={selectionsById} />
            ))}
          </div>

          {result.comparisons.length > 0 && <ComparisonTable recommended={stats} comparisons={result.comparisons} />}

          <PlanDetails plan={plan} selectionsById={selectionsById} onUpdate={onUpdatePlan} />

          <p className="text-xs text-slate-500">
            Olasılıklar senin güven puanlarından türetilir (7/10 → %70, en fazla %95) ve maçlar bağımsız varsayılır. Bunlar gerçek
            olasılık değildir; sonuçlar ancak tahminlerin kadar isabetlidir. Dönüşler kesinti/vergi hariç teorik brüt tutarlardır.
          </p>
        </article>
      )}
    </section>
  );
}

function StatsGrid({ stats, remainingKurus }: { stats: PlanStats; remainingKurus: number }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <Stat label="Yatırılan" value={formatTL(stats.stakeKurus)} />
      <Stat label="Beklenen dönüş*" value={formatTL(stats.expectedReturnKurus)} />
      <Stat
        label="Beklenen net*"
        value={`${stats.expectedProfitKurus >= 0 ? '+' : ''}${formatTL(stats.expectedProfitKurus)}`}
        tone={stats.expectedProfitKurus >= 0 ? 'positive' : 'default'}
      />
      <Stat label="Kârla kapatma ihtimali*" value={pct(stats.probProfit)} />
      <Stat label="Hiç dönüş alamama*" value={pct(stats.probNoReturn)} />
      <Stat label="Hepsi tutarsa" value={formatTL(stats.maxReturnKurus)} tone="muted" />
      {remainingKurus > 0 && <Stat label="Bütçeden kalan" value={formatTL(remainingKurus)} tone="muted" />}
    </div>
  );
}

function ComparisonTable({ recommended, comparisons }: { recommended: PlanStats; comparisons: OptimizationResult['comparisons'] }) {
  const rows = [{ label: 'Önerilen dağılım', stats: recommended, highlight: true }, ...comparisons.map((c) => ({ ...c, highlight: false }))];
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-200">Neden tek kupon değil? (ya da neden tek kupon?)</h3>
      <p className="mt-0.5 text-xs text-slate-400">
        Bütçenin tamamını tek kupona yatırmakla karşılaştırma. Öneri, seçtiğin risk tercihine göre “beklenen dönüş − risk” dengesi en
        iyi olan dağılımdır.
      </p>
      <div className="mt-2 divide-y divide-slate-800 rounded-lg border border-slate-800 text-xs sm:text-sm">
        <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-2 px-3 py-1.5 text-slate-400">
          <span />
          <span className="text-right">Beklenen*</span>
          <span className="text-right">Kâr ihtimali*</span>
          <span className="text-right">Sıfır dönüş*</span>
        </div>
        {rows.map((r) => (
          <div
            key={r.label}
            className={`grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-2 px-3 py-1.5 tabular-nums ${r.highlight ? 'bg-emerald-950/30 font-semibold' : ''}`}
          >
            <span className="min-w-0">{r.label}</span>
            <span className="text-right">{formatTL(r.stats.expectedReturnKurus)}</span>
            <span className="text-right">{pct(r.stats.probProfit)}</span>
            <span className="text-right">{pct(r.stats.probNoReturn)}</span>
          </div>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-slate-500">* Senin güven puanlarına göre hesaplanır.</p>
    </div>
  );
}
