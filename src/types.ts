export type Market = "crypto" | "stock";

export type FactorCategory = "trend" | "momentum" | "meanReversion" | "volatility" | "volume" | "derivatives";

export type Timeframe = "5m" | "15m" | "30m" | "1h" | "4h" | "1d" | "1w";

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type Direction = "long" | "short" | "neutral";

export type Reading = {
  direction: Direction;
  /** Signed conviction in [-1, 1]. Positive is long. */
  strength: number;
};

export type WatchItem = {
  market: Market;
  symbol: string;
};

export const TIMEFRAMES: { id: Timeframe; label: string; ms: number }[] = [
  { id: "5m", label: "5分", ms: 5 * 60_000 },
  { id: "15m", label: "15分", ms: 15 * 60_000 },
  { id: "30m", label: "30分", ms: 30 * 60_000 },
  { id: "1h", label: "1时", ms: 60 * 60_000 },
  { id: "4h", label: "4时", ms: 4 * 60 * 60_000 },
  { id: "1d", label: "日线", ms: 24 * 60 * 60_000 },
  { id: "1w", label: "周线", ms: 7 * 24 * 60 * 60_000 },
];

export function timeframeMs(tf: Timeframe): number {
  return TIMEFRAMES.find((item) => item.id === tf)?.ms ?? 60_000;
}

export function timeframeLabel(tf: Timeframe): string {
  return TIMEFRAMES.find((item) => item.id === tf)?.label ?? tf;
}
