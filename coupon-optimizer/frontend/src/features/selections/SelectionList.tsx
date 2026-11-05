import { useMemo, useState } from 'react';
import type { JointProbability, MatchSelection, SelectionResult } from '../../types';
import { analyzeSelection } from '../../engine/selectionAnalyzer';
import { validateJointProbability } from '../../engine/correlation';
import { NEEDS_ESTIMATE, formatPct, formatPoints, formatReturn } from '../../lib/format';
import { formatOdds } from '../../lib/money';
import { parsePercentInput } from '../../lib/validation';
import { ResultToggle } from './ResultToggle';

type Props = {
  selections: MatchSelection[];
  joints: JointProbability[];
  editingId: string | null;
  /** Kayıtlı kuponlarda kullanılan seçim kimlikleri (silmeden önce uyarı için). */
  usedInSlips: Set<string>;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onSetResult: (id: string, result: SelectionResult) => void;
  onAddToMatch: (matchId: string) => void;
  onSetJoint: (selectionIds: [string, string], probability: number | null) => void;
};

export function SelectionList({ selections, joints, editingId, usedInSlips, onEdit, onDelete, onSetResult, onAddToMatch, onSetJoint }: Props) {
  const groups = useMemo(() => {
    const map = new Map<string, MatchSelection[]>();
    selections.forEach((s) => map.set(s.matchId, [...(map.get(s.matchId) ?? []), s]));
    return Array.from(map.entries());
  }, [selections]);

  if (selections.length === 0) {
    return (
      <section className="card text-center text-sm text-slate-400">
        Henüz seçim eklenmedi. Yukarıdaki formdan maç ve bahis seçimlerinizi ekleyin.
      </section>
    );
  }

  const confirmDelete = (s: MatchSelection) => {
    const warning = usedInSlips.has(s.id) ? '\n\nBu seçim kayıtlı kuponlarında kullanılıyor; silinirse o kuponlarda sonucu "bekliyor" görünür.' : '';
    if (window.confirm(`"${s.matchName} – ${s.marketSelection}" seçimi silinsin mi?${warning}`)) onDelete(s.id);
  };
  const decided = selections.filter((s) => (s.result ?? 'pending') !== 'pending').length;
  const missing = selections.filter((s) => s.estimatedProbability === undefined && (s.result ?? 'pending') === 'pending').length;

  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">
          Maçlar ve seçimler ({groups.length} maç, {selections.length} seçim)
        </h2>
        <p className="text-xs text-slate-400">
          {decided} seçim sonuçlandı{missing > 0 ? ` · ${missing} seçimde tahmin gerekli` : ''}. Sonucu işaretlenen seçimler analize alınmaz.
        </p>
      </div>

      {groups.map(([matchId, items]) => (
        <div key={matchId} className="rounded-lg border border-slate-800 bg-slate-950/40">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
            <div className="min-w-0">
              <div className="truncate font-semibold">{items[0].matchName}</div>
              {items.length > 1 && (
                <div className="text-xs text-amber-200/90">
                  Aynı maçta {items.length} seçim: birbirinden bağımsız sayılmaz, aynı kupona konmaz.
                </div>
              )}
            </div>
            <button type="button" className="btn-ghost text-xs" onClick={() => onAddToMatch(matchId)}>
              + Bu maça seçim ekle
            </button>
          </div>

          <ul className="divide-y divide-slate-800/70">
            {items.map((s) => (
              <SelectionRow
                key={s.id}
                selection={s}
                editing={editingId === s.id}
                onEdit={() => onEdit(s.id)}
                onDelete={() => confirmDelete(s)}
                onSetResult={(r) => onSetResult(s.id, r)}
              />
            ))}
          </ul>

          {items.length === 2 && <JointInput items={[items[0], items[1]]} joints={joints} onSetJoint={onSetJoint} />}
        </div>
      ))}
    </section>
  );
}

