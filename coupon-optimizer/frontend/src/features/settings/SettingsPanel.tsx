import { useState, type ReactNode } from 'react';
import type { AnalysisSettings, RiskProfile } from '../../types';
import { DEFAULT_SETTINGS, STRATEGIES, STRATEGY_ORDER } from '../../engine/config';
import { kurusToInput, parseIntegerInput, parseMoneyToKurus } from '../../lib/money';

type Props = {
  settings: AnalysisSettings;
  onChange: (settings: AnalysisSettings) => void;
};

/** Gelişmiş ayarlar: boş bırakılan alanlar "sınır yok / strateji varsayılanı" anlamına gelir. */
export function SettingsPanel({ settings, onChange }: Props) {
  const set = <K extends keyof AnalysisSettings>(key: K, value: AnalysisSettings[K]) => onChange({ ...settings, [key]: value });

  return (
    <section className="card space-y-3">
      <fieldset>
        <legend className="label">Öne çıkarılacak strateji (isteğe bağlı)</legend>
        <div className="grid grid-cols-4 gap-1 rounded-lg border border-slate-700 bg-slate-950 p-1">
          {[null, ...STRATEGY_ORDER].map((key) => (
            <button
              key={key ?? 'none'}
              type="button"
              aria-pressed={settings.preferredStrategy === key}
              onClick={() => set('preferredStrategy', key as RiskProfile | null)}
              className={`rounded-md px-1 py-1.5 text-xs font-semibold transition ${
                settings.preferredStrategy === key ? 'bg-sky-500 text-slate-950' : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              {key ? STRATEGIES[key].label : 'Hepsi'}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-400">Analiz her zaman üç stratejiyi de hesaplar; seçtiğin strateji öne çıkarılır.</p>
      </fieldset>

      <details className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
        <summary className="cursor-pointer select-none text-sm font-medium text-slate-300">Gelişmiş ayarlar</summary>
        <div className="mt-3 space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <Toggle label="Normal kupon" checked={settings.allowNormal} onChange={(v) => set('allowNormal', v)} />
            <Toggle label="Sistem kuponu" checked={settings.allowSystem} onChange={(v) => set('allowSystem', v)} />
          </div>
          {!settings.allowNormal && !settings.allowSystem && (
            <p className="field-error">En az bir kupon türü açık olmalı; aksi halde yalnızca “kupon oluşturmama” değerlendirilir.</p>
          )}
          <MoneyField
            label="En fazla kayıp (TL)"
            hint="En kötü senaryoda kaybedilebilecek tutar. Boş: bütçe ve strateji sınırı."
            value={settings.maxLossKurus}
            onChange={(v) => set('maxLossKurus', v)}
          />
          <div className="grid grid-cols-2 gap-2">
            <PercentField
              label="Tek seçim maruziyeti (%)"
              hint={`Boş: strateji varsayılanı (${STRATEGY_ORDER.map((k) => `${STRATEGIES[k].label} %${STRATEGIES[k].maxSelectionExposurePct}`).join(', ')}).`}
              value={settings.maxSelectionExposurePct}
              onChange={(v) => set('maxSelectionExposurePct', v)}
            />
            <PercentField
              label="Tek maç maruziyeti (%)"
              hint="Bir maç kaybederse etkilenecek tutarın bütçeye oranı üst sınırı. Boş: strateji varsayılanı."
              value={settings.maxMatchExposurePct}
              onChange={(v) => set('maxMatchExposurePct', v)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <MoneyField
              label="Kolon başı en az (TL)"
              hint="Platformunun kuralına göre gir; varsayılan platform limiti uydurulmaz."
              value={settings.minColumnStakeKurus}
              onChange={(v) => set('minColumnStakeKurus', v)}
            />
            <MoneyField
              label="Kolon başı en fazla (TL)"
              hint="Platformunun kuralına göre; boş: sınır yok."
              value={settings.maxColumnStakeKurus}
              onChange={(v) => set('maxColumnStakeKurus', v)}
            />
          </div>
          <MoneyField
            label="Sistem kuponu en az (TL)"
            hint={`Varsayılan ${kurusToInput(DEFAULT_SETTINGS.minSystemStakeKurus)} TL. Normal kupon en az 50 TL'dir.`}
            value={settings.minSystemStakeKurus}
            required
            onChange={(v) => set('minSystemStakeKurus', v ?? DEFAULT_SETTINGS.minSystemStakeKurus)}
          />
          <div className="grid grid-cols-2 gap-2">
            <IntField
              label="Simülasyon sayısı"
              hint="Tam sayım mümkün değilse kullanılan Monte Carlo simülasyon sayısı (1.000–200.000)."
              value={settings.simulationCount}
              min={1000}
              max={200_000}
              onChange={(v) => set('simulationCount', v)}
            />
            <IntField
              label="Tohum (seed)"
              hint="Aynı girdi + aynı tohum = aynı sonuç."
              value={settings.seed}
              min={0}
              max={2 ** 31 - 1}
              onChange={(v) => set('seed', v)}
            />
          </div>
          <button type="button" className="btn-ghost text-xs" onClick={() => onChange({ ...DEFAULT_SETTINGS, preferredStrategy: settings.preferredStrategy })}>
            Varsayılanlara dön
          </button>
        </div>
      </details>
    </section>
  );
}

function FieldShell({ label, hint, error, children }: { label: string; hint: string; error: string | null; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="label text-xs">{label}</span>
      {children}
      {error ? <span className="field-error block">{error}</span> : <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{hint}</span>}
    </label>
  );
}

function MoneyField({ label, hint, value, required, onChange }: { label: string; hint: string; value: number | null; required?: boolean; onChange: (v: number | null) => void }) {
  const [text, setText] = useState(value === null ? '' : kurusToInput(value));
  const [error, setError] = useState<string | null>(null);
  const commit = () => {
    if (!text.trim()) {
      if (required) setError('Bu alan boş bırakılamaz.');
      else {
        setError(null);
        onChange(null);
      }
      return;
    }
    const k = parseMoneyToKurus(text);
    if (k === null || k <= 0) return setError('Geçerli bir TL tutarı girin.');
    setError(null);
    onChange(k);
  };
  return (
    <FieldShell label={label} hint={hint} error={error}>
      <input inputMode="decimal" className={`input py-1.5 ${error ? 'input-error' : ''}`} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} placeholder="Boş: sınır yok" />
    </FieldShell>
  );
}

function PercentField({ label, hint, value, onChange }: { label: string; hint: string; value: number | null; onChange: (v: number | null) => void }) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const [error, setError] = useState<string | null>(null);
  const commit = () => {
    if (!text.trim()) {
      setError(null);
      return onChange(null);
    }
    const v = Number(text.replace(',', '.').replace('%', ''));
    if (!Number.isFinite(v) || v <= 0 || v > 100) return setError('1 ile 100 arasında bir yüzde girin.');
    setError(null);
    onChange(v);
  };
  return (
    <FieldShell label={label} hint={hint} error={error}>
      <input inputMode="decimal" className={`input py-1.5 ${error ? 'input-error' : ''}`} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} placeholder="Varsayılan" />
    </FieldShell>
  );
}

function IntField({ label, hint, value, min, max, onChange }: { label: string; hint: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  const [error, setError] = useState<string | null>(null);
  const commit = () => {
    const v = parseIntegerInput(text);
    if (v === null || v < min || v > max) return setError(`${min.toLocaleString('tr-TR')} ile ${max.toLocaleString('tr-TR')} arasında bir tam sayı girin.`);
    setError(null);
    onChange(v);
  };
  return (
    <FieldShell label={label} hint={hint} error={error}>
      <input inputMode="numeric" className={`input py-1.5 ${error ? 'input-error' : ''}`} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} />
    </FieldShell>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-800 px-2 py-1.5 text-sm">
      <input type="checkbox" className="accent-sky-500" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
