import type { MatchSelection, SelectionResult } from '../types';
import { parseDecimalInput, parseIntegerInput } from './money';

export const MAX_ODDS = 1000;
export const MAX_MIN_MATCHES = 30;
export const MAX_TEXT_LENGTH = 80;
export const MAX_NOTE_LENGTH = 300;
export const SELECTION_RESULTS: readonly SelectionResult[] = ['pending', 'won', 'lost', 'void'];

export type SelectionDraft = {
  matchName: string;
  marketSelection: string;
  odds: string;
  minMatches: string;
  confidence: string;
  note: string;
};

export type DraftErrors = Partial<Record<keyof SelectionDraft, string>>;

export const EMPTY_DRAFT: SelectionDraft = {
  matchName: '',
  marketSelection: '',
  odds: '',
  minMatches: '1',
  confidence: '5',
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
): { ok: true; value: Omit<MatchSelection, 'id'> } | { ok: false; errors: DraftErrors } {
  const errors: DraftErrors = {};

  const matchErr = validateText(draft.matchName, 'Maç adı', MAX_TEXT_LENGTH);
  if (matchErr) errors.matchName = matchErr;
  const marketErr = validateText(draft.marketSelection, 'Bahis seçimi', MAX_TEXT_LENGTH);
  if (marketErr) errors.marketSelection = marketErr;

  const odds = parseDecimalInput(draft.odds);
  const oddsErr = odds === null ? 'Oran sayısal olmalı (ör. 2,15).' : validateOdds(odds);
  if (oddsErr) errors.odds = oddsErr;

  const minMatches = parseIntegerInput(draft.minMatches);
  const minErr = minMatches === null ? 'Minimum maç sayısı pozitif bir tam sayı olmalı.' : validateMinMatches(minMatches);
  if (minErr) errors.minMatches = minErr;

  const confidence = parseIntegerInput(draft.confidence);
  const confErr = confidence === null ? 'Güven puanı 1 ile 10 arasında bir tam sayı olmalı.' : validateConfidence(confidence);
  if (confErr) errors.confidence = confErr;

  if (draft.note.trim().length > MAX_NOTE_LENGTH) errors.note = `Not en fazla ${MAX_NOTE_LENGTH} karakter olabilir.`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const note = draft.note.trim();
  return {
    ok: true,
    value: {
      matchName: draft.matchName.trim(),
      marketSelection: draft.marketSelection.trim(),
      odds: Math.round(odds! * 100) / 100,
      minMatches: minMatches!,
      confidence: confidence!,
      ...(note ? { note } : {}),
    },
  };
}

/** Kaydedilmiş/içe aktarılmış bir seçimi doğrular; hata mesajları listesini döner. */
export function validateSelection(selection: MatchSelection): string[] {
  const errors: string[] = [];
  if (typeof selection.id !== 'string' || !selection.id.trim()) errors.push('Seçim kimliği (id) boş olamaz.');
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
  if (selection.result !== undefined && !SELECTION_RESULTS.includes(selection.result)) {
    errors.push('Maç sonucu "pending", "won", "lost" veya "void" olmalı.');
  }
  return errors;
}

export function describeSelection(s: Pick<MatchSelection, 'matchName' | 'marketSelection'>): string {
  return `${s.matchName} (${s.marketSelection})`;
}
