type StatProps = {
  label: string;
  value: string | number;
  tone?: 'default' | 'positive' | 'negative' | 'muted';
  hint?: string;
};

const toneClass = {
  default: 'text-slate-100',
  positive: 'text-emerald-300',
  negative: 'text-rose-300',
  muted: 'text-slate-400',
};

export function Stat({ label, value, tone = 'default', hint }: StatProps) {
  return (
    <div className="min-w-0 rounded-lg bg-slate-950/60 px-3 py-2" title={hint}>
      <div className="truncate text-xs text-slate-400">{label}</div>
      <div className={`truncate text-sm font-semibold tabular-nums sm:text-base ${toneClass[tone]}`}>{value}</div>
    </div>
  );
}
