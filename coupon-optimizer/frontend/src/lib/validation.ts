import type { MatchSelection, SelectionResult } from '../types';
import { parseDecimalInput, parseIntegerInput } from './money';
import { normalizeSearch } from './search';

export const MAX_ODDS = 1000;
export const MAX_MIN_MATCHES = 30;
export const MAX_TEXT_LENGTH = 120;
export const MAX_TEAM_LENGTH = 50;
export const MATCH_SEPARATOR = ' - ';
export const MAX_NOTE_LENGTH = 300;
export const SELECTION_RESULTS: readonly SelectionResult[] = ['pending', 'won', 'lost', 'void'];

export type SelectionDraft = {
  /** Mevcut bir maça seçim ekleniyorsa o maçın kimliği; yeni maç için boş. */
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  marketSelection: string;
  odds: string;
  minMatches: string;
  confidence: string;
  /** Yüzde olarak tahmini olasılık ("55", "55,5", "%55"); boş bırakılabilir. */
  estimatedProbability: string;
  correlationGroup: string;
  note: string;
};

export const MAX_GROUP_LENGTH = 40;

export type DraftErrors = Partial<Record<keyof SelectionDraft, string>>;

export const EMPTY_DRAFT: SelectionDraft = {
  matchId: '',
  homeTeam: '',
  awayTeam: '',
  marketSelection: '',
  odds: '',
  minMatches: '1',
  confidence: '5',
  estimatedProbability: '',
  correlationGroup: '',
  note: '',
};

export function validateOdds(value: number): string | null {
  if (!Number.isFinite(value)) return 'Oran sayısal bir değer olmalı.';
  if (value <= 1) return "Oran 1'den büyük olmalı.";
  if (value > MAX_ODDS) return `Oran en fazla ${MAX_ODDS} olabilir.`;
  if (Math.abs(value * 100 - Math.round(value * 100)) > 1e-6) return 'Oran en fazla 2 ondalık basamak içerebilir.';
  return null;
}

export function validateConfidence(value: number): string | null {
  if (!Number.isInteger(value) || value < 1 || value > 10) return 'Güven puanı 1 ile 10 arasında bir tam sayı olmalı.';
  return null;
}

export function validateMinMatches(value: number): string | null {
  if (!Number.isInteger(value) || value < 1) return 'Minimum maç sayısı pozitif bir tam sayı olmalı.';
  if (value > MAX_MIN_MATCHES) return `Minimum maç sayısı en fazla ${MAX_MIN_MATCHES} olabilir.`;
  return null;
}

/** Tahmini olasılık 0 ile 1 arasında olmalı; %0 ve %100 (kesinlik) kabul edilmez. */
export function validateEstimatedProbability(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0 || value >= 1) return 'Tahmini olasılık %0 ile %100 arasında olmalı (uçlar hariç).';
  return null;
}

/** "55", "55,5", "%55" → 0.55; boşsa undefined; geçersizse null. */
export function parsePercentInput(input: string): number | undefined | null {
  const trimmed = input.trim().replace(/^%/, '').replace(/%$/, '').trim();
  if (!trimmed) return undefined;
  const value = parseDecimalInput(trimmed);
  return value === null ? null : Math.round(value * 100) / 10000;
}

export function validateBudgetKurus(value: number | null): string | null {
  if (value === null) return 'Bütçe geçerli bir tutar olmalı (ör. 300 veya 250,50).';
  if (value <= 0) return "Bütçe 0'dan büyük olmalı.";
  return null;
}

function validateText(value: string, label: string, max: number): string | null {
  if (!value.trim()) return `${label} boş bırakılamaz.`;
  if (value.trim().length > max) return `${label} en fazla ${max} karakter olabilir.`;
  return null;
}

/** Formdan gelen metin girdilerini doğrular ve seçim değerine dönüştürür. */
export function validateDraft(
  draft: SelectionDraft,
): { ok: true; value: Omit<MatchSelection, 'id' | 'matchId'> } | { ok: false; errors: DraftErrors } {
  const errors: DraftErrors = {};

  const homeErr = validateText(draft.homeTeam, 'Ev sahibi takım', MAX_TEAM_LENGTH);
  if (homeErr) errors.homeTeam = homeErr;
  if (draft.awayTeam.trim().length > MAX_TEAM_LENGTH) errors.awayTeam = `Deplasman takımı en fazla ${MAX_TEAM_LENGTH} karakter olabilir.`;
  else if (draft.awayTeam.trim() && normalizeSearch(draft.awayTeam) === normalizeSearch(draft.homeTeam)) {
    errors.awayTeam = 'Ev sahibi ve deplasman aynı takım olamaz.';
  }
  const marketErr = validateText(draft.marketSelection, 'Bahis seçimi', MAX_TEXT_LENGTH);
  if (marketErr) errors.marketSelection = marketErr;
  else if (/–$/.test(draft.marketSelection.trim())) errors.marketSelection = 'Oyuncu adını seçimin sonuna yazın (ör. "Gol Atar – Icardi").';

  const odds = parseDecimalInput(draft.odds);
  const oddsErr = odds === null ? 'Oran sayısal olmalı (ör. 2,15).' : validateOdds(odds);
  if (oddsErr) errors.odds = oddsErr;

  const minMatches = parseIntegerInput(draft.minMatches);
  const minErr = minMatches === null ? 'Minimum maç sayısı pozitif bir tam sayı olmalı.' : validateMinMatches(minMatches);
  if (minErr) errors.minMatches = minErr;

  const confidence = parseIntegerInput(draft.confidence);
  const confErr = confidence === null ? 'Güven puanı 1 ile 10 arasında bir tam sayı olmalı.' : validateConfidence(confidence);
  if (confErr) errors.confidence = confErr;

  const probability = parsePercentInput(draft.estimatedProbability);
  if (probability === null) errors.estimatedProbability = 'Tahmini olasılık yüzde olarak yazılmalı (ör. 55 veya 55,5).';
  else if (probability !== undefined) {
    const pErr = validateEstimatedProbability(probability);
    if (pErr) errors.estimatedProbability = pErr;
  }

  if (draft.correlationGroup.trim().length > MAX_GROUP_LENGTH) {
    errors.correlationGroup = `Korelasyon grubu en fazla ${MAX_GROUP_LENGTH} karakter olabilir.`;
  }
  if (draft.note.trim().length > MAX_NOTE_LENGTH) errors.note = `Not en fazla ${MAX_NOTE_LENGTH} karakter olabilir.`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const note = draft.note.trim();
  const group = draft.correlationGroup.trim();
  return {
    ok: true,
    value: {
      matchName: joinMatchName(draft.homeTeam, draft.awayTeam),
      marketSelection: draft.marketSelection.trim(),
      odds: Math.round(odds! * 100) / 100,
      minMatches: minMatches!,
      confidence: confidence!,
      ...(probability !== undefined && probability !== null ? { estimatedProbability: probability } : {}),
      ...(group ? { correlationGroup: group } : {}),
      ...(note ? { note } : {}),
    },
  };
}

