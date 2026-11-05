import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { MatchSelection } from '../../types';
import { Autocomplete, type AutocompleteOption } from '../../components/Autocomplete';
import { MARKETS, QUICK_MARKETS, quickPick } from '../../data/markets';
import { TEAMS } from '../../data/teams';
import { normalizeSearch, searchItems } from '../../lib/search';
import { formatPct, formatReturn } from '../../lib/format';
import { parseDecimalInput } from '../../lib/money';
import {
  EMPTY_DRAFT,
  parsePercentInput,
  splitMatchName,
  validateDraft,
  type DraftErrors,
  type SelectionDraft,
} from '../../lib/validation';

export type MatchOption = { matchId: string; matchName: string; count: number };

type Props = {
  editing: MatchSelection | null;
  /** Daha önce girilmiş takım adları (listede olmasalar da aramada çıkar). */
  knownTeams: string[];
  /** Listede kayıtlı maçlar: aynı maça seçim eklemek için. */
  matches: MatchOption[];
  /** "Bu maça seçim ekle" ile seçilen maç. */
  presetMatchId: string | null;
  /** matchId: mevcut maç; null: yeni maç. */
  onSubmit: (value: Omit<MatchSelection, 'id' | 'matchId'>, matchId: string | null) => void;
  onCancelEdit: () => void;
  onClearPreset: () => void;
};

const TEAM_ITEMS = TEAMS.map((t) => ({ value: t.name, aliases: t.aliases, hint: t.league }));
const MARKET_ITEMS = MARKETS.map((m) => ({ value: m.value, aliases: m.aliases, hint: m.player ? 'Oyuncu özel' : m.group, player: m.player }));
const POPULAR_MARKETS = MARKET_ITEMS.filter((m) => MARKETS.find((x) => x.value === m.value)?.popular);

function toDraft(s: MatchSelection): SelectionDraft {
  const { home, away } = splitMatchName(s.matchName);
  return {
    matchId: s.matchId,
    homeTeam: home,
    awayTeam: away,
    marketSelection: s.marketSelection,
    odds: String(s.odds).replace('.', ','),
    minMatches: String(s.minMatches),
    confidence: String(s.confidence),
    estimatedProbability:
      s.estimatedProbability !== undefined ? String(Math.round(s.estimatedProbability * 10000) / 100).replace('.', ',') : '',
    correlationGroup: s.correlationGroup ?? '',
    note: s.note ?? '',
  };
}

function draftForMatch(match: MatchOption | undefined, base: SelectionDraft): SelectionDraft {
  if (!match) return { ...base, matchId: '' };
  const { home, away } = splitMatchName(match.matchName);
  return { ...base, matchId: match.matchId, homeTeam: home, awayTeam: away };
}

const toOption = (item: { value: string; hint?: string }): AutocompleteOption => ({ value: item.value, hint: item.hint });

