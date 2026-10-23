import { useRef, useState, type ChangeEvent } from 'react';
import { parseData, serializeData, type AppData } from '../../lib/storage';

type Props = {
  data: AppData;
  onImport: (data: AppData) => void;
  onClear: () => void;
};

export function DataActions({ data, onImport, onClear }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const handleExport = () => {
    const blob = new Blob([serializeData(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kupon-planlayici-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMessage({ tone: 'ok', text: 'Veriler JSON olarak indirildi.' });
  };

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const result = parseData(await file.text());
      if (!result.ok) {
        setMessage({ tone: 'error', text: `İçe aktarılamadı: ${result.error} Mevcut verileriniz değiştirilmedi.` });
        return;
      }
      if (
        data.selections.length > 0 &&
        !window.confirm(
          `Mevcut ${data.selections.length} seçim ve ${data.slips.length} kayıtlı kupon, dosyadaki ${result.data.selections.length} seçim ve ${result.data.slips.length} kayıtlı kuponla değiştirilsin mi?`,
        )
      ) {
        return;
      }
      onImport(result.data);
      setMessage({ tone: 'ok', text: `${result.data.selections.length} seçim ve ${result.data.slips.length} kayıtlı kupon içe aktarıldı.` });
    } catch {
      setMessage({ tone: 'error', text: 'Dosya okunamadı. Mevcut verileriniz değiştirilmedi.' });
    }
  };

  const handleClear = () => {
    if (window.confirm('Tüm seçimler, bütçe ve kayıtlı kuponlar silinecek. Bu işlem geri alınamaz; önce JSON yedeği almanız önerilir. Emin misiniz?')) {
      onClear();
      setMessage({ tone: 'ok', text: 'Tüm veriler temizlendi.' });
    }
  };

  return (
    <section className="card space-y-3">
      <h2 className="text-sm font-semibold text-slate-300">Veri yedekleme</h2>
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary" onClick={handleExport}>
          JSON dışa aktar
        </button>
        <button className="btn-secondary" onClick={() => fileInput.current?.click()}>
          JSON içe aktar
        </button>
        <button className="btn-danger" onClick={handleClear}>
          Tüm verileri temizle
        </button>
        <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" onChange={handleFile} />
      </div>
      {message && (
        <p role="status" className={`text-sm ${message.tone === 'ok' ? 'text-emerald-300' : 'text-rose-300'}`}>
          {message.text}
        </p>
      )}
    </section>
  );
}
