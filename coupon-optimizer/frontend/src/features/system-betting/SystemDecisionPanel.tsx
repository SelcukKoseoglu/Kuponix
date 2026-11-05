import type { SystemDecision } from '../../engine/types';
import { ENGINE_CONFIG } from '../../engine/config';
import { formatPct, formatSignedTL } from '../../lib/format';
import { formatTL } from '../../lib/money';

/** Sistem mi normal mi? Karar gerekçeleri, karşılaştırma ve format tablosu (belge §7, §10). */
export function SystemDecisionPanel({ decision }: { decision: SystemDecision }) {
  const c = decision.comparison;
  const w = ENGINE_CONFIG.systemEfficiencyWeights;
  return (
    <section className="space-y-2">
      <h5 className="text-sm font-semibold text-slate-200">
        Sistem kararı: {decision.recommended ? 'sistem kuponu öneride var' : 'sistem kuponu önerilmedi'}
      </h5>
      <ul className="list-disc space-y-1 pl-5 text-xs text-slate-300">
        {decision.reasons.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
      {c && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[360px] text-xs tabular-nums">
            <caption className="mb-1 text-left text-slate-400">Sistem içeren portföy − yalnızca normal kuponlu en iyi portföy</caption>
            <tbody className="divide-y divide-slate-800">
              <Row label="Normal kupon hiç dönmezken sistemin dönüş sağlama olasılığı" value={formatPct(c.systemSavesProbability)} />
              <Row label="Beklenen net getiri farkı" value={formatSignedTL(c.expectedNetDiffKurus)} />
              <Row label="Tam kayıp olasılığı farkı" value={`${c.totalLossDiff > 0 ? '+' : ''}${(c.totalLossDiff * 100).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} puan`} />
              <Row label="P5 farkı" value={formatSignedTL(c.p5DiffKurus)} />
              <Row label="Expected Shortfall (%5) farkı" value={formatSignedTL(c.expectedShortfallDiffKurus)} />
              <Row label="En yüksek seçim maruziyeti farkı" value={`${c.maxExposureDiffPct > 0 ? '+' : ''}${c.maxExposureDiffPct.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} puan`} />
              <Row label="Belirsizlik altında (stres) beklenen net farkı" value={formatSignedTL(c.stressExpectedNetDiffKurus)} />
            </tbody>
          </table>
        </div>
      )}
      {decision.formats.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs tabular-nums">
            <caption className="mb-1 text-left text-slate-400">
              Sistem formatı karşılaştırması (aynı seçimler ve tutarla; hızlı senaryo kümesiyle yaklaşık). Verimlilik skoru =
              beklenen net/tutar×{w.expectedReturn} + ES/tutar×{w.expectedShortfall} − tam kayıp×{w.totalLoss} + kolon tutarı yeterliliği×
              {w.columnStake} − maruziyet×{w.concentration} − belirsizlik kaybı×{w.uncertainty}. Kazanma olasılığı değildir.
            </caption>
            <thead className="text-slate-500">
              <tr>
                <th className="text-left font-medium">Format</th>
                <th className="text-right font-medium">Kolon</th>
                <th className="text-right font-medium">Kolon başı</th>
                <th className="text-right font-medium">Beklenen net</th>
                <th className="text-right font-medium">Pozitif net</th>
                <th className="text-right font-medium">Tam kayıp</th>
                <th className="text-right font-medium">P5</th>
                <th className="text-right font-medium">ES %5</th>
                <th className="text-right font-medium">Verimlilik</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {decision.formats.map((f) => (
                <tr key={f.label} className={f.chosen ? 'bg-sky-950/40 font-semibold' : ''}>
                  <td className="py-1">
                    {f.label}
                    {f.chosen && <span className="ml-1 text-sky-300">(öneride)</span>}
                  </td>
                  <td className="text-right">{f.columns}</td>
                  <td className="text-right">{formatTL(f.perColumnKurus)}</td>
                  <td className="text-right">{formatSignedTL(f.expectedNetKurus)}</td>
                  <td className="text-right">{formatPct(f.probPositive)}</td>
                  <td className="text-right">{formatPct(f.probTotalLoss)}</td>
                  <td className="text-right">{formatSignedTL(f.p5NetKurus)}</td>
                  <td className="text-right">{formatSignedTL(f.expectedShortfall5Kurus)}</td>
                  <td className="text-right">{f.efficiencyScore.toLocaleString('tr-TR', { maximumFractionDigits: 3 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td className="py-1 text-slate-400">{label}</td>
      <td className="py-1 text-right text-slate-100">{value}</td>
    </tr>
  );
}