/** Kaydedilmiş/içe aktarılmış bir seçimi doğrular; hata mesajları listesini döner. */
export function validateSelection(selection: MatchSelection): string[] {
  const errors: string[] = [];
  if (typeof selection.id !== 'string' || !selection.id.trim()) errors.push('Seçim kimliği (id) boş olamaz.');
  if (typeof selection.matchId !== 'string' || !selection.matchId.trim()) errors.push('Maç kimliği (matchId) boş olamaz.');
  const matchErr = validateText(String(selection.matchName ?? ''), 'Maç adı', MAX_TEXT_LENGTH);
  if (matchErr) errors.push(matchErr);
  const marketErr = validateText(String(selection.marketSelection ?? ''), 'Bahis seçimi', MAX_TEXT_LENGTH);
  if (marketErr) errors.push(marketErr);
  const oddsErr = typeof selection.odds === 'number' ? validateOdds(selection.odds) : 'Oran sayısal bir değer olmalı.';
  if (oddsErr) errors.push(oddsErr);
  const minErr =
    typeof selection.minMatches === 'number'
      ? validateMinMatches(selection.minMatches)
      : 'Minimum maç sayısı pozitif bir tam sayı olmalı.';
  if (minErr) errors.push(minErr);
  const confErr =
    typeof selection.confidence === 'number'
      ? validateConfidence(selection.confidence)
      : 'Güven puanı 1 ile 10 arasında bir tam sayı olmalı.';
  if (confErr) errors.push(confErr);
  if (selection.note !== undefined && (typeof selection.note !== 'string' || selection.note.length > MAX_NOTE_LENGTH)) {
    errors.push(`Not en fazla ${MAX_NOTE_LENGTH} karakterlik bir metin olmalı.`);
  }
  if (selection.estimatedProbability !== undefined) {
    const pErr =
      typeof selection.estimatedProbability === 'number'
        ? validateEstimatedProbability(selection.estimatedProbability)
        : 'Tahmini olasılık sayısal olmalı.';
    if (pErr) errors.push(pErr);
  }
  if (
    selection.correlationGroup !== undefined &&
    (typeof selection.correlationGroup !== 'string' || selection.correlationGroup.length > MAX_GROUP_LENGTH)
  ) {
    errors.push(`Korelasyon grubu en fazla ${MAX_GROUP_LENGTH} karakterlik bir metin olmalı.`);
  }
  if (selection.result !== undefined && !SELECTION_RESULTS.includes(selection.result)) {
    errors.push('Maç sonucu "pending", "won", "lost" veya "void" olmalı.');
  }
  return errors;
}

export function describeSelection(s: Pick<MatchSelection, 'matchName' | 'marketSelection'>): string {
  return `${s.matchName} (${s.marketSelection})`;
}

/** "Ev - Deplasman" biçiminde maç adı. Deplasman boşsa yalnızca ev sahibi adı kullanılır. */
export function joinMatchName(home: string, away: string): string {
  const h = home.trim().replace(/\s+/g, ' ');
  const a = away.trim().replace(/\s+/g, ' ');
  return a ? `${h}${MATCH_SEPARATOR}${a}` : h;
}

/** Maç adını takımlara ayırır ("BJK - CRY" → BJK, CRY). Ayraç yoksa tamamı ev sahibi sayılır. */
export function splitMatchName(matchName: string): { home: string; away: string } {
  const i = matchName.indexOf(MATCH_SEPARATOR);
  if (i < 0) return { home: matchName.trim(), away: '' };
  return { home: matchName.slice(0, i).trim(), away: matchName.slice(i + MATCH_SEPARATOR.length).trim() };
}

/** Aynı maçı tanımak için anahtar (büyük/küçük harf, Türkçe karakter ve boşluk farkları yok sayılır). */
export function matchKey(matchName: string): string {
  return normalizeSearch(matchName);
}

/**
 * Eski kayıtları taşırken maç kimliği: maç adından türetilir. Yeni seçimlerde kullanıcı maçı listeden seçerek aynı
 * kimliği kullanır; yazım farkı tek başına güvenilir grup anahtarı sayılmaz.
 */
export function matchIdFromName(matchName: string): string {
  return `m-${matchKey(matchName).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'mac'}`;
}
