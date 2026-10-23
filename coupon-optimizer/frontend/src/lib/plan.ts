import type { CouponPart, MatchSelection, Plan, PlanInput } from '../types';
import { calculateNormalCoupon, calculateSystemCoupon, type CalcResult } from './calculator';
import { formatTL } from './money';
import { describeSelection, validateSelection } from './validation';

export type BuildResult = { ok: true; plan: Plan } | { ok: false; errors: string[] };

/** Aynı kuponları aynı tutarlarla içeren planlar aynı imzayı alır (tekilleştirme için). */
export function planSignature(input: PlanInput): string {
  return input.parts
    .map((p) =>
      p.kind === 'normal'
        ? `N:${[...p.selectionIds].sort().join('+')}:${p.stakeKurus}`
        : `S${p.minSize}:${[...p.selectionIds].sort().join('+')}:${p.allocatedKurus}`,
    )
    .sort()
    .join('|');
}

/**
 * Plan girdisini (seçimler + tutarlar) doğrular ve hesaplanmış plana dönüştürür.
 * Bütçe kontrolü ayrılan tutarlar üzerinden yapılır; fiili harcama her zaman ayrılan tutardan küçük veya eşittir.
 */
export function buildPlan(input: PlanInput, selections: readonly MatchSelection[], budgetKurus: number): BuildResult {
  if (!Number.isInteger(budgetKurus) || budgetKurus <= 0) return { ok: false, errors: ["Bütçe 0'dan büyük olmalı."] };
  if (input.parts.length === 0) return { ok: false, errors: ['Plan en az bir kupon içermeli.'] };

  const byId = new Map(selections.map((s) => [s.id, s]));
  const errors: string[] = [];
  const parts: CouponPart[] = [];
  let allocatedTotal = 0;

  for (const part of input.parts) {
    if (new Set(part.selectionIds).size !== part.selectionIds.length) {
      errors.push('Bir kuponda aynı seçim birden fazla kez kullanılamaz.');
      continue;
    }
    const partSelections: MatchSelection[] = [];
    for (const id of part.selectionIds) {
      const s = byId.get(id);
      if (!s) {
        errors.push('Plandaki bir seçim artık listede yok; planları yeniden hesaplayın.');
        continue;
      }
      const selErrors = validateSelection(s);
      if (selErrors.length > 0) errors.push(`${describeSelection(s)}: ${selErrors[0]}`);
      partSelections.push(s);
    }
    if (partSelections.length !== part.selectionIds.length) continue;

    let result: CalcResult<CouponPart>;
    if (part.kind === 'normal') {
      allocatedTotal += part.stakeKurus;
      result = calculateNormalCoupon(partSelections, part.stakeKurus);
    } else {
      allocatedTotal += part.allocatedKurus;
      result = calculateSystemCoupon(partSelections, part.minSize, part.allocatedKurus);
    }
    if (result.ok) parts.push(result.value);
    else errors.push(result.error);
  }

  if (allocatedTotal > budgetKurus) {
    errors.push(`Planın toplam tutarı (${formatTL(allocatedTotal)}) bütçeyi (${formatTL(budgetKurus)}) aşıyor.`);
  }
  if (errors.length > 0) return { ok: false, errors };

  const totalStakeKurus = parts.reduce((sum, p) => sum + p.stakeKurus, 0);
  const selectionIds = Array.from(new Set(parts.flatMap((p) => p.selectionIds)));
  const used = selectionIds.map((id) => byId.get(id)!);
  const confidences = used.map((s) => s.confidence);
  const hasNormal = parts.some((p) => p.kind === 'normal');
  const hasSystem = parts.some((p) => p.kind === 'system');

  return {
    ok: true,
    plan: {
      id: planSignature(input),
      strategy: input.strategy,
      label: input.label,
      description: input.description,
      input,
      parts,
      couponType: hasNormal && hasSystem ? 'Karma' : hasSystem ? 'Sistem' : 'Normal',
      budgetKurus,
      totalStakeKurus,
      remainingKurus: budgetKurus - totalStakeKurus,
      selectionIds,
      selectionCount: selectionIds.length,
      columnCount: parts.reduce((sum, p) => sum + (p.kind === 'normal' ? 1 : p.columns.length), 0),
      avgConfidence: confidences.reduce((a, b) => a + b, 0) / confidences.length,
      minConfidence: Math.min(...confidences),
    },
  };
}
