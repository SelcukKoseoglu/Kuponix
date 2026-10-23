import type { SelectionResult } from '../../types';

const OPTIONS: { value: SelectionResult; label: string; active: string }[] = [
  { value: 'pending', label: 'Bekliyor', active: 'bg-slate-600 text-white' },
  { value: 'won', label: 'Tuttu', active: 'bg-emerald-500 text-slate-950' },
  { value: 'lost', label: 'Tutmadı', active: 'bg-rose-500 text-white' },
  { value: 'void', label: 'İade', active: 'bg-amber-400 text-slate-950' },
];

type Props = {
  value: SelectionResult | undefined;
  onChange: (value: SelectionResult) => void;
  label: string;
};

export function ResultToggle({ value = 'pending', onChange, label }: Props) {
  return (
    <div role="radiogroup" aria-label={`${label} sonucu`} className="inline-flex rounded-lg border border-slate-700 bg-slate-950 p-0.5">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2 py-1 text-xs font-semibold transition ${
            value === o.value ? o.active : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
