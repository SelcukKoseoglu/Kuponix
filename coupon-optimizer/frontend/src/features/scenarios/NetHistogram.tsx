import { useState } from 'react';
import type { HistogramBin } from '../../engine/types';
import { formatPct } from '../../lib/format';
import { formatTL } from '../../lib/money';

/**
 * Net sonuç dağılımı (histogram). Renk yönü (zarar/kâr) anlatır — ayrışan çift + nötr orta:
 * zarar #e66767, kâr #3987e5 (koyu yüzeyde doğrulandı), sıfırı içeren dilim nötr gri. Renk tek başına bilgi taşımaz:
 * lejant, araç ipucu ve tablo görünümü aynı değerleri verir.
 */
const COLORS = { loss: '#e66767', gain: '#3987e5', neutral: '#78716c' };
const W = 600;
const H = 170;
const PAD = { top: 10, bottom: 26, left: 4, right: 4 };

const kindOf = (b: HistogramBin) => (b.toKurus <= 0 ? 'loss' : b.fromKurus >= 0 ? 'gain' : 'neutral');
const kindLabel = { loss: 'Zarar', gain: 'Kâr', neutral: 'Sıfır civarı' } as const;

export function NetHistogram({ bins, title }: { bins: HistogramBin[]; title: string }) {
  const [active, setActive] = useState<number | null>(null);
  if (bins.length === 0) return <p className="text-xs text-slate-400">Dağılım: Hesaplanamadı (yatırım yok).</p>;

  const max = Math.max(...bins.map((b) => b.probability));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / bins.length;
  const barW = Math.max(2, slot - 2); // 2px yüzey boşluğu
  const radius = Math.min(4, barW / 2);
  const kinds = Array.from(new Set(bins.map(kindOf)));
  const activeBin = active !== null ? bins[active] : null;

  return (
    <figure className="space-y-2">
      <figcaption className="text-sm font-semibold text-slate-200">{title}</figcaption>
      <div className="flex flex-wrap gap-3 text-xs text-slate-300" aria-label="Lejant">
        {kinds.map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COLORS[k] }} aria-hidden />
            {kindLabel[k]}
          </span>
        ))}
      </div>
      <div className="relative">
        <div className="h-5 text-xs tabular-nums text-slate-300" aria-live="polite">
          {activeBin ? (
            <>
              <b className="text-slate-100">{formatPct(activeBin.probability)}</b>{' '}
              <span className="text-slate-400">
                olasılıkla net {formatTL(activeBin.fromKurus)} – {formatTL(activeBin.toKurus)}
              </span>
            </>
          ) : (
            <span className="text-slate-500">Bir çubuğun üzerine gel veya Tab ile odaklan.</span>
          )}
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${title}: ${bins.length} dilimlik histogram`}>
          <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} stroke="#334155" strokeWidth={1} />
          {bins.map((b, i) => {
            const h = max > 0 ? (b.probability / max) * innerH : 0;
            const x = PAD.left + i * slot + (slot - barW) / 2;
            const y = H - PAD.bottom - h;
            const r = Math.min(radius, h);
            const d =
              h <= 0
                ? ''
                : `M${x},${H - PAD.bottom} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${H - PAD.bottom} Z`;
            return (
              <g
                key={i}
                tabIndex={0}
                role="img"
                aria-label={`Net ${formatTL(b.fromKurus)} ile ${formatTL(b.toKurus)} arası: ${formatPct(b.probability)}`}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className="cursor-default outline-none"
              >
                <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={innerH} fill="transparent" />
                {d && <path d={d} fill={COLORS[kindOf(b)]} opacity={active === null || active === i ? 1 : 0.55} />}
                {active === i && <rect x={x - 1} y={PAD.top} width={barW + 2} height={innerH} fill="none" stroke="#e2e8f0" strokeWidth={1} rx={3} />}
              </g>
            );
          })}
          <text x={PAD.left} y={H - 8} fill="#94a3b8" fontSize={11}>
            {formatTL(bins[0].fromKurus)}
          </text>
          <text x={W - PAD.right} y={H - 8} fill="#94a3b8" fontSize={11} textAnchor="end">
            {formatTL(bins[bins.length - 1].toKurus)}
          </text>
        </svg>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer select-none text-slate-400">Tablo görünümü</summary>
        <table className="mt-1 w-full tabular-nums">
          <thead className="text-slate-500">
            <tr>
              <th className="text-left font-medium">Net sonuç aralığı</th>
              <th className="text-right font-medium">Olasılık</th>
            </tr>
          </thead>
          <tbody>
            {bins.map((b, i) => (
              <tr key={i} className="border-t border-slate-800">
                <td className="py-0.5 text-slate-300">
                  {formatTL(b.fromKurus)} – {formatTL(b.toKurus)} <span className="text-slate-500">({kindLabel[kindOf(b)]})</span>
                </td>
                <td className="py-0.5 text-right text-slate-200">{formatPct(b.probability)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
