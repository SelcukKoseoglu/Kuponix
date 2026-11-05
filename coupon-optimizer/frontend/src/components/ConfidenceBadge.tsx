/** Öznel güven puanı rozeti (olasılık değildir). */
export function ConfidenceBadge({ value }: { value: number }) {
  const tone = value >= 8 ? 'bg-emerald-900/60 text-emerald-200' : value >= 5 ? 'bg-sky-900/60 text-sky-200' : 'bg-slate-800 text-slate-300';
  return (
    <span className={`inline-flex shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums ${tone}`} title="Öznel güven puanı (olasılık değildir)">
      {value}/10
    </span>
  );
}