function SelectionRow({
  selection: s,
  editing,
  onEdit,
  onDelete,
  onSetResult,
}: {
  selection: MatchSelection;
  editing: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onSetResult: (r: SelectionResult) => void;
}) {
  const a = analyzeSelection(s);
  const needs = a.estimatedProbability === null;
  return (
    <li className={`px-3 py-2.5 ${editing ? 'bg-sky-950/40' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{s.marketSelection}</div>
          {(s.note || s.correlationGroup) && (
            <div className="truncate text-xs text-slate-400">
              {s.correlationGroup && <span className="mr-2 rounded bg-slate-800 px-1.5 py-0.5">Grup: {s.correlationGroup}</span>}
              {s.note}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button className="btn-ghost text-xs" onClick={onEdit}>
            Düzenle
          </button>
          <button className="btn-ghost text-xs text-rose-300 hover:text-rose-200" onClick={onDelete}>
            Sil
          </button>
        </div>
      </div>

      <dl className="mt-1.5 grid grid-cols-3 gap-x-3 gap-y-1 text-xs sm:grid-cols-6">
        <Metric label="Oran" value={formatOdds(s.odds)} />
        <Metric label="İma edilen" value={formatPct(a.impliedProbability)} hint="1 / oran; marjdan arındırılmamış ham olasılık" />
        <Metric label="Tahmin" value={needs ? NEEDS_ESTIMATE : formatPct(a.estimatedProbability)} warn={needs} />
        <Metric label="Edge" value={formatPoints(a.edge)} warn={needs} hint="Tahmini − ima edilen olasılık" />
        <Metric label="EV" value={formatReturn(a.ev)} warn={needs} hint="Tahmini olasılık doğruysa 1 TL başına beklenen net getiri" />
        <Metric label="Güven · Min." value={`${s.confidence}/10 · ${s.minMatches}`} hint="Güven puanı olasılık değildir" />
      </dl>
      {a.kellyStatus !== 'unavailable' && (
        <p className="mt-1 text-[11px] text-slate-500">
          {a.kellyStatus === 'positive'
            ? `Kelly (referans): tam ${formatPct(a.kellyFraction)} · çeyrek ${formatPct(a.referenceKelly)} — tekil bahis için teorik değer, portföy önerisi değildir.`
            : 'Kelly ≤ 0: bu tahminle tekil bahis için stake önerisi yok.'}
          {a.probabilityRange &&
            ` Belirsizlik aralığı (kalibre edilmemiş): ${formatPct(a.probabilityRange.low)} – ${formatPct(a.probabilityRange.high)}, EV ${formatReturn(a.evLow)} … ${formatReturn(a.evHigh)}.`}
        </p>
      )}
      <div className="mt-2">
        <ResultToggle value={s.result} onChange={onSetResult} label={`${s.matchName} ${s.marketSelection}`} />
      </div>
    </li>
  );
}

function Metric({ label, value, warn, hint }: { label: string; value: string; warn?: boolean; hint?: string }) {
  return (
    <div className="min-w-0" title={hint}>
      <dt className="text-slate-500">{label}</dt>
      <dd className={`truncate tabular-nums ${warn ? 'text-amber-300' : 'text-slate-200'}`}>{value}</dd>
    </div>
  );
}

function JointInput({
  items,
  joints,
  onSetJoint,
}: {
  items: [MatchSelection, MatchSelection];
  joints: JointProbability[];
  onSetJoint: (ids: [string, string], p: number | null) => void;
}) {
  const ids: [string, string] = [items[0].id, items[1].id];
  const current = joints.find((j) => j.selectionIds.includes(ids[0]) && j.selectionIds.includes(ids[1]));
  const [value, setValue] = useState(current ? String(Math.round(current.probability * 10000) / 100).replace('.', ',') : '');
  const [error, setError] = useState<string | null>(null);
  const [pa, pb] = items.map((s) => s.estimatedProbability);
  if (pa === undefined || pb === undefined) return null;

  const commit = () => {
    const parsed = parsePercentInput(value);
    if (parsed === undefined) {
      setError(null);
      onSetJoint(ids, null);
      return;
    }
    if (parsed === null) {
      setError('Yüzde olarak yazın (ör. 30).');
      return;
    }
    const err = validateJointProbability(pa, pb, parsed);
    setError(err);
    if (!err) onSetJoint(ids, parsed);
  };

  return (
    <details className="border-t border-slate-800 px-3 py-2" open={!!current}>
      <summary className="cursor-pointer select-none text-xs font-medium text-slate-300">
        Gelişmiş: iki seçimin birlikte gerçekleşme olasılığı {current ? `(${value}%)` : '(girilmedi)'}
      </summary>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="label text-xs">Birlikte tutma olasılığı (%)</span>
          <input
            inputMode="decimal"
            className={`input w-32 py-1.5 ${error ? 'input-error' : ''}`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={commit}
            placeholder="ör. 30"
          />
        </label>
        <p className="min-w-0 flex-1 text-xs text-slate-400">
          Girilirse bu iki seçimin ortak dağılımı bununla kurulur; girilmezse Dengeli/Agresif bağımsızlık, Kontrollü tam bağımlılık
          varsayar. Geçerli aralık: {formatPct(Math.max(0, pa + pb - 1))} – {formatPct(Math.min(pa, pb))}.
        </p>
      </div>
      {error && <p className="field-error mt-1">{error}</p>}
    </details>
  );
}
