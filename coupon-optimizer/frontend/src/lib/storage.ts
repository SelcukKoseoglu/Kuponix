import type { AnalysisSettings, JointProbability, MatchSelection, PartInput, RiskProfile, SavedSlip, SelectionSnapshot } from '../types';
import { DEFAULT_SETTINGS } from '../engine/config';
import { SELECTION_RESULTS, matchIdFromName, validateSelection } from './validation';

/**
 * Anahtar değişmez: sürüm 1 ve 2 ile kaydedilmiş veriler aynen okunur ve sürüm 3'e taşınır
 * (maç kimliği maç adından türetilir, eski sistem formatı "k'dan n'e" boyut listesine çevrilir).
 */
export const STORAGE_KEY = 'kupon-planlayici:v1';
export const BACKUP_KEY_PREFIX = 'kupon-planlayici:yedek:';
export const DATA_VERSION = 3;
const SUPPORTED_VERSIONS = [1, 2, 3];
const RISK_PROFILES: readonly RiskProfile[] = ['cautious', 'balanced', 'aggressive'];

export type AppData = {
  budgetKurus: number | null;
  selections: MatchSelection[];
  slips: SavedSlip[];
  settings: AnalysisSettings;
  joints: JointProbability[];
};

type ExportedData = AppData & { app: 'kuponix'; version: number; exportedAt: string };

export type ParseResult = { ok: true; data: AppData } | { ok: false; error: string };

export function serializeData(data: AppData, now = new Date()): string {
  const payload: ExportedData = {
    app: 'kuponix',
    version: DATA_VERSION,
    exportedAt: now.toISOString(),
    budgetKurus: data.budgetKurus,
    settings: data.settings,
    selections: data.selections,
    joints: data.joints,
    slips: data.slips,
  };
  return JSON.stringify(payload, null, 2);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPositiveInt = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;

function parseSelection(item: unknown, label: string): { ok: true; value: MatchSelection } | { ok: false; error: string } {
  if (!isObject(item)) return { ok: false, error: `${label} bir nesne olmalı.` };
  if (typeof item.matchName !== 'string' || typeof item.marketSelection !== 'string') {
    return { ok: false, error: `${label}: maç adı ve bahis seçimi metin olmalı.` };
  }
  if (item.result !== undefined && !SELECTION_RESULTS.includes(item.result as never)) {
    return { ok: false, error: `${label}: maç sonucu geçersiz.` };
  }
  const selection: MatchSelection = {
    id: item.id as string,
    matchId: typeof item.matchId === 'string' && item.matchId.trim() ? item.matchId : matchIdFromName(item.matchName),
    matchName: item.matchName,
    marketSelection: item.marketSelection,
    odds: item.odds as number,
    minMatches: item.minMatches as number,
    confidence: item.confidence as number,
    ...(item.estimatedProbability !== undefined && item.estimatedProbability !== null
      ? { estimatedProbability: item.estimatedProbability as number }
      : {}),
    ...(typeof item.correlationGroup === 'string' && item.correlationGroup ? { correlationGroup: item.correlationGroup } : {}),
    ...(item.note !== undefined && item.note !== '' ? { note: item.note as string } : {}),
    ...(item.result !== undefined && item.result !== 'pending' ? { result: item.result as MatchSelection['result'] } : {}),
  };
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
  if (item.kind === 'system' && isPositiveInt(item.allocatedKurus)) {
    if (Array.isArray(item.sizes) && item.sizes.length > 0 && item.sizes.every(isPositiveInt)) {
      return { kind: 'system', selectionIds, sizes: item.sizes as number[], allocatedKurus: item.allocatedKurus };
    }
    // Sürüm 1–2: "Sistem k..n" yalnızca en küçük boyutla saklanıyordu.
    if (isPositiveInt(item.minSize) && item.minSize <= selectionIds.length) {
      const sizes = Array.from({ length: selectionIds.length - item.minSize + 1 }, (_, i) => (item.minSize as number) + i);
      return { kind: 'system', selectionIds, sizes, allocatedKurus: item.allocatedKurus };
    }
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
    selections.push(snapshotOf(r.value));
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

const optionalPositiveInt = (v: unknown): number | null => (isPositiveInt(v) ? v : null);
const optionalPercent = (v: unknown): number | null => (typeof v === 'number' && v > 0 && v <= 100 ? v : null);

/** Ayarları okur; eksik/geçersiz alanlar varsayılana döner (ayarlar yüzünden veri kaybı yaşanmaz). */
function parseSettings(raw: unknown, legacyRisk: unknown): AnalysisSettings {
  const s = isObject(raw) ? raw : {};
  const preferred = RISK_PROFILES.includes(s.preferredStrategy as RiskProfile)
    ? (s.preferredStrategy as RiskProfile)
    : RISK_PROFILES.includes(legacyRisk as RiskProfile)
      ? (legacyRisk as RiskProfile)
      : null;
  return {
    allowNormal: typeof s.allowNormal === 'boolean' ? s.allowNormal : DEFAULT_SETTINGS.allowNormal,
    allowSystem: typeof s.allowSystem === 'boolean' ? s.allowSystem : DEFAULT_SETTINGS.allowSystem,
    maxLossKurus: optionalPositiveInt(s.maxLossKurus),
    maxSelectionExposurePct: optionalPercent(s.maxSelectionExposurePct),
    maxMatchExposurePct: optionalPercent(s.maxMatchExposurePct),
    minColumnStakeKurus: optionalPositiveInt(s.minColumnStakeKurus),
    maxColumnStakeKurus: optionalPositiveInt(s.maxColumnStakeKurus),
    minSystemStakeKurus: optionalPositiveInt(s.minSystemStakeKurus) ?? DEFAULT_SETTINGS.minSystemStakeKurus,
    simulationCount:
      Number.isSafeInteger(s.simulationCount) && (s.simulationCount as number) >= 1000 && (s.simulationCount as number) <= 200_000
        ? (s.simulationCount as number)
        : DEFAULT_SETTINGS.simulationCount,
    seed: Number.isSafeInteger(s.seed) ? (s.seed as number) : DEFAULT_SETTINGS.seed,
    preferredStrategy: preferred,
  };
}

/** JSON metnini şema doğrulamasıyla okur. Sürüm 1–2 dosyaları da kabul edilir ve taşınır. */
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

  if (raw.joints !== undefined && !Array.isArray(raw.joints)) return { ok: false, error: '"joints" alanı bir liste olmalı.' };
  const joints: JointProbability[] = [];
  for (const item of (raw.joints as unknown[] | undefined) ?? []) {
    if (
      !isObject(item) ||
      !Array.isArray(item.selectionIds) ||
      item.selectionIds.length !== 2 ||
      !item.selectionIds.every((id) => typeof id === 'string' && ids.has(id)) ||
      typeof item.probability !== 'number' ||
      item.probability < 0 ||
      item.probability > 1
    ) {
      return { ok: false, error: 'Ortak olasılık kaydı geçersiz (iki mevcut seçim ve 0–1 arası olasılık gerekir).' };
    }
    joints.push({ selectionIds: [item.selectionIds[0] as string, item.selectionIds[1] as string], probability: item.probability });
  }

  return {
    ok: true,
    data: {
      budgetKurus: (budget as number | null | undefined) ?? null,
      selections,
      slips,
      settings: parseSettings(raw.settings, raw.riskProfile),
      joints,
    },
  };
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
  const { id, matchId, matchName, marketSelection, odds, minMatches, confidence } = s;
  return { id, matchId, matchName, marketSelection, odds, minMatches, confidence };
}
