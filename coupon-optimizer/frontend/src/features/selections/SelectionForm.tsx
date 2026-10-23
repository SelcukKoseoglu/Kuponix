import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { MatchSelection } from '../../types';
import { EMPTY_DRAFT, validateDraft, type DraftErrors, type SelectionDraft } from '../../lib/validation';

type Props = {
  editing: MatchSelection | null;
  onSubmit: (value: Omit<MatchSelection, 'id'>) => void;
  onCancelEdit: () => void;
};

function toDraft(s: MatchSelection): SelectionDraft {
  return {
    matchName: s.matchName,
    marketSelection: s.marketSelection,
    odds: String(s.odds).replace('.', ','),
    minMatches: String(s.minMatches),
    confidence: String(s.confidence),
    note: s.note ?? '',
  };
}

export function SelectionForm({ editing, onSubmit, onCancelEdit }: Props) {
  const [draft, setDraft] = useState<SelectionDraft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<DraftErrors>({});
  const firstInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(editing ? toDraft(editing) : EMPTY_DRAFT);
    setErrors({});
    if (editing) firstInput.current?.focus();
  }, [editing]);

  const set = (field: keyof SelectionDraft) => (value: string) => {
    setDraft((d) => ({ ...d, [field]: value }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
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

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Maç" error={errors.matchName}>
          <input
            ref={firstInput}
            className={`input ${errors.matchName ? 'input-error' : ''}`}
            value={draft.matchName}
            onChange={(e) => set('matchName')(e.target.value)}
            placeholder="BJK - CRY"
          />
        </Field>
        <Field label="Bahis seçimi" error={errors.marketSelection}>
          <input
            className={`input ${errors.marketSelection ? 'input-error' : ''}`}
            value={draft.marketSelection}
            onChange={(e) => set('marketSelection')(e.target.value)}
            placeholder="İlk Yarı 0, 2.5 Alt, MS 1…"
          />
        </Field>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Oran" error={errors.odds}>
          <input
            inputMode="decimal"
            className={`input ${errors.odds ? 'input-error' : ''}`}
            value={draft.odds}
            onChange={(e) => set('odds')(e.target.value)}
            placeholder="2,15"
          />
        </Field>
        <Field label="Min. maç" error={errors.minMatches}>
          <input
            inputMode="numeric"
            className={`input ${errors.minMatches ? 'input-error' : ''}`}
            value={draft.minMatches}
            onChange={(e) => set('minMatches')(e.target.value)}
            aria-describedby="min-matches-help"
          />
        </Field>
        <Field label="Güven (1–10)" error={errors.confidence}>
          <input
            inputMode="numeric"
            className={`input ${errors.confidence ? 'input-error' : ''}`}
            value={draft.confidence}
            onChange={(e) => set('confidence')(e.target.value)}
          />
        </Field>
      </div>
      <p id="min-matches-help" className="-mt-1 text-xs leading-relaxed text-slate-400">
        <strong className="text-slate-300">Min. maç:</strong> Bu seçim yalnızca en az bu sayıda seçim içeren bir
        kuponda/kolonda kullanılabilir. Örneğin 2 girilirse tekli oynanamaz; sistem kuponunda bu koşula uymayan kolonlar
        plandan çıkarılır. <strong className="text-slate-300">Güven</strong> sizin öznel puanınızdır, olasılık değildir.
      </p>

      <Field label="Not (isteğe bağlı)" error={errors.note}>
        <input
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

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="label">{label}</span>
      {children}
      {error && <span className="field-error block">{error}</span>}
    </label>
  );
}
