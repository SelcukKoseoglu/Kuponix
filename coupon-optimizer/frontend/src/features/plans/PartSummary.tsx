import type { CouponPart, SelectionSnapshot, SystemCoupon } from '../../types';
import { formatOdds, formatTL } from '../../lib/money';
import { ConfidenceBadge } from '../selections/SelectionList';

type Props = {
  part: CouponPart;
  index: number;
  selectionsById: Map<string, SelectionSnapshot>;
};

export function PartSummary({ part, index, selectionsById }: Props) {
  const isNormal = part.kind === 'normal';
  return (
    <div
      className={`min-w-0 rounded-lg border p-3 text-sm ${
        isNormal ? 'border-violet-900/60 bg-violet-950/20' : 'border-sky-900/60 bg-sky-950/20'
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className={`font-semibold ${isNormal ? 'text-violet-200' : 'text-sky-200'}`}>
          Kupon {index + 1} · {isNormal ? 'Normal' : part.label} · {part.selectionCount} maç
        </div>
        <div className="text-base font-bold tabular-nums">{formatTL(part.stakeKurus)}</div>
      </div>

      <ul className="mt-2 space-y-1">
        {part.selectionIds.map((id) => {
          const s = selectionsById.get(id);
          if (!s) return null;
          return (
            <li key={id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">
                {s.matchName} <span className="text-slate-400">· {s.marketSelection}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2 tabular-nums">
                <span className="text-slate-300">{formatOdds(s.odds)}</span>
                <ConfidenceBadge value={s.confidence} />
              </span>
            </li>
          );
        })}
      </ul>

      {part.kind === 'normal' ? (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-slate-800 pt-2">
          <dt className="text-slate-400">Kombine oran</dt>
          <dd className="text-right tabular-nums">{formatOdds(part.combinedOdds)}</dd>
          <dt className="text-slate-400">Hepsi tutarsa dönüş</dt>
          <dd className="text-right tabular-nums">{formatTL(part.grossReturnKurus)}</dd>
        </dl>
      ) : (
        <SystemFacts part={part} />
      )}
    </div>
  );
}

function SystemFacts({ part }: { part: SystemCoupon }) {
  const odds = part.columns.map((c) => c.combinedOdds);
  const rows = part.scenarios.filter((s, i, all) => s.maxReturnKurus > 0 || (i > 0 && all[i - 1].maxReturnKurus > 0));
  return (
    <div className="mt-2 border-t border-slate-800 pt-2">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
        <dt className="text-slate-400">Kolon × kolon başına</dt>
        <dd className="text-right tabular-nums">
          {part.columns.length} × {formatTL(part.perColumnKurus)}
        </dd>
        <dt className="text-slate-400">Kolon oranları</dt>
        <dd className="text-right tabular-nums">
          {formatOdds(Math.min(...odds))} – {formatOdds(Math.max(...odds))}
        </dd>
      </dl>
      {part.excludedColumns.length > 0 && (
        <p className="mt-2 rounded-md bg-amber-950/40 px-2 py-1.5 text-xs text-amber-200">
          Minimum maç koşulu nedeniyle {part.excludedColumns.length} kolon çıkarıldı; tutar kalan {part.columns.length} kolona bölündü.
        </p>
      )}
      <div className="mt-2 divide-y divide-slate-800 text-xs">
        {rows.map((s) => (
          <div key={s.losers} className="grid grid-cols-[1fr_auto] gap-2 py-1">
            <span className="text-slate-300">{s.losers === 0 ? 'Hepsi tutarsa' : `${s.losers} maç yatarsa`}</span>
            <span className="text-right tabular-nums">
              {s.minReturnKurus === s.maxReturnKurus
                ? formatTL(s.maxReturnKurus)
                : `${formatTL(s.minReturnKurus)} – ${formatTL(s.maxReturnKurus)}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
