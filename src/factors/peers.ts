import type { EngineSnapshot } from "../data/engine";
import { seriesKey } from "../data/engine";
import type { Market, Timeframe, WatchItem } from "../types";
import type { Derivatives, FactorContext, PeerReturn } from "./catalog";

function windowReturn(closes: number[], lookback: number): number | null {
  const last = closes.length - 1;
  if (last < lookback) return null;
  const then = closes[last - lookback];
  const now = closes[last];
  if (!(then > 0) || !Number.isFinite(now)) return null;
  return now / then - 1;
}

export function buildPeers(
  snapshot: EngineSnapshot,
  items: WatchItem[],
  timeframe: Timeframe,
  market: Market,
): PeerReturn[] {
  return items
    .filter((item) => item.market === market)
    .map((item) => {
      const snap = snapshot.series[seriesKey(item, timeframe)];
      if (snap?.status !== "ready" || snap.candles.length === 0) {
        return { symbol: item.symbol, ret20: null, ret60: null };
      }
      const closes = snap.candles.map((candle) => candle.close);
      return { symbol: item.symbol, ret20: windowReturn(closes, 20), ret60: windowReturn(closes, 60) };
    });
}

export function factorContext(
  item: WatchItem,
  timeframe: Timeframe,
  derivatives: Derivatives | null,
  peers: PeerReturn[],
): FactorContext {
  return { timeframe, symbol: item.symbol, derivatives, peers };
}
