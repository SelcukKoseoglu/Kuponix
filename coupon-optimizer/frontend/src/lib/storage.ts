import type { MatchSelection, PartInput, RiskProfile, SavedSlip, SelectionSnapshot } from '../types';
import { SELECTION_RESULTS, validateSelection } from './validation';

/** Anahtar değişmez: sürüm 1 ile kaydedilmiş veriler aynen okunur ve sürüm 2'ye taşınır. */
export const STORAGE_KEY = 'kupon-planlayici:v1';
export const BACKUP_KEY_PREFIX = 'kupon-planlayici:yedek:';
export const DATA_VERSION = 2;
const SUPPORTED_VERSIONS = [1, 2];
const RISK_PROFILES: readonly RiskProfile[] = ['cautious', 'balanced', 'aggressive'];

export type AppData = {
  budgetKurus: number | null;
  selections: MatchSelection[];
  slips: SavedSlip[];
  riskProfile: RiskProfile;
};

type ExportedData = AppData & { app: 'kupon-planlayici'; version: number; exportedAt: string };

export type ParseResult = { ok: true; data: AppData } | { ok: false; error: string };

export function serializeData(data: AppData, now = new Date()): string {
  const payload: ExportedData = {
    app: 'kupon-planlayici',
    version: DATA_VERSION,
    exportedAt: now.toISOString(),
    budgetKurus: data.budgetKurus,
    riskProfile: data.riskProfile,
    selections: data.selections,
    slips: data.slips,
  };
  return JSON.stringify(payload, null, 2);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPositiveInt = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;

function parseSelection(item: unknown, label: string): { ok: true; value: MatchSelection } | { ok: false; error: string } {
  if (!isObject(item)) return { ok: false, error: `${label} bir nesne olmalı.` };
  const selection: MatchSelection = {
    id: item.id as string,
    matchName: item.matchName as string,
    marketSelection: item.marketSelection as string,
    odds: item.odds as number,
    minMatches: item.minMatches as number,
    confidence: item.confidence as number,
    ...(item.note !== undefined && item.note !== '' ? { note: item.note as string } : {}),
    ...(item.result !== undefined && item.result !== 'pending' ? { result: item.result as MatchSelection['result'] } : {}),
  };
  if (typeof selection.matchName !== 'string' || typeof selection.marketSelection !== 'string') {
    return { ok: false, error: `${label}: maç adı ve bahis seçimi metin olmalı.` };
  }
  if (item.result !== undefined && !SELECTION_RESULTS.includes(item.result as never)) {
    return { ok: false, error: `${label}: maç sonucu geçersiz.` };
  }
  const errors = validateSelection(selection);
  if (errors.length > 0) return { ok: false, error: `${label}: ${errors[0]}` };
  return { ok: true, value: selection };
}

function parsePart(item: unknown, snapshotIds: Set<string>): PartInput | null {
  if (!isObject(item) || !Array.isArray(item.selectionIds)) return null;
  const ids = item.selectionIds as unknown[];
  if (ids.length === 0 || !ids.every((id) => typeof id === 'string' && snapshotIds.has(id))) return null;
  const selectionIds = ids as string[];
  if (item.kind === 'normal' && isPositiveInt(item.stakeKurus)) return { kind: 'normal', selectionIds, stakeKurus: item.stakeKurus };
  if (item.kind === 'system' && isPositiveInt(item.allocatedKurus) && isPositiveInt(item.minSize)) {
    return { kind: 'system', selectionIds, minSize: item.minSize, allocatedKurus: item.allocatedKurus };
  }
  return null;
}

function parseSlip(item: unknown, index: number): { ok: true; value: SavedSlip } | { ok: false; error: string } {
  const label = `${index + 1}. kayıtlı kupon`;
  if (!isObject(item) || typeof item.id !== 'string' || !item.id || typeof item.createdAt !== 'string') {
    return { ok: false, error: `${label}: kimlik veya tarih eksik.` };
  }
  if (!isPositiveInt(item.budgetKurus)) return { ok: false, error: `${label}: bütçe geçersiz.` };
  if (!Array.isArray(item.selections) || !Array.isArray(item.parts) || item.parts.length === 0) {
    return { ok: false, error: `${label}: seçim veya kupon listesi eksik.` };
  }
  const selections: SelectionSnapshot[] = [];
  for (let i = 0; i < item.selections.length; i++) {
    const r = parseSelection(item.selections[i], `${label}, ${i + 1}. seçim`);
    if (!r.ok) return r;
    const { id, matchName, marketSelection, odds, minMatches, confidence } = r.value;
    selections.push({ id, matchName, marketSelection, odds, minMatches, confidence });
  }
  const ids = new Set(selections.map((s) => s.id));
  const parts: PartInput[] = [];
  for (const raw of item.parts) {
    const part = parsePart(raw, ids);
    if (!part) return { ok: false, error: `${label}: kupon bilgisi geçersiz.` };
    parts.push(part);
  }
  const riskProfile = RISK_PROFILES.includes(item.riskProfile as RiskProfile) ? (item.riskProfile as RiskProfile) : 'balanced';
  return { ok: true, value: { id: item.id, createdAt: item.createdAt, budgetKurus: item.budgetKurus, riskProfile, parts, selections } };
}

/** JSON metnini şema doğrulamasıyla okur. Sürüm 1 (sonuç ve kayıtlı kupon içermeyen) dosyalar da kabul edilir. */
export function parseData(json: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: 'Dosya geçerli bir JSON değil.' };
  }
  if (!isObject(raw)) return { ok: false, error: 'JSON kök değeri bir nesne olmalı.' };
  if (!SUPPORTED_VERSIONS.includes(raw.version as number)) {
    return { ok: false, error: `Desteklenmeyen dosya sürümü (desteklenen: ${SUPPORTED_VERSIONS.join(', ')}).` };
  }

  const budget = raw.budgetKurus;
  if (budget !== null && budget !== undefined && !isPositiveInt(budget)) {
    return { ok: false, error: 'Bütçe (budgetKurus) pozitif bir tam sayı (kuruş) olmalı.' };
  }
  if (!Array.isArray(raw.selections)) return { ok: false, error: '"selections" alanı bir liste olmalı.' };

  const ids = new Set<string>();
  const selections: MatchSelection[] = [];
  for (let i = 0; i < raw.selections.length; i++) {
    const r = parseSelection(raw.selections[i], `${i + 1}. seçim`);
    if (!r.ok) return r;
    if (ids.has(r.value.id)) return { ok: false, error: `${i + 1}. seçim: "${r.value.id}" kimliği birden fazla kez kullanılmış.` };
    ids.add(r.value.id);
    selections.push(r.value);
  }

  if (raw.slips !== undefined && !Array.isArray(raw.slips)) return { ok: false, error: '"slips" alanı bir liste olmalı.' };
  const slips: SavedSlip[] = [];
  for (let i = 0; i < ((raw.slips as unknown[] | undefined) ?? []).length; i++) {
    const r = parseSlip((raw.slips as unknown[])[i], i);
    if (!r.ok) return r;
    slips.push(r.value);
  }

  const riskProfile = RISK_PROFILES.includes(raw.riskProfile as RiskProfile) ? (raw.riskProfile as RiskProfile) : 'balanced';
  return { ok: true, data: { budgetKurus: (budget as number | null | undefined) ?? null, selections, slips, riskProfile } };
}

/**
 * Kayıtlı veriyi okur. Kayıt var ama okunamıyorsa, uygulama üzerine yazmadan önce ham metin ayrı bir
 * yedek anahtara kopyalanır; böylece kullanıcı verisi kaybolmaz.
 */
export function loadFromStorage(storage: Storage | undefined, now = Date.now()): AppData | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = parseData(raw);
    if (parsed.ok) return parsed.data;
    storage.setItem(`${BACKUP_KEY_PREFIX}${now}`, raw);
    return null;
  } catch {
    return null;
  }
}

export function saveToStorage(storage: Storage | undefined, data: AppData): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, serializeData(data));
  } catch {
    // Depolama dolu veya engelli olabilir; uygulama bellekte çalışmaya devam eder.
  }
}

export function safeLocalStorage(): Storage | undefined {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function snapshotOf(s: MatchSelection): SelectionSnapshot {
  const { id, matchName, marketSelection, odds, minMatches, confidence } = s;
  return { id, matchName, marketSelection, odds, minMatches, confidence };
}
