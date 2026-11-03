/** Arama için metni sadeleştirir: Türkçe/aksanlı harfler düzleştirilir, küçük harfe çevrilir, virgül noktaya döner. */
export function normalizeSearch(text: string): string {
  return text
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/,/g, '.')
    .replace(/\s+/g, ' ')
    .trim();
}

const compact = (text: string) => normalizeSearch(text).replace(/\s/g, '');

export type Searchable = { value: string; aliases?: string[] };

/**
 * Sorgunun her kelimesi aday metinlerinden birinde (boşluksuz) geçmelidir. Sıralama: tam eşleşme,
 * baştan eşleşme, kelime başı eşleşmesi, içerme. "ms1" → "MS 1", "besiktas" → "Beşiktaş JK", "gs" → "Galatasaray SK".
 */
export function searchItems<T extends Searchable>(items: readonly T[], query: string, limit: number): T[] {
  const q = normalizeSearch(query);
  if (!q) return items.slice(0, limit);
  const qCompact = q.replace(/\s/g, '');
  const tokens = q.split(' ');

  const scored: { item: T; score: number; index: number }[] = [];
  items.forEach((item, index) => {
    const texts = [item.value, ...(item.aliases ?? [])];
    let best = -1;
    for (const text of texts) {
      const n = normalizeSearch(text);
      const c = compact(text);
      if (!tokens.every((tok) => c.includes(tok))) continue;
      let score = 1;
      if (c === qCompact) score = 4;
      else if (c.startsWith(qCompact)) score = 3;
      else if (n.split(/[\s\-/&.()]+/).some((word) => word.startsWith(tokens[0]))) score = 2;
      best = Math.max(best, score);
    }
    if (best > 0) scored.push({ item, score: best, index });
  });
  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((s) => s.item);
}
