/**
 * Varsayılan bahis seçimleri. Listede olmayan seçim formda serbestçe yazılabilir.
 * Oyuncu özel seçimlerde değer "Gol Atar – " gibi bir şablondur; oyuncu adı sonuna yazılır.
 */
export type Market = {
  value: string;
  group: string;
  aliases?: string[];
  popular?: boolean;
  /** Oyuncu adı sonradan yazılacak şablon. */
  player?: boolean;
};

export const PLAYER_SEPARATOR = ' – ';

const m = (group: string, values: string[], extra: Partial<Market> = {}): Market[] => values.map((value) => ({ value, group, ...extra }));
const overUnder = (prefix: string, lines: number[], group: string): Market[] =>
  lines.flatMap((l) => m(group, [`${prefix}${l.toFixed(1)} Üst`, `${prefix}${l.toFixed(1)} Alt`]));

export const MARKETS: Market[] = [
  { value: 'MS 1', group: 'Maç Sonucu', popular: true, aliases: ['ev kazanır', 'ev sahibi kazanır'] },
  { value: 'MS X', group: 'Maç Sonucu', popular: true, aliases: ['beraberlik', 'msx', 'ms 0'] },
  { value: 'MS 2', group: 'Maç Sonucu', popular: true, aliases: ['deplasman kazanır'] },
  ...m('Çifte Şans', ['ÇŞ 1-X', 'ÇŞ 1-2', 'ÇŞ X-2'], { aliases: ['çifte şans'] }),
  ...overUnder('', [0.5, 1.5, 2.5, 3.5, 4.5, 5.5], 'Alt/Üst'),
  { value: 'KG Var', group: 'Karşılıklı Gol', popular: true, aliases: ['karşılıklı gol var', 'btts'] },
  { value: 'KG Yok', group: 'Karşılıklı Gol', popular: true, aliases: ['karşılıklı gol yok'] },
  ...m('İlk Yarı', ['İY 1', 'İY X', 'İY 2', 'İY ÇŞ 1-X', 'İY ÇŞ X-2', 'İY KG Var', 'İY KG Yok']),
  ...overUnder('İY ', [0.5, 1.5, 2.5, 3.5], 'İlk Yarı'),
  ...overUnder('2Y ', [0.5, 1.5, 2.5, 3.5], 'İkinci Yarı'),
  ...m('İY/MS', ['1/1', '1/X', '1/2', 'X/1', 'X/X', 'X/2', '2/1', '2/X', '2/2'].map((v) => `İY/MS ${v}`)),
  // Maç sonucu / çifte şans × 1.5–4.5 alt/üst, ör. "MS 1 & 4.5 Alt", "ÇŞ X-2 & 3.5 Üst".
  ...m(
    'Kombine',
    ['MS 1', 'MS X', 'MS 2', 'ÇŞ 1-X', 'ÇŞ X-2', 'ÇŞ 1-2'].flatMap((result) =>
      [1.5, 2.5, 3.5, 4.5].flatMap((line) => [`${result} & ${line.toFixed(1)} Üst`, `${result} & ${line.toFixed(1)} Alt`]),
    ),
  ),
  ...m('Kombine', ['MS 1 & KG Var', 'MS 1 & KG Yok', 'MS X & KG Var', 'MS X & KG Yok', 'MS 2 & KG Var', 'MS 2 & KG Yok']),
  ...m(
    'Kombine',
    [1.5, 2.5, 3.5, 4.5].flatMap((line) => [`KG Var & ${line.toFixed(1)} Üst`, `KG Var & ${line.toFixed(1)} Alt`, `KG Yok & ${line.toFixed(1)} Alt`]),
  ),
  ...m('Handikap', [
    'Hnd. MS 1 (0:1)',
    'Hnd. MS X (0:1)',
    'Hnd. MS 2 (0:1)',
    'Hnd. MS 1 (1:0)',
    'Hnd. MS X (1:0)',
    'Hnd. MS 2 (1:0)',
    'AH 1 (-0.5)',
    'AH 1 (-1.5)',
    'AH 2 (+0.5)',
    'AH 2 (+1.5)',
  ]),
  ...m('Toplam Gol', ['Toplam Gol 0-1', 'Toplam Gol 2-3', 'Toplam Gol 4-5', 'Toplam Gol 6+']),
  ...overUnder('Ev ', [0.5, 1.5, 2.5, 3.5], 'Takım Golü'),
  ...overUnder('Dep ', [0.5, 1.5, 2.5, 3.5], 'Takım Golü'),
  ...m('Takım Golü', [
    'Ev Gol Yemez',
    'Dep Gol Yemez',
    'İlk Golü Ev Atar',
    'İlk Golü Dep Atar',
  ]),
  ...overUnder('Korner ', [7.5, 8.5, 9.5, 10.5, 11.5], 'Korner'),
  ...m('Korner', ['İY Korner 4.5 Üst', 'İY Korner 4.5 Alt']),
  ...overUnder('Kart ', [2.5, 3.5, 4.5, 5.5], 'Kart'),
  ...m('Kart', ['Kırmızı Kart Var', 'Penaltı Var']),
  ...m(
    'Oyuncu Özel',
    [
      'Gol Atar',
      'İlk Golü Atar',
      'Son Golü Atar',
      '2+ Gol Atar',
      'Hat-trick Yapar',
      'Asist Yapar',
      'Gol veya Asist',
      'Kart Görür',
      '1+ İsabetli Şut',
      '2+ İsabetli Şut',
      '3+ Şut',
    ].map((v) => `${v}${PLAYER_SEPARATOR}`),
    { player: true, aliases: ['oyuncu'] },
  ),
];

// Hızlı erişim düğmeleri ve boş aramada önce gösterilenler.
for (const value of ['2.5 Üst', '2.5 Alt', '1.5 Üst', 'ÇŞ 1-X', 'ÇŞ X-2', 'MS 1 & 1.5 Üst', `Gol Atar${PLAYER_SEPARATOR}`]) {
  const market = MARKETS.find((x) => x.value === value);
  if (market) market.popular = true;
}

export const QUICK_MARKETS: { label: string; values: string[] }[] = [
  { label: 'MS', values: ['MS 1', 'MS X', 'MS 2'] },
  { label: 'Alt/Üst', values: ['1.5 Üst', '2.5 Üst', '2.5 Alt', '3.5 Üst', '3.5 Alt', '4.5 Üst', '4.5 Alt'] },
  { label: 'KG', values: ['KG Var', 'KG Yok'] },
];

/**
 * Hızlı düğme davranışı. Birleştir kapalıyken seçimi değiştirir. Açıkken "&" ile ekler; aynı gruptan bir parçanın
 * yerine geçer (ör. MS 1 & 2.5 Alt iken 4.5 Alt'a basılırsa MS 1 & 4.5 Alt olur) ve seçili parçaya tekrar basılırsa kaldırır.
 */
export function quickPick(current: string, value: string, combine: boolean): string {
  if (!combine || !current.trim()) return value;
  const group = (part: string) => QUICK_MARKETS.find((g) => g.values.includes(part))?.label ?? part;
  const parts = current
    .split(' & ')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.includes(value)) return parts.filter((p) => p !== value).join(' & ');
  const replaces = parts.some((p) => group(p) === group(value));
  return (replaces ? parts.map((p) => (group(p) === group(value) ? value : p)) : [...parts, value]).join(' & ');
}
