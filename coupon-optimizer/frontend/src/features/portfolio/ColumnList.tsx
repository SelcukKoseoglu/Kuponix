import { useState } from 'react';
import type { MatchSelection, SystemCoupon } from '../../types';
import { formatOdds, formatTL } from '../../lib/money';

const PAGE = 50;

/** Sistem kolonları: sayfalı liste (çok kolonlu sistemler tek seferde ekrana yığılmaz) + dışlanan kolonlar. */
export function ColumnList({ part, selectionsById }: { part: SystemCoupon; selectionsById: Map<string, MatchSelection> }) {
  const [page, setPage] = useState(0);
  const [excludedOpen, setExcludedOpen] = useState(false);
  const pages = Math.ceil(part.columns.length / PAGE);
  const name = (id: string) => {
    const s = selectionsById.get(id);
    return s ? `${s.matchName} (${s.marketSelection})` : 'Silinmiş seçim';
  };
  const visible = part.columns.slice(page * PAGE, (page + 1) * PAGE);

  return (
    <div className="space-y-2">
      <h6 className="text-xs font-semibold text-slate-300">
        {part.label}: {part.columns.length} geçerli kolon · toplam {formatTL(part.stakeKurus)} (kolon başı {formatTL(part.perColumnKurus)}
        {part.columns.some((c) => c.stakeKurus !== part.perColumnKurus) ? ', kalan kuruşlar ilk kolonlara dağıtıldı' : ''})
      </h6>
      <ul className="space-y-1">
        {visible.map((c, i) => (
          <li key={page * PAGE + i} className="rounded-md bg-slate-900 px-2 py-1.5 text-xs">
            <div className="flex justify-between gap-2 text-slate-400">
              <span>
                Kolon {page * PAGE + i + 1} · {c.size}'li · tutar {formatTL(c.stakeKurus)}
              </span>
              <span className="tabular-nums">
                oran {formatOdds(c.combinedOdds)} → {formatTL(c.returnKurus)}
              </span>
            </div>
            <div className="break-words text-slate-200">{c.selectionIds.map(name).join(' + ')}</div>
            <div className="text-[11px] text-slate-500">Kazanma koşulu: bu kolondaki {c.size} seçimin hepsi tutmalı.</div>
          </li>
        ))}
      </ul>
      {pages > 1 && (
        <div className="flex items-center gap-2 text-xs">
          <button type="button" className="btn-ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            ‹ Önceki
          </button>
          <span className="tabular-nums text-slate-400">
            Sayfa {page + 1} / {pages}
          </span>
          <button type="button" className="btn-ghost" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
            Sonraki ›
          </button>
        </div>
      )}
      {part.excludedColumns.length > 0 && (
        <div className="rounded-md bg-amber-950/30 p-2 text-xs">
          <button type="button" className="text-amber-200 underline-offset-2 hover:underline" onClick={() => setExcludedOpen((o) => !o)}>
            Minimum maç kuralı nedeniyle dışlanan {part.excludedColumns.length} kolon {excludedOpen ? '(gizle)' : '(göster)'}
          </button>
          {excludedOpen && (
            <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto">
              {part.excludedColumns.slice(0, 200).map((c, i) => (
                <li key={i}>
                  <span className="text-slate-200">{c.selectionIds.map(name).join(' + ')}</span>
                  <span className="block text-amber-200/80">{c.reason}</span>
                </li>
              ))}
              {part.excludedColumns.length > 200 && <li className="text-slate-400">… ve {part.excludedColumns.length - 200} kolon daha</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
