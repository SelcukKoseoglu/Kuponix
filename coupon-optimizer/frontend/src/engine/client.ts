/**
 * Analizi arayüzü dondurmadan bir Web Worker'da çalıştırır; zaman aşımı ve hata yönetimi içerir.
 * Tarayıcı modül worker'ı desteklemiyorsa aynı hesap ana iş parçacığında yapılır.
 */
import { analyze, type AnalyzeInput } from './analyze';
import { ENGINE_CONFIG } from './config';
import type { AnalysisResult } from './types';

type WorkerReply = { ok: true; result: AnalysisResult } | { ok: false; error: string };

export function runAnalysis(input: AnalyzeInput): Promise<AnalysisResult> {
  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  if (!worker) {
    return new Promise((resolve, reject) =>
      setTimeout(() => {
        try {
          resolve(analyze(input));
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }, 0),
    );
  }
  const active = worker;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      active.terminate();
      reject(new Error('Analiz zaman aşımına uğradı. Seçim sayısını veya simülasyon sayısını azaltıp tekrar deneyin.'));
    }, ENGINE_CONFIG.workerTimeoutMs);
    active.onmessage = (event: MessageEvent<WorkerReply>) => {
      clearTimeout(timer);
      active.terminate();
      if (event.data.ok) resolve(event.data.result);
      else reject(new Error(`Analiz sırasında hata: ${event.data.error}`));
    };
    active.onerror = (event) => {
      clearTimeout(timer);
      active.terminate();
      reject(new Error(`Analiz başlatılamadı: ${event.message || 'bilinmeyen hata'}`));
    };
    active.postMessage(input);
  });
}
