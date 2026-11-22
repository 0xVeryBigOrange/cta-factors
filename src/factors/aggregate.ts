import type { FactorCategory, Reading } from "../types";

/** Steepness of the vote → probability map. 0 → 50%, ±1 → about 5% / 95%. */
export const LOGISTIC_K = 3;

/**
 * Prior correlation between category scores. Carver floors negative
 * correlations at 0 so the diversification multiplier cannot explode.
 */
export const CATEGORY_RHO = 0.35;
export const FDM_CAP = 2.5;

/** sqrt(N / (1 + (N-1) ρ)), capped at 2.5. One category has multiplier 1. */
export function forecastDiversificationMultiplier(count: number, rho = CATEGORY_RHO): number {
  if (count <= 1) return 1;
  const rhoUsed = Math.max(0, Math.min(0.95, rho));
  return Math.min(FDM_CAP, Math.sqrt(count / (1 + (count - 1) * rhoUsed)));
}

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
  /** Category-average score after the diversification multiplier, capped to [-1, 1]. */
  score: number;
  /** Equal-weight category average before the multiplier. */
  rawScore: number;
  fdm: number;
  probability: number;
  insufficient: boolean;
  used: number;
  categories: CategoryScore[];
};

const EMPTY: Aggregate = {
  score: 0,
  rawScore: 0,
  fdm: 1,
  probability: 0.5,
  insufficient: true,
  used: 0,
  categories: [],
};

export function aggregate(
  items: { category: FactorCategory; reading: Reading | null; weight?: number }[],
): Aggregate {
  const grouped = new Map<FactorCategory, { sum: number; weight: number; count: number }>();
  let used = 0;
  for (const item of items) {
    if (!item.reading || !Number.isFinite(item.reading.strength)) continue;
    const weight = item.weight == null || !Number.isFinite(item.weight) ? 1 : Math.max(0, item.weight);
    if (weight === 0) continue;
    const bucket = grouped.get(item.category) ?? { sum: 0, weight: 0, count: 0 };
    bucket.sum += item.reading.strength * weight;
    bucket.weight += weight;
    bucket.count += 1;
    grouped.set(item.category, bucket);
    used += 1;
  }
  if (grouped.size === 0) return EMPTY;
  const categories: CategoryScore[] = [];
  let total = 0;
  for (const [category, bucket] of grouped) {
    const score = bucket.weight === 0 ? 0 : bucket.sum / bucket.weight;
    categories.push({ category, score, count: bucket.count });
    total += score;
  }
  const rawScore = total / categories.length;
  const fdm = forecastDiversificationMultiplier(categories.length);
  const score = Math.max(-1, Math.min(1, rawScore * fdm));
  return {
    score,
    rawScore,
    fdm,
    probability: longProbability(score),
    insufficient: false,
    used,
    categories,
  };
}
