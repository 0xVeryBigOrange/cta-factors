import type { Candle } from "../types";
import type { Factor, FactorContext } from "./catalog";

export type FactorStat = {
  hitRate: number | null;
  ic: number | null;
  samples: number;
};

const EMPTY: FactorStat = { hitRate: null, ic: null, samples: 0 };
const cache = new Map<string, FactorStat>();

/** Shrinkage weight from a short-horizon IC. Missing history stays at 1. */
export function icWeight(stat: FactorStat | undefined): number {
  if (!stat || stat.samples < 12 || stat.ic == null) return 1;
  const tilted = Math.max(-1, Math.min(1, stat.ic / 0.08));
  return Math.max(0.2, 0.6 + 0.4 * tilted);
}

function ctxAt(ctx: FactorContext, time: number): FactorContext {
  const data = ctx.derivatives;
  if (!data) return ctx;
  return {
    ...ctx,
    derivatives: {
      funding: data.funding.filter((point) => point.time <= time),
      oi: data.oi.filter((point) => point.time <= time),
      lsr: data.lsr.filter((point) => point.time <= time),
      basis: null,
    },
  };
}

function correlation(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 8) return null;
  const count = xs.length;
  const meanX = xs.reduce((sum, value) => sum + value, 0) / count;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / count;
  let num = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < count; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  if (varX === 0 || varY === 0) return null;
  return num / Math.sqrt(varX * varY);
}

/**
 * Hit rate and rank IC of one factor against the return 4 bars ahead.
 * The window is the latest 160 bars, sampled at about 16 points.
 * Basis and cross-sectional rank are skipped: one is a live snapshot,
 * the other would use today's peers on past dates.
 */
export function factorHistory(candles: Candle[], factor: Factor, ctx: FactorContext): FactorStat {
  if (factor.id === "xs-mom" || factor.id === "basis") return EMPTY;
  const last = candles[candles.length - 1];
  const key = `${factor.id}|${ctx.timeframe}|${ctx.symbol ?? ""}|${candles.length}|${last?.time ?? 0}|${last?.close ?? ""}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const horizon = 4;
  const origin = Math.max(factor.minBars, candles.length - 160);
  const stop = candles.length - 1 - horizon;
  const span = stop - origin;
  const stat = span < 12 ? EMPTY : scoreWindow(candles, factor, ctx, origin, stop, horizon);
  cache.set(key, stat);
  if (cache.size > 800) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  return stat;
}

function scoreWindow(
  candles: Candle[],
  factor: Factor,
  ctx: FactorContext,
  origin: number,
  stop: number,
  horizon: number,
): FactorStat {
  const stride = Math.max(1, Math.floor((stop - origin) / 16));
  const scores: number[] = [];
  const forward: number[] = [];
  for (let i = origin; i <= stop; i += stride) {
    const then = candles[i].close;
    const later = candles[i + horizon]?.close;
    if (!(then > 0) || later == null) continue;
    let score: number | null = null;
    try {
      score = factor.compute(candles.slice(0, i + 1), ctxAt(ctx, candles[i].time))?.strength ?? null;
    } catch {
      score = null;
    }
    if (score == null || !Number.isFinite(score)) continue;
    scores.push(score);
    forward.push(later / then - 1);
  }
  if (scores.length < 8) return { hitRate: null, ic: null, samples: scores.length };
  let hits = 0;
  let decided = 0;
  for (let i = 0; i < scores.length; i++) {
    if (Math.abs(scores[i]) < 0.08 || forward[i] === 0) continue;
    decided += 1;
    if (Math.sign(scores[i]) === Math.sign(forward[i])) hits += 1;
  }
  return {
    hitRate: decided >= 8 ? hits / decided : null,
    ic: correlation(scores, forward),
    samples: scores.length,
  };
}