export function SelectionForm({ editing, knownTeams, matches, presetMatchId, onSubmit, onCancelEdit, onClearPreset }: Props) {
  const [draft, setDraft] = useState<SelectionDraft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [combine, setCombine] = useState(false);
  const firstInput = useRef<HTMLInputElement>(null);
  const marketInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(editing ? toDraft(editing) : EMPTY_DRAFT);
    setErrors({});
    if (editing) firstInput.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!presetMatchId || editing) return;
    setDraft((d) => draftForMatch(matches.find((m) => m.matchId === presetMatchId), d));
    setErrors({});
    marketInput.current?.focus();
    onClearPreset();
  }, [presetMatchId, editing, matches, onClearPreset]);

  const linkedMatch = matches.find((m) => m.matchId === draft.matchId);
  const odds = parseDecimalInput(draft.odds);
  const probability = parsePercentInput(draft.estimatedProbability);
  const preview =
    odds && odds > 1
      ? { implied: 1 / odds, ev: typeof probability === 'number' && probability > 0 && probability < 1 ? probability * odds - 1 : null }
      : null;

  const teamItems = useMemo(() => {
    const listed = new Set(TEAM_ITEMS.flatMap((t) => [t.value, ...(t.aliases ?? [])]).map(normalizeSearch));
    const history = Array.from(new Set(knownTeams.map((n) => n.trim()).filter(Boolean)))
      .filter((n) => !listed.has(normalizeSearch(n)))
      .map((value) => ({ value, hint: 'Daha önce girilen' }));
    return [...history, ...TEAM_ITEMS];
  }, [knownTeams]);

  const teamOptions = useCallback((q: string) => searchItems(teamItems, q, 8).map(toOption), [teamItems]);
  const marketOptions = useCallback(
    (q: string) => (q.trim() ? searchItems(MARKET_ITEMS, q, 12) : POPULAR_MARKETS).map(toOption),
    [],
  );

  const set = (field: keyof SelectionDraft) => (value: string) => {
    setDraft((d) => ({ ...d, [field]: value }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
  };

  const handleMarketPick = (option: AutocompleteOption) => {
    if (!MARKET_ITEMS.find((m) => m.value === option.value)?.player) return;
    // Oyuncu şablonu: imleç sona alınır, kullanıcı oyuncu adını yazar.
    requestAnimationFrame(() => {
      const el = marketInput.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const result = validateDraft(draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    onSubmit(result.value, draft.matchId || null);
    if (!editing) {
      // Hızlı giriş: aynı maç, min. maç ve güven değerleri bir sonraki seçim için korunur.
      setDraft((d) => ({ ...EMPTY_DRAFT, matchId: d.matchId, homeTeam: d.homeTeam, awayTeam: d.awayTeam, minMatches: d.minMatches, confidence: d.confidence }));
      (draft.matchId ? marketInput : firstInput).current?.focus();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="card space-y-4" noValidate>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{editing ? 'Seçimi düzenle' : 'Seçim ekle'}</h2>
        {editing && (
          <button type="button" className="btn-ghost text-xs" onClick={onCancelEdit}>
            Vazgeç
          </button>
        )}
      </div>

      {matches.length > 0 && (
        <div className="block min-w-0">
          <label htmlFor="match-picker" className="label">
            Maç
          </label>
          <select
            id="match-picker"
            className="input"
            value={draft.matchId}
            onChange={(e) => setDraft((d) => draftForMatch(matches.find((m) => m.matchId === e.target.value), { ...d, homeTeam: e.target.value ? d.homeTeam : '', awayTeam: e.target.value ? d.awayTeam : '' }))}
          >
            <option value="">Yeni maç</option>
            {matches.map((m) => (
              <option key={m.matchId} value={m.matchId}>
                {m.matchName} ({m.count} seçim)
              </option>
            ))}
          </select>
          {linkedMatch && (
            <p className="mt-1 text-xs text-sky-300">
              Bu seçim “{linkedMatch.matchName}” maçına eklenecek; aynı maçtaki seçimler birbirinden bağımsız sayılmaz.
            </p>
          )}
        </div>
      )}

      <fieldset disabled={!!linkedMatch} className="grid items-start gap-3 disabled:opacity-60 sm:grid-cols-[1fr_auto_1fr]">
        <Field label="Ev sahibi" error={errors.homeTeam}>
          <Autocomplete
            ref={firstInput}
            ariaLabel="Ev sahibi takım"
            value={draft.homeTeam}
            onChange={set('homeTeam')}
            getOptions={teamOptions}
            placeholder="Takım ara: Galatasaray, BJK…"
            invalid={!!errors.homeTeam}
          />
        </Field>
        <button
          type="button"
          className="btn-ghost mt-0 self-center sm:mt-6"
          title="Takımların yerini değiştir"
          aria-label="Ev sahibi ve deplasmanın yerini değiştir"
          onClick={() => setDraft((d) => ({ ...d, homeTeam: d.awayTeam, awayTeam: d.homeTeam }))}
        >
          ⇄
        </button>
        <Field label="Deplasman" error={errors.awayTeam}>
          <Autocomplete
            ariaLabel="Deplasman takımı"
            value={draft.awayTeam}
            onChange={set('awayTeam')}
            getOptions={teamOptions}
            placeholder="Takım ara: Fenerbahçe…"
            invalid={!!errors.awayTeam}
          />
        </Field>
      </fieldset>

      <Field label="Bahis seçimi" error={errors.marketSelection}>
        <Autocomplete
          ref={marketInput}
          ariaLabel="Bahis seçimi"
          value={draft.marketSelection}
          onChange={set('marketSelection')}
          onPick={handleMarketPick}
          getOptions={marketOptions}
          placeholder="Ara: ms1, 2.5 üst, kg var, 1 & üst, gol atar…"
          invalid={!!errors.marketSelection}
        />
      </Field>
      <div className="-mt-2 space-y-1.5" aria-label="Hızlı bahis seçimleri">
        {QUICK_MARKETS.map((group) => (
          <div key={group.label} className="flex flex-wrap items-center gap-1.5">
            <span className="w-14 shrink-0 text-[11px] uppercase tracking-wide text-slate-500">{group.label}</span>
            {group.values.map((m) => {
              const selected = draft.marketSelection.split(' & ').includes(m);
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => set('marketSelection')(quickPick(draft.marketSelection, m, combine))}
                  className={`rounded-md border px-2 py-1 text-xs font-medium transition ${
                    selected
                      ? 'border-sky-400 bg-sky-500/20 text-sky-100'
                      : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  {m}
                </button>
              );
            })}
          </div>
        ))}
        <label className="flex w-fit cursor-pointer items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" className="accent-sky-500" checked={combine} onChange={(e) => setCombine(e.target.checked)} />
          Birleştir (&amp;): tıkladıklarını tek seçimde birleştir, ör. MS 1 &amp; 4.5 Alt
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Oran" error={errors.odds}>
          <input
            inputMode="decimal"
            aria-label="Oran"
            className={`input ${errors.odds ? 'input-error' : ''}`}
            value={draft.odds}
            onChange={(e) => set('odds')(e.target.value)}
            placeholder="2,15"
          />
        </Field>
        <Field label="Tahmini olasılık (%)" error={errors.estimatedProbability}>
          <input
            inputMode="decimal"
            aria-label="Tahmini olasılık yüzde"
            aria-describedby="probability-help"
            className={`input ${errors.estimatedProbability ? 'input-error' : ''}`}
            value={draft.estimatedProbability}
            onChange={(e) => set('estimatedProbability')(e.target.value)}
            placeholder="ör. 55"
          />
        </Field>
        <Field label="Min. maç" error={errors.minMatches}>
          <input
            inputMode="numeric"
            aria-label="Minimum maç sayısı"
            className={`input ${errors.minMatches ? 'input-error' : ''}`}
            value={draft.minMatches}
            onChange={(e) => set('minMatches')(e.target.value)}
            aria-describedby="min-matches-help"
          />
        </Field>
        <Field label="Güven (1–10)" error={errors.confidence}>
          <input
            inputMode="numeric"
            aria-label="Güven puanı"
            className={`input ${errors.confidence ? 'input-error' : ''}`}
            value={draft.confidence}
            onChange={(e) => set('confidence')(e.target.value)}
          />
        </Field>
      </div>
      {preview && (
        <p className="-mt-1 text-xs tabular-nums text-slate-400" aria-live="polite">
          Oranın ima ettiği olasılık: <b className="text-slate-200">{formatPct(preview.implied, 2)}</b>
          {preview.ev !== null && (
            <>
              {' '}
              · Tahminine göre EV: <b className="text-slate-200">{formatReturn(preview.ev)}</b>{' '}
              <span className="text-slate-500">(tahmine bağlıdır)</span>
            </>
          )}
        </p>
      )}
      <div id="probability-help" className="-mt-1 space-y-1 text-xs leading-relaxed text-slate-400">
        <p>
          <strong className="text-slate-300">Tahmini olasılık:</strong> Seçimin gerçekleşme ihtimaline dair senin sayısal tahminin.
          Girilmezse EV, Kelly ve olasılık tabanlı analiz bu seçim için hesaplanmaz.
        </p>
        <p>
          <strong className="text-slate-300">Güven:</strong> Bu tahmine ne kadar güvendiğin. Olasılık değildir; yalnızca stres
          senaryolarındaki belirsizlik aralığını belirler (düşük güven → daha geniş aralık).
        </p>
        <p id="min-matches-help">
          <strong className="text-slate-300">Min. maç:</strong> Bu seçim yalnızca en az bu sayıda seçim içeren bir kuponda/kolonda
          kullanılabilir. Örneğin 2 girilirse tekli oynanamaz; sistem kuponunda bu koşula uymayan kolonlar plandan çıkarılır.
        </p>
      </div>

      <details className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
        <summary className="cursor-pointer select-none text-sm font-medium text-slate-300">Gelişmiş: korelasyon grubu</summary>
        <div className="mt-2">
          <Field label="Korelasyon grubu (isteğe bağlı)" error={errors.correlationGroup}>
            <input
              aria-label="Korelasyon grubu"
              className={`input ${errors.correlationGroup ? 'input-error' : ''}`}
              value={draft.correlationGroup}
              onChange={(e) => set('correlationGroup')(e.target.value)}
              placeholder="ör. Süper Lig yağmurlu maçlar"
            />
          </Field>
          <p className="mt-1 text-xs text-slate-400">
            Farklı maçları ortak bir etken nedeniyle ilişkili sayıyorsan aynı grup adını yaz. Aynı gruptaki seçimler aynı kupona
            konmaz; Kontrollü strateji ve stres metrikleri onları birlikte kaybedecekmiş gibi değerlendirir.
          </p>
        </div>
      </details>

      <Field label="Not (isteğe bağlı)" error={errors.note}>
        <input
          aria-label="Not"
          className={`input ${errors.note ? 'input-error' : ''}`}
          value={draft.note}
          onChange={(e) => set('note')(e.target.value)}
          placeholder="Ör. sakat oyuncu var"
        />
      </Field>

      <button type="submit" className="btn-primary w-full sm:w-auto">
        {editing ? 'Değişiklikleri kaydet' : 'Seçimi ekle'}
      </button>
    </form>
  );
}

/** Etiket <label> değil <div>: öneri listesine tıklamak, etiket üzerinden alanı yeniden açmasın. */
function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <div className="block min-w-0">
      <span className="label" aria-hidden>
        {label}
      </span>
      {children}
      {error && <span className="field-error block">{error}</span>}
    </div>
  );
}
