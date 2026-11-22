import type { Candle } from "../types";
import { aggregate, type Aggregate } from "./aggregate";
import { FACTORS, factorsFor, type Factor, type FactorContext } from "./catalog";
import type { Reading } from "../types";

export type FactorCell = {
  factor: Factor;
  reading: Reading | null;
};

const cache = new Map<string, FactorCell[]>();

function stamp(candles: Candle[] | undefined, ctx: FactorContext, market: "crypto" | "stock"): string {
  const last = candles?.[candles.length - 1];
  const deriv = ctx.derivatives;
  const derivStamp = deriv
    ? `${deriv.funding.at(-1)?.time ?? 0}:${deriv.oi.at(-1)?.time ?? 0}:${deriv.lsr.at(-1)?.ratio ?? ""}:${deriv.basis ?? ""}`
    : "none";
  const peerStamp = (ctx.peers ?? [])
    .map((peer) => `${peer.symbol}:${peer.ret20?.toFixed(4) ?? ""}:${peer.ret60?.toFixed(4) ?? ""}`)
    .join(",");
  return `${market}|${ctx.symbol ?? ""}|${ctx.timeframe}|${candles?.length ?? 0}|${last?.time ?? 0}|${last?.close ?? ""}|${last?.volume ?? ""}|${derivStamp}|${peerStamp}`;
}

export function evaluate(candles: Candle[] | undefined, ctx: FactorContext, market: "crypto" | "stock"): FactorCell[] {
  const key = stamp(candles, ctx, market);
  const cached = cache.get(key);
  if (cached) return cached;
  const hasVolume = !!candles?.some((candle) => candle.volume > 0);
  const cells = factorsFor(market).map((factor) => {
    if (!candles || candles.length < factor.minBars) return { factor, reading: null };
    if (factor.needsVolume && !hasVolume) return { factor, reading: null };
    try {
      const value = factor.compute(candles, ctx);
      if (!value || !Number.isFinite(value.strength)) return { factor, reading: null };
      return { factor, reading: value };
    } catch {
      return { factor, reading: null };
    }
  });
  cache.set(key, cells);
  if (cache.size > 400) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  return cells;
}

export function evaluateAggregate(
  candles: Candle[] | undefined,
  ctx: FactorContext,
  market: "crypto" | "stock",
): Aggregate {
  const cells = evaluate(candles, ctx, market);
  return aggregate(cells.map((cell) => ({ category: cell.factor.category, reading: cell.reading })));
}

export { FACTORS };
