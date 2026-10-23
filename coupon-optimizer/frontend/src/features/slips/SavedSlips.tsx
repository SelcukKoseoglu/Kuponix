import { useMemo } from 'react';
import type { MatchSelection, Plan, SavedSlip, SelectionResult } from '../../types';
import { Stat } from '../../components/Stat';
import { formatOdds, formatTL } from '../../lib/money';
import { buildPlan } from '../../lib/plan';
import { settlePlan, type PartSettlement, type PlanSettlement } from '../../lib/settlement';

type Props = {
  slips: SavedSlip[];
  selections: MatchSelection[];
  onDelete: (id: string) => void;
};

type Evaluated = { slip: SavedSlip; plan: Plan | null; settlement: PlanSettlement | null; error?: string };

const signed = (kurus: number) => `${kurus > 0 ? '+' : ''}${formatTL(kurus)}`;
const profitTone = (kurus: number) => (kurus > 0 ? 'text-emerald-300' : kurus < 0 ? 'text-rose-300' : 'text-slate-200');

const RESULT_STYLE: Record<SelectionResult, { label: string; cls: string }> = {
  pending: { label: 'Bekliyor', cls: 'bg-slate-800 text-slate-300' },
  won: { label: 'Tuttu', cls: 'bg-emerald-900/70 text-emerald-200' },
  lost: { label: 'Tutmadı', cls: 'bg-rose-900/70 text-rose-200' },
  void: { label: 'İade', cls: 'bg-amber-900/70 text-amber-200' },
};

export function SavedSlips({ slips, selections, onDelete }: Props) {
  const results = useMemo(() => new Map(selections.map((s) => [s.id, s.result ?? 'pending'])), [selections]);
  const currentIds = useMemo(() => new Set(selections.map((s) => s.id)), [selections]);

  const evaluated: Evaluated[] = useMemo(
    () =>
      [...slips]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((slip) => {
          const built = buildPlan({ strategy: 'recommended', label: 'Kayıtlı kupon', description: '', parts: slip.parts }, slip.selections, slip.budgetKurus);
          if (!built.ok) return { slip, plan: null, settlement: null, error: built.errors.join(' ') };
          const oddsById = new Map(slip.selections.map((s) => [s.id, s.odds]));
          return { slip, plan: built.plan, settlement: settlePlan(built.plan, oddsById, results) };
        }),
    [slips, results],
  );

  if (slips.length === 0) return null;

  const settled = evaluated.filter((e) => e.settlement?.isSettled);
  const open = evaluated.filter((e) => e.settlement && !e.settlement.isSettled);
  const totalStake = settled.reduce((s, e) => s + e.settlement!.stakeKurus, 0);
  const totalReturn = settled.reduce((s, e) => s + e.settlement!.settledReturnKurus, 0);
  const openStake = open.reduce((s, e) => s + e.settlement!.stakeKurus, 0);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Oynadığım kuponlar</h2>
        <p className="text-sm text-slate-400">
          Seçimler listesinde maçları “Tuttu / Tutmadı / İade” diye işaretledikçe kazanç ve kayıp burada güncellenir.
        </p>
      </div>

      <div className="card grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Sonuçlanan set" value={`${settled.length} / ${evaluated.length}`} />
        <Stat label="Yatırılan (sonuçlanan)" value={formatTL(totalStake)} />
        <Stat label="Dönüş (sonuçlanan)" value={formatTL(totalReturn)} />
        <div className="min-w-0 rounded-lg bg-slate-950/60 px-3 py-2">
          <div className="truncate text-xs text-slate-400">Net kâr / zarar</div>
          <div className={`truncate text-sm font-bold tabular-nums sm:text-base ${profitTone(totalReturn - totalStake)}`}>
            {signed(totalReturn - totalStake)}
          </div>
        </div>
        {openStake > 0 && (
          <p className="col-span-2 text-xs text-slate-400 sm:col-span-4">Devam eden setlerde {formatTL(openStake)} sonuç bekliyor.</p>
        )}
      </div>

      <div className="space-y-4">
        {evaluated.map((e) => (
          <SlipCard key={e.slip.id} item={e} results={results} currentIds={currentIds} onDelete={onDelete} />
        ))}
      </div>
    </section>
  );
}

