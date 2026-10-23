import { describe, expect, it } from 'vitest';
import { BACKUP_KEY_PREFIX, STORAGE_KEY, loadFromStorage, parseData, saveToStorage, serializeData, type AppData } from '../storage';
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
  riskProfile: 'cautious',
  selections: [sel('a', 2.15, 7, 2), { ...sel('b', 1.8), note: 'Derbi', result: 'won' }, { ...sel('c', 1.5), result: 'void' }],
  slips: [
    {
      id: 'slip-1',
      createdAt: '2026-10-23T12:00:00.000Z',
      budgetKurus: 30000,
      riskProfile: 'balanced',
      parts: [
        { kind: 'normal', selectionIds: ['a', 'b'], stakeKurus: 10000 },
        { kind: 'system', selectionIds: ['a', 'b', 'c'], minSize: 2, allocatedKurus: 20000 },
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

  it('eski (sürüm 1) kayıtları kayıpsız okur', () => {
    const v1 = JSON.stringify({
      app: 'kupon-planlayici',
      version: 1,
      exportedAt: '2026-10-23T10:00:00.000Z',
      budgetKurus: 30000,
      selections: [sel('a', 2.15, 7, 2), { ...sel('b', 1.8), note: 'Derbi' }],
    });
    const parsed = parseData(v1);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.selections).toEqual([sel('a', 2.15, 7, 2), { ...sel('b', 1.8), note: 'Derbi' }]);
    expect(parsed.data.budgetKurus).toBe(30000);
    expect(parsed.data.slips).toEqual([]);
    expect(parsed.data.riskProfile).toBe('balanced');
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
