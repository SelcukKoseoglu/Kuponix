import { describe, expect, it } from 'vitest';
import { MARKETS, quickPick } from '../../data/markets';
import { TEAMS } from '../../data/teams';
import { normalizeSearch, searchItems } from '../search';

const teams = TEAMS.map((t) => ({ value: t.name, aliases: t.aliases }));
const top = (q: string, items = teams) => searchItems(items, q, 5).map((x) => x.value);

describe('takım listesi', () => {
  it('tekrar eden takım yok ve verilen listedeki takımlar var', () => {
    const names = TEAMS.map((t) => normalizeSearch(t.name));
    expect(new Set(names).size).toBe(names.length);
    for (const name of ['Manchester City', 'Como 1907', 'Sabah FK', 'FK Bodø/Glimt', 'Omonia Lefkoşa', 'Beşiktaş JK', 'SL Benfica']) {
      expect(TEAMS.some((t) => t.name === name)).toBe(true);
    }
  });

  it('6 büyük ligi içerir', () => {
    const leagues = new Set(TEAMS.map((t) => t.league));
    for (const l of ['Premier Lig', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1', 'Süper Lig']) expect(leagues).toContain(l);
  });

  it('Türkçe karakter ve kısaltmalarla bulunur', () => {
    expect(top('besiktas')[0]).toBe('Beşiktaş JK');
    expect(top('BJK')[0]).toBe('Beşiktaş JK');
    expect(top('gs')[0]).toBe('Galatasaray SK');
    expect(top('fener')[0]).toBe('Fenerbahçe SK');
    expect(top('bayern')[0]).toBe('FC Bayern Münih');
    expect(top('bodo')[0]).toBe('FK Bodø/Glimt');
    expect(top('psg')[0]).toBe('Paris Saint-Germain');
  });
});

describe('bahis seçimleri', () => {
  const markets = MARKETS.map((m) => ({ value: m.value, aliases: m.aliases }));

  it('yazım farklarıyla bulunur', () => {
    expect(top('ms1', markets)[0]).toBe('MS 1');
    expect(top('msx', markets)[0]).toBe('MS X');
    expect(top('2,5 üst', markets)[0]).toBe('2.5 Üst');
    expect(top('kg var', markets)[0]).toBe('KG Var');
    expect(top('1 & üst', markets)).toContain('MS 1 & 1.5 Üst');
    expect(top('gol atar', markets)).toContain('Gol Atar – ');
  });

  it('tekrar eden seçim yok', () => {
    expect(new Set(MARKETS.map((m) => m.value)).size).toBe(MARKETS.length);
  });

  it('maç sonucu × 3.5 / 4.5 alt-üst kombineleri var ve aranabilir', () => {
    for (const v of ['3.5 Üst', '3.5 Alt', '4.5 Üst', '4.5 Alt', 'MS 1 & 4.5 Alt', 'MS 2 & 3.5 Üst', 'MS X & 3.5 Alt', 'ÇŞ X-2 & 4.5 Alt']) {
      expect(MARKETS.some((m) => m.value === v)).toBe(true);
    }
    expect(top('ms1 4.5 alt', markets)[0]).toBe('MS 1 & 4.5 Alt');
    expect(top('ms 2 & 3,5 üst', markets)[0]).toBe('MS 2 & 3.5 Üst');
  });
});

describe('hızlı düğmelerle birleştirme', () => {
  it('birleştir kapalıyken seçimi değiştirir', () => {
    expect(quickPick('MS 1', '4.5 Alt', false)).toBe('4.5 Alt');
  });

  it('birleştir açıkken ekler, aynı gruptakinin yerine geçer ve tekrar basılınca kaldırır', () => {
    expect(quickPick('', 'MS 1', true)).toBe('MS 1');
    expect(quickPick('MS 1', '4.5 Alt', true)).toBe('MS 1 & 4.5 Alt');
    expect(quickPick('MS 1 & 2.5 Alt', '4.5 Alt', true)).toBe('MS 1 & 4.5 Alt');
    expect(quickPick('MS 1 & 4.5 Alt', 'MS 2', true)).toBe('MS 2 & 4.5 Alt');
    expect(quickPick('MS 1 & 4.5 Alt', 'KG Var', true)).toBe('MS 1 & 4.5 Alt & KG Var');
    expect(quickPick('MS 1 & 4.5 Alt', '4.5 Alt', true)).toBe('MS 1');
  });
});
