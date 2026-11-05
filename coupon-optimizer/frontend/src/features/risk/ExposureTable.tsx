import type { ExposureRow } from '../../engine/types';
import { formatPct } from '../../lib/format';
import { formatTL } from '../../lib/money';

/** Seçim/maç maruziyeti: kaybederse etkilenen tutar ve bütçeye oranı. Çubuk uzunluğu yalnızca bütçe oranını gösterir. */
export function ExposureTable({ title, rows, limitPct }: { title: string; rows: ExposureRow[]; limitPct: number }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h5 className="text-sm font-semibold text-slate-200">{title}</h5>
      <p className="text-xs text-slate-500">Sınır: bütçeye oranla %{limitPct}. Aynı seçimin farklı kuponlarda tekrarı bağımsız fırsat değildir.</p>
      <ul className="mt-1.5 space-y-1.5">
        {rows.map((r) => (
          <li key={r.key} className="text-xs">
            <div className="flex justify-between gap-2">
              <span className="min-w-0 truncate text-slate-200" title={r.label}>
                {r.label}
              </span>
              <span className="shrink-0 tabular-nums text-slate-300">
                {formatTL(r.exposedStakeKurus)} · {formatPct(r.budgetPct / 100)} · {r.couponCount} kupon / {r.columnCount} kolon
              </span>
            </div>
            <div className="mt-0.5 h-1.5 rounded-full bg-slate-800" aria-hidden>
              <div className="h-1.5 rounded-full bg-sky-500" style={{ width: `${Math.min(100, r.budgetPct)}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
