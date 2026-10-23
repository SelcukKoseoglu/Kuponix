import { validateBudgetKurus } from '../lib/validation';
import { MIN_NORMAL_STAKE_KURUS, formatTL, parseMoneyToKurus } from '../lib/money';

type Props = {
  value: string;
  onChange: (value: string) => void;
};

export function BudgetInput({ value, onChange }: Props) {
  const kurus = parseMoneyToKurus(value);
  const error = validateBudgetKurus(kurus);
  return (
    <section className="card">
      <label htmlFor="budget" className="label">
        Toplam bütçe (TL)
      </label>
      <div className="relative">
        <input
          id="budget"
          inputMode="decimal"
          className={`input pr-12 text-lg font-semibold ${error ? 'input-error' : ''}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="300"
          aria-invalid={!!error}
          aria-describedby="budget-help"
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400">TL</span>
      </div>
      {error ? (
        <p className="field-error">{error}</p>
      ) : (
        <p id="budget-help" className="mt-1 text-xs text-slate-400">
          {formatTL(kurus!)} · Normal kupon için en az {formatTL(MIN_NORMAL_STAKE_KURUS)} gerekir.
        </p>
      )}
    </section>
  );
}
