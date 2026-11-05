/// <reference lib="webworker" />
import { analyze, type AnalyzeInput } from './analyze';

self.onmessage = (event: MessageEvent<AnalyzeInput>) => {
  try {
    self.postMessage({ ok: true, result: analyze(event.data) });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