function SlipCard({
  item,
  results,
  currentIds,
  onDelete,
}: {
  item: Evaluated;
  results: Map<string, SelectionResult>;
  currentIds: Set<string>;
  onDelete: (id: string) => void;
}) {
  const { slip, settlement, error } = item;
  const date = new Date(slip.createdAt).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
  const snapshotById = new Map(slip.selections.map((s) => [s.id, s]));

  const handleDelete = () => {
    if (window.confirm(`${date} tarihli kayıtlı kupon seti silinsin mi? Bu işlem geri alınamaz.`)) onDelete(slip.id);
  };

  return (
    <article className="card space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{date}</h3>
          <p className="text-xs text-slate-400">
            {slip.parts.length} kupon · {slip.selections.length} maç
          </p>
        </div>
        <div className="flex items-center gap-2">
          {settlement && <StatusBadge settlement={settlement} />}
          <button className="btn-ghost text-xs text-rose-300 hover:text-rose-200" onClick={handleDelete}>
            Sil
          </button>
        </div>
      </header>

      {error || !settlement ? (
        <p className="text-sm text-rose-300">Bu kayıt okunamadı: {error}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Yatırılan" value={formatTL(settlement.stakeKurus)} />
            <Stat label={settlement.isSettled ? 'Dönüş' : 'Kesinleşen dönüş'} value={formatTL(settlement.settledReturnKurus)} />
            <div className="min-w-0 rounded-lg bg-slate-950/60 px-3 py-2">
              <div className="truncate text-xs text-slate-400">{settlement.isSettled ? 'Net kâr / zarar' : 'Şu anki net'}</div>
              <div className={`truncate text-sm font-bold tabular-nums sm:text-base ${profitTone(settlement.profitKurus)}`}>
                {signed(settlement.profitKurus)}
              </div>
            </div>
            {!settlement.isSettled && <Stat label="Bekleyenler tutarsa toplam" value={formatTL(settlement.potentialReturnKurus)} tone="muted" />}
          </div>

          <ul className="space-y-2">
            {settlement.parts.map((p, i) => (
              <PartRow key={i} index={i} settlement={p} />
            ))}
          </ul>

          <div className="flex flex-wrap gap-1.5">
            {slip.selections.map((s) => {
              const r = results.get(s.id) ?? 'pending';
              const style = RESULT_STYLE[r];
              return (
                <span key={s.id} className={`max-w-full truncate rounded-md px-2 py-1 text-xs ${style.cls}`} title={style.label}>
                  {s.matchName} · {s.marketSelection} @{formatOdds(snapshotById.get(s.id)!.odds)} — {style.label}
                  {!currentIds.has(s.id) && ' (listeden silinmiş)'}
                </span>
              );
            })}
          </div>
        </>
      )}
    </article>
  );
}

function StatusBadge({ settlement }: { settlement: PlanSettlement }) {
  if (!settlement.isSettled) {
    return (
      <span className="rounded-md bg-slate-800 px-2 py-0.5 text-xs font-semibold text-slate-300">
        Devam ediyor · {settlement.pendingSelectionCount} maç bekliyor
      </span>
    );
  }
  const won = settlement.profitKurus > 0;
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${won ? 'bg-emerald-900/70 text-emerald-200' : 'bg-rose-900/70 text-rose-200'}`}>
      {won ? 'Kârla kapandı' : settlement.profitKurus === 0 ? 'Başa baş' : 'Zararla kapandı'}
    </span>
  );
}

function PartRow({ index, settlement }: { index: number; settlement: PartSettlement }) {
  const { part } = settlement;
  const status =
    settlement.status === 'pending'
      ? { label: 'Bekliyor', cls: 'text-slate-300' }
      : settlement.status === 'won'
        ? { label: 'Kazandı', cls: 'text-emerald-300' }
        : { label: 'Kaybetti', cls: 'text-rose-300' };
  return (
    <li className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="font-medium">
          Kupon {index + 1} · {part.kind === 'normal' ? `Normal (${part.selectionCount} maç)` : `${part.label} (${part.selectionCount} maç)`}
        </span>
        <span className="tabular-nums">
          {formatTL(settlement.stakeKurus)} → <span className={status.cls}>{formatTL(settlement.settledReturnKurus)}</span>{' '}
          <span className={`text-xs font-semibold ${status.cls}`}>{status.label}</span>
        </span>
      </div>
      {part.kind === 'system' && (
        <p className="mt-0.5 text-xs text-slate-400">
          {settlement.wonColumns} kazanan, {settlement.lostColumns} kaybeden, {settlement.pendingColumns} bekleyen kolon (kolon başına{' '}
          {formatTL(part.perColumnKurus)})
        </p>
      )}
    </li>
  );
}
