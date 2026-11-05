import { useMemo } from 'react';
import type { AnalysisSettings, MatchSelection, Plan, RiskProfile } from '../../types';
import type { AnalysisResult } from '../../engine/types';
import { Stat } from '../../components/Stat';
import { formatTL } from '../../lib/money';
import { PortfolioDetails } from '../portfolio/PortfolioDetails';
import { StrategyCard } from './StrategyCard';

type Props = {
  result: AnalysisResult;
  stale: boolean;
  selections: MatchSelection[];
  settings: AnalysisSettings;
  openStrategy: RiskProfile | null;
  onOpenStrategy: (s: RiskProfile | null) => void;
  savedPlanIds: Set<string>;
  onSave: (strategy: RiskProfile, plan: Plan) => void;
  onApplyStakes: (strategy: RiskProfile, plan: Plan) => string | null;
};

export function AnalysisView({ result, stale, selections, settings, openStrategy, onOpenStrategy, savedPlanIds, onSave, onApplyStakes }: Props) {
  const selectionsById = useMemo(() => new Map(selections.map((s) => [s.id, s])), [selections]);
  const s = result.summary;
  const open = result.strategies.find((x) => x.strategy === openStrategy) ?? null;
  const allNone = result.strategies.every((x) => x.recommendation === 'none');

  return (
    <section className="space-y-4" aria-live="polite">
      <div>
        <h2 className="text-xl font-semibold">Analiz</h2>
        <p className="text-sm text-slate-400">
          {formatTL(result.budgetKurus)} bütçe · {result.durationMs.toLocaleString('tr-TR')} ms. Hiçbir alternatif kazanç garantisi değildir.
        </p>
      </div>

      {stale && (
        <p className="rounded-lg border border-sky-800 bg-sky-950/40 px-3 py-2 text-sm text-sky-200">
          Seçimler, bütçe veya ayarlar analizden sonra değişti. Güncel sonuçlar için yeniden analiz edin.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Toplam seçim" value={s.totalSelections} />
        <Stat label="Tahmini olasılığı girilmiş" value={`${s.withProbability} / ${s.pendingSelections}`} tone={s.withProbability < s.pendingSelections ? 'negative' : 'default'} />
        <Stat label="Pozitif / negatif Edge" value={`${s.positiveEdge} / ${s.negativeEdge}`} />
        <Stat label="Maç grubu (çok seçimli)" value={`${s.matchGroups} (${s.multiSelectionMatchGroups})`} />
        <Stat label="Bütçe" value={formatTL(s.budgetKurus)} />
        <Stat label="Analize alınan seçim" value={s.usedInPool} />
        <Stat label="Geçerli kupon adayı" value={s.validCandidates.toLocaleString('tr-TR')} />
        <Stat label="Korelasyon grubu" value={s.customGroups} tone="muted" />
      </div>

      {s.warnings.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-800/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
          {s.warnings.map((w, i) => (
            <li key={i}>⚠ {w}</li>
          ))}
        </ul>
      )}

      {allNone && (
        <p className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-200">
          Hiçbir strateji, girilen tahminlerle kupon oluşturmamaya göre daha iyi bir sonuç bulamadı. <b>Kupon oluşturmama</b> öne çıkan
          alternatiftir.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {result.strategies.map((st) => (
          <StrategyCard
            key={st.strategy}
            strategy={st}
            selectionsById={selectionsById}
            preferred={settings.preferredStrategy === st.strategy}
            open={openStrategy === st.strategy}
            onToggle={() => onOpenStrategy(openStrategy === st.strategy ? null : st.strategy)}
          />
        ))}
        <article className="card flex flex-col gap-2">
          <h3 className="text-base font-semibold">Kupon oluşturmama</h3>
          <p className="text-xs text-slate-400">Her zaman geçerli bir alternatif: hiçbir tutar riske girmez.</p>
          <dl className="space-y-0.5 text-xs">
            <div className="flex justify-between">
              <dt className="text-slate-400">Toplam tutar / kalan</dt>
              <dd className="tabular-nums">
                {formatTL(0)} / {formatTL(result.budgetKurus)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">Beklenen net getiri</dt>
              <dd className="tabular-nums">{formatTL(0)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">Tam kayıp olasılığı</dt>
              <dd className="tabular-nums">%0,0</dd>
            </div>
          </dl>
          <p className="mt-auto text-xs text-slate-400">
            Önerildiği stratejiler:{' '}
            {result.strategies.filter((x) => x.recommendation === 'none').map((x) => x.label).join(', ') || 'yok'}.
          </p>
        </article>
      </div>

      {open && (
        <PortfolioDetails
          strategy={open}
          budgetKurus={result.budgetKurus}
          selections={selections}
          settings={settings}
          saved={!!open.portfolio && savedPlanIds.has(`${open.strategy}:${open.portfolio.plan.id}`)}
          onSave={(plan) => onSave(open.strategy, plan)}
          onApplyStakes={(plan) => onApplyStakes(open.strategy, plan)}
        />
      )}

      <details className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm">
        <summary className="cursor-pointer select-none font-medium text-slate-300">Varsayımlar ve yöntem</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-400">
          {result.assumptions.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
