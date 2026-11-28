import type { Candle } from "../types";

/** `anchorMs` shifts the bucket grid. Weekly bars use Monday 00:00 UTC. */
export function resample(candles: Candle[], bucketMs: number, anchorMs = 0): Candle[] {
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const out: Candle[] = [];
  let current: Candle | null = null;
  let bucket = -1;
  for (const candle of sorted) {
    const nextBucket = Math.floor((candle.time - anchorMs) / bucketMs) * bucketMs + anchorMs;
    if (!current || nextBucket !== bucket) {
      if (current) out.push(current);
      bucket = nextBucket;
      current = { ...candle, time: nextBucket };
    } else {
      current.high = Math.max(current.high, candle.high);
      current.low = Math.min(current.low, candle.low);
      current.close = candle.close;
      current.volume += candle.volume;
    }
  }
  if (current) out.push(current);
  return out;
}

export function sortCandles(candles: Candle[]): Candle[] {
  return [...candles].filter((candle) => Number.isFinite(candle.close) && candle.close > 0).sort((a, b) => a.time - b.time);
}
