import { describe, expect, it } from 'vitest';
import { BACKUP_KEY_PREFIX, STORAGE_KEY, loadFromStorage, parseData, saveToStorage, serializeData, type AppData } from '../storage';
import { DEFAULT_SETTINGS } from '../../engine/config';
import { sel } from './fixtures';

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  key(i: number) {
    return Array.from(this.map.keys())[i] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

const data: AppData = {
  budgetKurus: 30000,
  settings: { ...DEFAULT_SETTINGS, preferredStrategy: 'cautious', maxLossKurus: 15000, minColumnStakeKurus: 100 },
  joints: [{ selectionIds: ['a', 'b'], probability: 0.3 }],
  selections: [
    sel('a', 2.15, 7, 2, { estimatedProbability: 0.55 }),
    { ...sel('b', 1.8, 7, 1, { estimatedProbability: 0.6, correlationGroup: 'Süper Lig' }), note: 'Derbi', result: 'won' },
    { ...sel('c', 1.5), result: 'void' },
  ],
  slips: [
    {
      id: 'slip-1',
      createdAt: '2026-10-23T12:00:00.000Z',
      budgetKurus: 30000,
      riskProfile: 'balanced',
      parts: [
        { kind: 'normal', selectionIds: ['a', 'b'], stakeKurus: 10000 },
        { kind: 'system', selectionIds: ['a', 'b', 'c'], sizes: [2, 3], allocatedKurus: 20000 },
      ],
      selections: [sel('a', 2.15, 7, 2), sel('b', 1.8), sel('c', 1.5)],
    },
  ],
};

describe('JSON içe/dışa aktarma', () => {
  it('dışa aktarılan veri (sonuçlar ve kayıtlı kuponlar dahil) aynen geri okunur', () => {
    const parsed = parseData(serializeData(data));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data).toEqual(data);
  });

  it('eski (sürüm 1) kayıtları kayıpsız okur; maç kimliği maç adından türetilir', () => {
    const legacy = ({ matchId: _m, ...rest }: ReturnType<typeof sel>) => rest;
    const v1 = JSON.stringify({
      app: 'kupon-planlayici',
      version: 1,
      exportedAt: '2026-10-23T10:00:00.000Z',
      budgetKurus: 30000,
      selections: [legacy(sel('a', 2.15, 7, 2)), { ...legacy(sel('b', 1.8)), matchName: 'Maç a', note: 'Derbi' }],
    });
    const parsed = parseData(v1);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const [a, b] = parsed.data.selections;
    expect(a).toMatchObject({ id: 'a', odds: 2.15, minMatches: 2, matchId: 'm-mac-a' });
    expect(b.matchId).toBe(a.matchId); // aynı maç adı → aynı maç
    expect(b.note).toBe('Derbi');
    expect(a.estimatedProbability).toBeUndefined();
    expect(parsed.data.budgetKurus).toBe(30000);
    expect(parsed.data.slips).toEqual([]);
    expect(parsed.data.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('sürüm 2 kayıtlı kuponlarını ve risk tercihini taşır', () => {
    const v2 = {
      version: 2,
      budgetKurus: 30000,
      riskProfile: 'aggressive',
      selections: [sel('a', 2), sel('b', 2), sel('c', 2), sel('d', 2)].map(({ matchId: _m, ...s }) => s),
      slips: [
        {
          id: 's1',
          createdAt: '2026-11-01T10:00:00.000Z',
          budgetKurus: 30000,
          riskProfile: 'balanced',
          parts: [{ kind: 'system', selectionIds: ['a', 'b', 'c', 'd'], minSize: 3, allocatedKurus: 10000 }],
          selections: [sel('a', 2), sel('b', 2), sel('c', 2), sel('d', 2)].map(({ matchId: _m, ...s }) => s),
        },
      ],
    };
    const parsed = parseData(JSON.stringify(v2));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.slips[0].parts[0]).toEqual({ kind: 'system', selectionIds: ['a', 'b', 'c', 'd'], sizes: [3, 4], allocatedKurus: 10000 });
    expect(parsed.data.settings.preferredStrategy).toBe('aggressive');
  });

  it('geçersiz tahmini olasılığı ve ortak olasılık kaydını reddeder', () => {
    const obj = JSON.parse(serializeData(data));
    obj.selections[0].estimatedProbability = 1.4;
    expect(parseData(JSON.stringify(obj)).ok).toBe(false);
    const obj2 = JSON.parse(serializeData(data));
    obj2.joints = [{ selectionIds: ['a', 'yok'], probability: 0.2 }];
    expect(parseData(JSON.stringify(obj2)).ok).toBe(false);
  });

  it('bozuk ayarlar veriyi silmez; varsayılana döner', () => {
    const obj = JSON.parse(serializeData(data));
    obj.settings = { simulationCount: -5, maxSelectionExposurePct: 400, allowSystem: 'evet' };
    const r = parseData(JSON.stringify(obj));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.selections).toHaveLength(3);
    expect(r.data.settings.simulationCount).toBe(DEFAULT_SETTINGS.simulationCount);
    expect(r.data.settings.maxSelectionExposurePct).toBeNull();
    expect(r.data.settings.allowSystem).toBe(true);
  });

  it('bozuk JSON için anlaşılır hata verir', () => {
    const r = parseData('{bozuk');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('JSON');
  });

  it('şemaya uymayan seçimleri ve sonuçları reddeder', () => {
    const obj = JSON.parse(serializeData(data));
    obj.selections[1].odds = 0.8;
    const r = parseData(JSON.stringify(obj));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('2. seçim');

    const obj2 = JSON.parse(serializeData(data));
    obj2.selections[0].result = 'belki';
    expect(parseData(JSON.stringify(obj2)).ok).toBe(false);
  });

  it('bozuk kayıtlı kuponu reddeder', () => {
    const obj = JSON.parse(serializeData(data));
    obj.slips[0].parts[0].selectionIds = ['yok'];
    const r = parseData(JSON.stringify(obj));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('kayıtlı kupon');
  });

  it('tekrar eden kimlikleri reddeder', () => {
    const obj = JSON.parse(serializeData({ ...data, slips: [], selections: [sel('a', 2), sel('a', 3)] }));
    const r = parseData(JSON.stringify(obj));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('birden fazla');
  });

  it('desteklenmeyen sürümü ve liste olmayan seçimleri reddeder', () => {
    expect(parseData(JSON.stringify({ version: 99, selections: [] })).ok).toBe(false);
    expect(parseData(JSON.stringify({ version: 2, selections: {} })).ok).toBe(false);
  });
});

describe('localStorage', () => {
  it('kaydedip geri yükler', () => {
    const storage = new MemoryStorage();
    saveToStorage(storage, data);
    expect(loadFromStorage(storage)).toEqual(data);
    expect(loadFromStorage(undefined)).toBeNull();
  });

  it('okunamayan kaydı üzerine yazılmadan önce yedekler', () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, 'çöp');
    expect(loadFromStorage(storage, 1234)).toBeNull();
    expect(storage.getItem(`${BACKUP_KEY_PREFIX}1234`)).toBe('çöp');
  });
});
