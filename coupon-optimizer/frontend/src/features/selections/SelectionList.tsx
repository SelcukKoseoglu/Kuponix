import type { MatchSelection, SelectionResult } from '../../types';
import { formatOdds } from '../../lib/money';
import { ResultToggle } from './ResultToggle';

type Props = {
  selections: MatchSelection[];
  editingId: string | null;
  /** Kayıtlı kuponlarda kullanılan seçim kimlikleri (silmeden önce uyarı için). */
  usedInSlips: Set<string>;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onSetResult: (id: string, result: SelectionResult) => void;
};

export function SelectionList({ selections, editingId, usedInSlips, onEdit, onDelete, onSetResult }: Props) {
  if (selections.length === 0) {
    return (
      <section className="card text-center text-sm text-slate-400">
        Henüz seçim eklenmedi. Yukarıdaki formdan maç ve bahis seçimlerinizi ekleyin.
      </section>
    );
  }

  const confirmDelete = (s: MatchSelection) => {
    const warning = usedInSlips.has(s.id)
      ? '\n\nBu seçim kayıtlı kuponlarında kullanılıyor; silinirse o kuponlarda sonucu "bekliyor" görünür.'
      : '';
    if (window.confirm(`"${s.matchName} – ${s.marketSelection}" seçimi silinsin mi?${warning}`)) onDelete(s.id);
  };

  const decided = selections.filter((s) => (s.result ?? 'pending') !== 'pending').length;

  return (
    <section className="card p-0 sm:p-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4 sm:px-5">
        <h2 className="text-lg font-semibold">Seçimler ({selections.length})</h2>
        <p className="text-xs text-slate-400">
          {decided} / {selections.length} maç sonuçlandı · Sonucu işaretlenen maçlar yeni öneriye alınmaz.
        </p>
      </div>

      {/* Geniş ekran tablo */}
      <div className="hidden lg:block">
        <table className="mt-3 w-full text-left text-sm">
          <thead className="border-y border-slate-800 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-5 py-2 font-medium">Maç / Seçim</th>
              <th className="px-2 py-2 text-right font-medium">Oran</th>
              <th className="px-2 py-2 text-right font-medium">Min.</th>
              <th className="px-2 py-2 text-right font-medium">Güven</th>
              <th className="px-2 py-2 font-medium">Sonuç</th>
              <th className="px-5 py-2 text-right font-medium">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {selections.map((s) => (
              <tr key={s.id} className={`border-b border-slate-800/70 ${editingId === s.id ? 'bg-sky-950/40' : ''}`}>
                <td className="max-w-0 px-5 py-2.5">
                  <div className="truncate font-medium">{s.matchName}</div>
                  <div className="truncate text-xs text-slate-400">
                    {s.marketSelection}
                    {s.note && <span className="text-slate-500"> · {s.note}</span>}
                  </div>
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">{formatOdds(s.odds)}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{s.minMatches}</td>
                <td className="px-2 py-2.5 text-right">
                  <ConfidenceBadge value={s.confidence} />
                </td>
                <td className="px-2 py-2.5">
                  <ResultToggle value={s.result} onChange={(r) => onSetResult(s.id, r)} label={s.matchName} />
                </td>
                <td className="whitespace-nowrap px-5 py-2.5 text-right">
                  <button className="btn-ghost text-xs" onClick={() => onEdit(s.id)}>
                    Düzenle
                  </button>
                  <button className="btn-ghost text-xs text-rose-300 hover:text-rose-200" onClick={() => confirmDelete(s)}>
                    Sil
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobil / tablet kartlar */}
      <ul className="mt-3 grid gap-2 px-4 pb-4 md:grid-cols-2 lg:hidden">
        {selections.map((s) => (
          <li
            key={s.id}
            className={`min-w-0 rounded-lg border border-slate-800 p-3 ${editingId === s.id ? 'bg-sky-950/40' : 'bg-slate-950/50'}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium">{s.matchName}</div>
                <div className="truncate text-sm text-slate-300">{s.marketSelection}</div>
              </div>
              <ConfidenceBadge value={s.confidence} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
              <span>
                Oran <b className="text-slate-100">{formatOdds(s.odds)}</b>
              </span>
              <span>
                Min. maç <b className="text-slate-100">{s.minMatches}</b>
              </span>
            </div>
            {s.note && <p className="mt-1 text-xs text-slate-400">{s.note}</p>}
            <div className="mt-2">
              <ResultToggle value={s.result} onChange={(r) => onSetResult(s.id, r)} label={s.matchName} />
            </div>
            <div className="mt-2 flex gap-2">
              <button className="btn-secondary flex-1 py-1.5 text-xs" onClick={() => onEdit(s.id)}>
                Düzenle
              </button>
              <button className="btn-danger flex-1 py-1.5 text-xs" onClick={() => confirmDelete(s)}>
                Sil
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ConfidenceBadge({ value }: { value: number }) {
  const tone = value >= 8 ? 'bg-emerald-900/60 text-emerald-200' : value >= 5 ? 'bg-sky-900/60 text-sky-200' : 'bg-slate-800 text-slate-300';
  return (
    <span className={`inline-flex shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums ${tone}`} title="Öznel güven puanı">
      {value}/10
    </span>
  );
}
