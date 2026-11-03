import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { MatchSelection } from '../../types';
import { Autocomplete, type AutocompleteOption } from '../../components/Autocomplete';
import { MARKETS, QUICK_MARKETS, quickPick } from '../../data/markets';
import { TEAMS } from '../../data/teams';
import { normalizeSearch, searchItems } from '../../lib/search';
import { EMPTY_DRAFT, splitMatchName, validateDraft, type DraftErrors, type SelectionDraft } from '../../lib/validation';

type Props = {
  editing: MatchSelection | null;
  /** Daha önce girilmiş takım adları (listede olmasalar da aramada çıkar). */
  knownTeams: string[];
  onSubmit: (value: Omit<MatchSelection, 'id'>) => void;
  onCancelEdit: () => void;
};

const TEAM_ITEMS = TEAMS.map((t) => ({ value: t.name, aliases: t.aliases, hint: t.league }));
const MARKET_ITEMS = MARKETS.map((m) => ({ value: m.value, aliases: m.aliases, hint: m.player ? 'Oyuncu özel' : m.group, player: m.player }));
const POPULAR_MARKETS = MARKET_ITEMS.filter((m) => MARKETS.find((x) => x.value === m.value)?.popular);

function toDraft(s: MatchSelection): SelectionDraft {
  const { home, away } = splitMatchName(s.matchName);
  return {
    homeTeam: home,
    awayTeam: away,
    marketSelection: s.marketSelection,
    odds: String(s.odds).replace('.', ','),
    minMatches: String(s.minMatches),
    confidence: String(s.confidence),
    note: s.note ?? '',
  };
}

const toOption = (item: { value: string; hint?: string }): AutocompleteOption => ({ value: item.value, hint: item.hint });

export function SelectionForm({ editing, knownTeams, onSubmit, onCancelEdit }: Props) {
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
    onSubmit(result.value);
    if (!editing) {
      // Hızlı giriş: min. maç ve güven değerleri bir sonraki seçim için korunur.
      setDraft((d) => ({ ...EMPTY_DRAFT, minMatches: d.minMatches, confidence: d.confidence }));
      firstInput.current?.focus();
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

      <div className="grid items-start gap-3 sm:grid-cols-[1fr_auto_1fr]">
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
      </div>

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

      <div className="grid grid-cols-3 gap-3">
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
      <p id="min-matches-help" className="-mt-1 text-xs leading-relaxed text-slate-400">
        <strong className="text-slate-300">Min. maç:</strong> Bu seçim yalnızca en az bu sayıda seçim içeren bir
        kuponda/kolonda kullanılabilir. Örneğin 2 girilirse tekli oynanamaz; sistem kuponunda bu koşula uymayan kolonlar
        plandan çıkarılır. <strong className="text-slate-300">Güven:</strong> 7 girersen “%70 tutar” diye düşündüğün kabul edilir.
      </p>

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
