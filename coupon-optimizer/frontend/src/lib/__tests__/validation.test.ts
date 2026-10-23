import { describe, expect, it } from 'vitest';
import { EMPTY_DRAFT, validateBudgetKurus, validateConfidence, validateDraft, validateMinMatches, validateOdds } from '../validation';
import { parseDecimalInput, parseMoneyToKurus } from '../money';

describe('alan validasyonları', () => {
  it('oran 1’den büyük ve sayısal olmalı', () => {
    expect(validateOdds(1)).not.toBeNull();
    expect(validateOdds(0.5)).not.toBeNull();
    expect(validateOdds(Number.NaN)).not.toBeNull();
    expect(validateOdds(2.155)).not.toBeNull();
    expect(validateOdds(1.01)).toBeNull();
    expect(validateOdds(2.15)).toBeNull();
  });

  it('güven puanı 1–10 tam sayı olmalı', () => {
    expect(validateConfidence(0)).not.toBeNull();
    expect(validateConfidence(11)).not.toBeNull();
    expect(validateConfidence(7.5)).not.toBeNull();
    expect(validateConfidence(1)).toBeNull();
    expect(validateConfidence(10)).toBeNull();
  });

  it('min. maç sayısı pozitif tam sayı olmalı', () => {
    expect(validateMinMatches(0)).not.toBeNull();
    expect(validateMinMatches(-1)).not.toBeNull();
    expect(validateMinMatches(1.5)).not.toBeNull();
    expect(validateMinMatches(2)).toBeNull();
  });

  it('bütçe pozitif olmalı', () => {
    expect(validateBudgetKurus(null)).not.toBeNull();
    expect(validateBudgetKurus(0)).not.toBeNull();
    expect(validateBudgetKurus(1)).toBeNull();
  });
});

describe('form taslağı', () => {
  it('virgüllü oranı kabul eder', () => {
    const r = validateDraft({ ...EMPTY_DRAFT, matchName: 'BJK - CRY', marketSelection: 'İlk Yarı 0', odds: '2,15', minMatches: '2', confidence: '7' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ odds: 2.15, minMatches: 2, confidence: 7, matchName: 'BJK - CRY' });
  });

  it('boş alanları ve geçersiz değerleri reddeder', () => {
    const r = validateDraft({ ...EMPTY_DRAFT, matchName: ' ', marketSelection: '', odds: 'abc', minMatches: '0', confidence: '12' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['confidence', 'marketSelection', 'matchName', 'minMatches', 'odds']);
  });
});

describe('sayı ayrıştırma', () => {
  it('TL tutarlarını kuruşa çevirir', () => {
    expect(parseMoneyToKurus('300')).toBe(30000);
    expect(parseMoneyToKurus('250,5')).toBe(25050);
    expect(parseMoneyToKurus('250.55')).toBe(25055);
    expect(parseMoneyToKurus('1.250,75')).toBe(125075);
    expect(parseMoneyToKurus('12,345')).toBeNull();
    expect(parseMoneyToKurus('-5')).toBeNull();
    expect(parseMoneyToKurus('')).toBeNull();
  });

  it('ondalık oran girdisi', () => {
    expect(parseDecimalInput('2,15')).toBe(2.15);
    expect(parseDecimalInput('1.8')).toBe(1.8);
    expect(parseDecimalInput('x')).toBeNull();
  });
});
