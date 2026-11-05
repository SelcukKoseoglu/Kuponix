import { useMemo } from 'react';
import type { AnalysisSettings, MatchSelection, Plan } from '../../types';
import type { Alternative, PortfolioEvaluation, RiskMetrics, StrategyResult } from '../../engine/types';
import { Stat } from '../../components/Stat';
import { formatPct, formatSignedTL, formatTLOrNA, toneOf } from '../../lib/format';
import { formatTL } from '../../lib/money';
import { PartSummary } from '../plans/PartSummary';
import { ExposureTable } from '../risk/ExposureTable';
import { NetHistogram } from '../scenarios/NetHistogram';
import { SystemDecisionPanel } from '../system-betting/SystemDecisionPanel';
import { ColumnList } from './ColumnList';
import { StakeEditor } from './StakeEditor';

type Props = {
  strategy: StrategyResult;
  budgetKurus: number;
  selections: MatchSelection[];
  settings: AnalysisSettings;
  saved: boolean;
  onSave: (plan: Plan) => void;
  onApplyStakes: (plan: Plan) => string | null;
};

export function PortfolioDetails({ strategy, budgetKurus, selections, settings, saved, onSave, onApplyStakes }: Props) {
  const selectionsById = useMemo(() => new Map(selections.map((s) => [s.id, s])), [selections]);
  const p = strategy.portfolio;

  return (
    <article className="card space-y-5" aria-label={`${strategy.label} stratejisi detayları`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{strategy.label} — detaylar</h3>
          <p className="text-sm text-slate-400">{strategy.description}</p>
        </div>
        {p && (
          <button className="btn-primary" onClick={() => onSave(p.plan)} disabled={saved}>
            {saved ? 'Kaydedildi ✓' : 'Bu kuponları oynadım, kaydet'}
          </button>
        )}
      </header>

      <section>
        <h4 className="text-sm font-semibold text-slate-200">Neden bu {p ? 'portföy' : 'sonuç'}?</h4>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-300">
          {strategy.explanations.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
        {strategy.warnings.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-amber-200">
            {strategy.warnings.map((w, i) => (
              <li key={i}>⚠ {w}</li>
            ))}
          </ul>
        )}
        {strategy.approximate && (
          <p className="mt-2 text-xs text-slate-400">
            Yaklaşık çözüm: büyük kupon/sistemler tüm kombinasyonlar yerine sıralama önekleriyle aranır ve/veya örnek senaryolar
            kullanılır; sonuç kesin optimum olarak sunulmaz.
          </p>
        )}
      </section>

      {p && (
        <>
          <MetricsGrid metrics={p.metrics} stress={p.stress} score={p.scoreKurus} />
          <section className="grid gap-3 md:grid-cols-2">
            {p.plan.parts.map((part, i) => (
              <PartSummary key={i} part={part} index={i} selectionsById={selectionsById} />
            ))}
          </section>
          {p.plan.parts.some((x) => x.kind === 'system') && (
            <section className="space-y-3">
              <h4 className="text-sm font-semibold text-slate-200">Sistem kolonları</h4>
              {p.plan.parts.map((part, i) => (part.kind === 'system' ? <ColumnList key={i} part={part} selectionsById={selectionsById} /> : null))}
            </section>
          )}
          <section className="grid gap-4 md:grid-cols-2">
            <ExposureTable title="Seçim başına maruziyet" rows={p.exposures.selections} limitPct={strategy.limits.maxSelectionExposurePct} />
            <ExposureTable title="Maç başına maruziyet" rows={p.exposures.matches} limitPct={strategy.limits.maxMatchExposurePct} />
          </section>
          <SharedSelections portfolio={p} />
          <NetHistogram bins={p.metrics.histogram} title="Net sonuç dağılımı (strateji modeli)" />
        </>
      )}

      <AlternativesTable alternatives={strategy.alternatives} budgetKurus={budgetKurus} />
      <SystemDecisionPanel decision={strategy.systemDecision} />
      {p && <StakeEditor key={p.plan.id} plan={p.plan} selections={selections} settings={settings} onApply={onApplyStakes} />}
    </article>
  );
}

function MetricsGrid({ metrics: m, stress, score }: { metrics: RiskMetrics; stress: RiskMetrics; score: number }) {
  return (
    <section className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Toplam tutar" value={formatTL(m.stakeKurus)} />
        <Stat label="Kalan bütçe" value={formatTL(m.remainingKurus)} tone="muted" />
        <Stat label="Beklenen brüt dönüş" value={formatTL(m.expectedGrossKurus)} />
        <Stat label="Beklenen net getiri" value={formatSignedTL(m.expectedNetKurus)} tone={toneOf(m.expectedNetKurus)} />
        <Stat label="Pozitif net olasılığı" value={formatPct(m.probPositive)} />
        <Stat label="Negatif net olasılığı" value={formatPct(m.probNegative)} />
        <Stat label="Tam kayıp olasılığı" value={formatPct(m.probTotalLoss)} />
        <Stat label="Optimizasyon skoru" value={formatSignedTL(score)} hint="Strateji faydasının kesinlik eşdeğeri net getirisi; kazanma olasılığı değildir." />
        <Stat label="P5 net sonuç" value={formatSignedTL(m.p5NetKurus)} tone={toneOf(m.p5NetKurus)} />
        <Stat label="Expected Shortfall %5" value={formatSignedTL(m.expectedShortfall5Kurus)} tone={toneOf(m.expectedShortfall5Kurus)} hint="En kötü %5'lik senaryoların ortalama net sonucu (negatif = kayıp)" />
        <Stat label="Ortalama kayıp (zarar senaryoları)" value={formatTLOrNA(m.averageLossKurus)} />
        <Stat label="En iyi / en kötü net" value={`${formatSignedTL(m.maxNetKurus)} / ${formatSignedTL(m.worstNetKurus)}`} />
      </div>
      <p className="text-xs text-slate-400">
        Stres senaryosu (karamsar tahmin + aynı maç tam bağımlılık): beklenen net {formatSignedTL(stress.expectedNetKurus)}, tam kayıp{' '}
        {formatPct(stress.probTotalLoss)}, P5 {formatSignedTL(stress.p5NetKurus)}.{' '}
        {m.method.kind === 'exact'
          ? `Tam sayım: ${m.method.scenarios.toLocaleString('tr-TR')} senaryo.`
          : `Monte Carlo: ${m.method.simulations.toLocaleString('tr-TR')} simülasyon, tohum ${m.method.seed}${m.expectedNetStdErrorKurus !== null ? `, beklenen net ±${formatTL(Math.round(1.96 * m.expectedNetStdErrorKurus))} (%95)` : ''}.`}
      </p>
    </section>
  );
}

function SharedSelections({ portfolio }: { portfolio: PortfolioEvaluation }) {
  const shared = portfolio.exposures.selections.filter((r) => r.couponCount > 1);
  if (shared.length === 0) {
    return <p className="text-xs text-slate-400">Kuponlar arasında ortak seçim yok.</p>;
  }
  return (
    <p className="text-xs text-amber-200">
      Kuponlar arasındaki ortak seçimler: {shared.map((r) => `${r.label} (${r.couponCount} kupon)`).join(', ')}. Bu seçim kaybederse
      ilgili kuponların hepsi birlikte etkilenir.
    </p>
  );
}

function AlternativesTable({ alternatives, budgetKurus }: { alternatives: Alternative[]; budgetKurus: number }) {
  return (
    <section className="overflow-x-auto">
      <h4 className="text-sm font-semibold text-slate-200">Alternatifler (aynı bütçe ve tahminlerle)</h4>
      <table className="mt-1 w-full min-w-[640px] text-xs tabular-nums">
        <thead className="text-slate-500">
          <tr>
            <th className="text-left font-medium">Alternatif</th>
            <th className="text-right font-medium">Tutar</th>
            <th className="text-right font-medium">Beklenen net</th>
            <th className="text-right font-medium">Pozitif net</th>
            <th className="text-right font-medium">Tam kayıp</th>
            <th className="text-right font-medium">P5</th>
            <th className="text-right font-medium">ES %5</th>
            <th className="text-right font-medium">Skor</th>
            <th className="text-right font-medium">Pareto</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {alternatives.map((a, i) => {
            const m = a.evaluation?.metrics;
            const none = a.kind === 'none';
            return (
              <tr key={i}>
                <td className="py-1 text-slate-200">
                  {a.label}
                  {a.evaluation && <span className="text-slate-500"> · {a.evaluation.plan.couponType}</span>}
                  {!a.evaluation && !none && <span className="block text-[11px] text-slate-500">{a.unavailableReason}</span>}
                </td>
                <td className="text-right">{none ? formatTL(0) : formatTLOrNA(m?.stakeKurus)}</td>
                <td className="text-right">{none ? formatTL(0) : formatSignedTL(m?.expectedNetKurus)}</td>
                <td className="text-right">{none ? '—' : formatPct(m?.probPositive)}</td>
                <td className="text-right">{none ? '%0,0' : formatPct(m?.probTotalLoss)}</td>
                <td className="text-right">{none ? formatTL(0) : formatSignedTL(m?.p5NetKurus)}</td>
                <td className="text-right">{none ? formatTL(0) : formatSignedTL(m?.expectedShortfall5Kurus)}</td>
                <td className="text-right">{none ? formatTL(0) : a.evaluation ? formatSignedTL(a.scoreKurus) : '—'}</td>
                <td className="text-right">{a.evaluation || none ? (a.paretoOptimal ? 'Evet' : 'Hayır') : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-slate-500">
        Pareto: beklenen net, P5, ES ve tam kayıp olasılığında aynı anda daha iyi (en az biri kesin) başka bir alternatif yoksa “Evet”.
        Skor tüm dağılımı dikkate aldığı için Pareto dışı bir alternatif yine de en yüksek skoru alabilir. Bütçe: {formatTL(budgetKurus)}.
      </p>
    </section>
  );
}
