import type { FactorCategory, Reading } from "../types";

/** Steepness of the vote → probability map. 0 → 50%, ±1 → about 5% / 95%. */
export const LOGISTIC_K = 3;

export function longProbability(score: number, k = LOGISTIC_K): number {
  const clamped = Math.max(-1, Math.min(1, score));
  return 1 / (1 + Math.exp(-k * clamped));
}

export type CategoryScore = {
  category: FactorCategory;
  score: number;
  count: number;
};

export type Aggregate = {
  score: number;
  probability: number;
  insufficient: boolean;
  used: number;
  categories: CategoryScore[];
};

export function aggregate(items: { category: FactorCategory; reading: Reading | null }[]): Aggregate {
  const grouped = new Map<FactorCategory, number[]>();
  let used = 0;
  for (const item of items) {
    if (!item.reading || !Number.isFinite(item.reading.strength)) continue;
    const bucket = grouped.get(item.category) ?? [];
    bucket.push(item.reading.strength);
    grouped.set(item.category, bucket);
    used += 1;
  }
  if (grouped.size === 0) {
    return { score: 0, probability: 0.5, insufficient: true, used: 0, categories: [] };
  }
  const categories: CategoryScore[] = [];
  let total = 0;
  for (const [category, strengths] of grouped) {
    const score = strengths.reduce((sum, value) => sum + value, 0) / strengths.length;
    categories.push({ category, score, count: strengths.length });
    total += score;
  }
  const score = total / categories.length;
  return {
    score,
    probability: longProbability(score),
    insufficient: false,
    used,
    categories,
  };
}
