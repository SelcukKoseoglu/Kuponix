import type { RiskProfile } from '../types';
import { RISK_LABELS } from '../lib/probability';

const ORDER: RiskProfile[] = ['cautious', 'balanced', 'aggressive'];

type Props = {
  value: RiskProfile;
  onChange: (value: RiskProfile) => void;
};

export function RiskSelector({ value, onChange }: Props) {
  return (
    <fieldset>
      <legend className="label">Risk tercihi</legend>
      <div className="grid grid-cols-3 gap-1 rounded-lg border border-slate-700 bg-slate-950 p-1">
        {ORDER.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={value === key}
            onClick={() => onChange(key)}
            className={`rounded-md px-1 py-1.5 text-xs font-semibold leading-tight transition ${
              value === key ? 'bg-sky-500 text-slate-950' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            {key === 'aggressive' ? 'Maks. kâr' : RISK_LABELS[key].title}
          </button>
        ))}
      </div>
      <p className="mt-1 text-xs text-slate-400">{RISK_LABELS[value].description}</p>
    </fieldset>
  );
}
