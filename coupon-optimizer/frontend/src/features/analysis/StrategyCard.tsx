import type { MatchSelection } from '../../types';
import type { StrategyResult } from '../../engine/types';
import { NOT_AVAILABLE, formatPct, formatSignedTL } from '../../lib/format';
import { formatTL } from '../../lib/money';

type Props = {
  strategy: StrategyResult;
  selectionsById: Map<string, MatchSelection>;
  preferred: boolean;
  open: boolean;
  onToggle: () => void;
};

const typeTone = {
  Normal: 'bg-violet-900/60 text-violet-200',
  Sistem: 'bg-sky-900/60 text-sky-200',
  Karma: 'bg-amber-900/60 text-amber-200',
};

export function StrategyCard({ strategy: s, selectionsById, preferred, open, onToggle }: Props) {
  const p = s.portfolio;
  const m = p?.metrics;
  const systems = p?.plan.parts.filter((x) => x.kind === 'system') ?? [];
  const dependence = s.model.dependence === 'comonotonic' ? 'Aynı maç/grup: tam bağımlılık (stres)' : 'Aynı maç/grup: bağımsızlık varsayımı';
  const row = (label: string, value: string, strong = false) => (
    <div className="flex justify-between gap-2">
      <dt className="text-slate-400">{label}</dt>
      <dd className={`text-right tabular-nums ${strong ? 'font-semibold text-slate-100' : 'text-slate-200'}`}>{value}</dd>
    </div>
  );

  return (
    <article className={`card flex min-w-0 flex-col gap-3 ${preferred ? 'ring-2 ring-sky-500/70' : ''}`}>
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold">{s.label}</h3>
          {p ? (
            <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${typeTone[p.plan.couponType]}`}>{p.plan.couponType}</span>
          ) : (
            <span className="rounded-md bg-slate-800 px-2 py-0.5 text-xs font-semibold text-slate-200">Kupon oluşturmama</span>
          )}
          {preferred && <span className="text-xs text-sky-300">Tercihin</span>}
          {s.approximate && <span className="text-xs text-slate-500">yaklaşık çözüm</span>}
        </div>
        <p className="mt-1 text-xs text-slate-400">{s.description}</p>
      </header>

      {p && m ? (
        <>
          <ul className="space-y-0.5 text-xs">
            {p.plan.parts.map((part, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span className="min-w-0 truncate text-slate-200">
                  {part.kind === 'normal' ? `Normal (${part.selectionCount} maç)` : `${part.label} (${part.selectionCount} maç, ${part.columns.length} kolon)`}
                </span>
                <span className="shrink-0 tabular-nums text-slate-300">{formatTL(part.stakeKurus)}</span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-slate-500">
            Seçimler:{' '}
            {p.plan.selectionIds
              .map((id) => selectionsById.get(id))
              .filter(Boolean)
              .map((x) => `${x!.matchName} · ${x!.marketSelection}`)
              .join('; ')}
          </p>
          <dl className="space-y-0.5 text-xs">
            {row('Toplam tutar / kalan', `${formatTL(m.stakeKurus)} / ${formatTL(m.remainingKurus)}`)}
            {row('Beklenen net getiri', formatSignedTL(m.expectedNetKurus), true)}
            {row('Pozitif net olasılığı', formatPct(m.probPositive))}
            {row('Tam kayıp olasılığı', formatPct(m.probTotalLoss))}
            {row('P5 / ES %5', `${formatSignedTL(m.p5NetKurus)} / ${formatSignedTL(m.expectedShortfall5Kurus)}`)}
            {row('En yüksek seçim / maç maruziyeti', `${formatPct(p.maxSelectionExposurePct / 100)} / ${formatPct(p.maxMatchExposurePct / 100)}`)}
            {systems.length > 0 && row('Sistem formatı', systems.map((x) => (x.kind === 'system' ? `${x.label} · ${x.columns.length} kolon` : '')).join(', '))}
            {row('Optimizasyon skoru', formatSignedTL(p.scoreKurus))}
          </dl>
          {p.stress.expectedNetKurus < 0 && (
            <p className="rounded-md bg-amber-950/40 px-2 py-1 text-[11px] text-amber-200">
              Tahmin belirsizliği uyarısı: stres senaryosunda beklenen net {formatSignedTL(p.stress.expectedNetKurus)}.
            </p>
          )}
        </>
      ) : (
        <dl className="space-y-0.5 text-xs">
          {row('Önerilen', 'Kupon oluşturmama', true)}
          {row('Beklenen net getiri', p === null && s.explanations[0]?.includes('Tahmini olasılık') ? NOT_AVAILABLE : formatTL(0))}
          {row('Kayıp riski', 'Yok — bütçe korunur')}
          <p className="pt-1 text-slate-400">{s.explanations[0]}</p>
        </dl>
      )}

      <p className="text-[11px] text-slate-500">
        {dependence}. Olasılık: {s.model.probability === 'low' ? 'güven puanına göre karamsar alt değer' : 'senin tahminin'}.
      </p>
      <button type="button" className="btn-secondary mt-auto py-1.5 text-xs" aria-expanded={open} onClick={onToggle}>
        {open ? 'Detayları gizle' : 'Detayları gör'}
      </button>
    </article>
  );
}
