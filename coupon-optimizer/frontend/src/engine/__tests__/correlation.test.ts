import { describe, expect, it } from 'vitest';
import { buildOutcomeSpace, dependencyKey, validateJointProbability, type ModelSelection } from '../correlation';

const opts = { enumerationLimit: 16384, samples: 4000, seed: 7 };
const marginal = (space: ReturnType<typeof buildOutcomeSpace>, bit: number) =>
  Array.from(space.masks).reduce((sum, m, o) => sum + (m & (1 << bit) ? space.weights[o] : 0), 0);
const sum = (w: Float64Array) => w.reduce((a, b) => a + b, 0);

describe('Correlation Analyzer', () => {
  it('15. aynı maçtaki seçimler aynı bağımlılık grubunda; kullanıcı grubu farklı maçları birleştirir', () => {
    expect(dependencyKey({ matchId: 'm1' })).toBe(dependencyKey({ matchId: 'm1' }));
    expect(dependencyKey({ matchId: 'm1' })).not.toBe(dependencyKey({ matchId: 'm2' }));
    expect(dependencyKey({ matchId: 'm1', correlationGroup: 'Süper Lig' })).toBe(dependencyKey({ matchId: 'm2', correlationGroup: 'süper lig' }));
  });

  it('29. bağımsız senaryo olasılıklarının toplamı 1; 28. küçük kümede tam sayım marjinalleri korur', () => {
    const sels: ModelSelection[] = [
      { id: 'a', groupKey: 'm:1', p: 0.6 },
      { id: 'b', groupKey: 'm:2', p: 0.3 },
      { id: 'c', groupKey: 'm:3', p: 0.8 },
    ];
    const space = buildOutcomeSpace(sels, 'independent', [], opts);
    expect(space.method).toEqual({ kind: 'exact', scenarios: 8 });
    expect(sum(space.weights)).toBeCloseTo(1, 12);
    expect(marginal(space, 0)).toBeCloseTo(0.6, 12);
    expect(marginal(space, 2)).toBeCloseTo(0.8, 12);
  });

  it('18/30. aynı maç için bağımsızlık sessizce varsayılmaz: hangi model uygulandığı raporlanır; stres modeli geçerli dağılımdır', () => {
    const sels: ModelSelection[] = [
      { id: 'a', groupKey: 'm:1', p: 0.6 },
      { id: 'b', groupKey: 'm:1', p: 0.45 },
      { id: 'c', groupKey: 'm:2', p: 0.5 },
    ];
    const indep = buildOutcomeSpace(sels, 'independent', [], opts);
    expect(indep.independentGroups).toEqual(['m:1']);
    const como = buildOutcomeSpace(sels, 'comonotonic', [], opts);
    expect(como.comonotonicGroups).toEqual(['m:1']);
    expect(sum(como.weights)).toBeCloseTo(1, 12);
    expect(marginal(como, 0)).toBeCloseTo(0.6, 12);
    expect(marginal(como, 1)).toBeCloseTo(0.45, 12);
    // Tam pozitif bağımlılık: düşük olasılıklı seçim kazanıyorsa yüksek olan da kazanır.
    Array.from(como.masks).forEach((m, o) => {
      if (como.weights[o] > 0 && m & 0b10) expect(m & 0b01).toBeTruthy();
    });
  });

  it('19. geçersiz ortak olasılıklar reddedilir; geçerli olan senaryolara uygulanır', () => {
    expect(validateJointProbability(0.6, 0.45, 0.5)).not.toBeNull(); // > min(pA, pB)
    expect(validateJointProbability(0.8, 0.7, 0.4)).not.toBeNull(); // < pA + pB − 1
    expect(validateJointProbability(0.6, 0.45, 1.2)).not.toBeNull();
    expect(validateJointProbability(0.6, 0.45, 0.3)).toBeNull();
    const space = buildOutcomeSpace(
      [
        { id: 'a', groupKey: 'm:1', p: 0.6 },
        { id: 'b', groupKey: 'm:1', p: 0.45 },
      ],
      'independent',
      [{ selectionIds: ['a', 'b'], probability: 0.3 }],
      opts,
    );
    expect(space.jointGroups).toEqual(['m:1']);
    const both = Array.from(space.masks).reduce((s, m, o) => s + (m === 0b11 ? space.weights[o] : 0), 0);
    expect(both).toBeCloseTo(0.3, 12);
    expect(sum(space.weights)).toBeCloseTo(1, 12);
  });

  it('31. Monte Carlo aynı tohumla tekrarlanabilir; sayım sınırı aşılınca kullanılır', () => {
    const sels: ModelSelection[] = Array.from({ length: 16 }, (_, i) => ({ id: `s${i}`, groupKey: `m:${i}`, p: 0.55 }));
    const a = buildOutcomeSpace(sels, 'independent', [], { enumerationLimit: 4096, samples: 3000, seed: 42 });
    const b = buildOutcomeSpace(sels, 'independent', [], { enumerationLimit: 4096, samples: 3000, seed: 42 });
    const c = buildOutcomeSpace(sels, 'independent', [], { enumerationLimit: 4096, samples: 3000, seed: 43 });
    expect(a.method).toEqual({ kind: 'monte-carlo', simulations: 3000, seed: 42 });
    expect(Array.from(a.masks)).toEqual(Array.from(b.masks));
    expect(Array.from(a.masks)).not.toEqual(Array.from(c.masks));
    expect(marginal(a, 0)).toBeGreaterThan(0.5);
    expect(marginal(a, 0)).toBeLessThan(0.6);
  });
});
