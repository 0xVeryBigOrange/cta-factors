import type { Candle, Timeframe } from "../types";
import { fetchJson, gates } from "./http";
import { sortCandles } from "./resample";

export type EquitySeriesKey = "5m" | "15m" | "30m" | "1h" | "1d" | "1w";

export type EquityFile = {
  symbol: string;
  source: "yahoo";
  fetchedAt: number;
  /** Per-timeframe fetch time. Backfilled series keep the earlier stamp. */
  seriesFetchedAt?: Partial<Record<EquitySeriesKey, number>>;
  name?: string;
  price?: number;
  changePercent?: number;
  series: Partial<Record<EquitySeriesKey, number[][]>>;
};

const YAHOO_PLAN: Record<EquitySeriesKey, { interval: string; range: string }> = {
  "5m": { interval: "5m", range: "60d" },
  "15m": { interval: "15m", range: "60d" },
  "30m": { interval: "30m", range: "60d" },
  "1h": { interval: "1h", range: "730d" },
  "1d": { interval: "1d", range: "5y" },
  "1w": { interval: "1wk", range: "10y" },
};

const fileCache = new Map<string, EquityFile | null>();

export function rowsToCandles(rows: number[][] | undefined): Candle[] {
  if (!rows?.length) return [];
  return sortCandles(
    rows.map((row) => ({
      time: row[0],
      open: row[1],
      high: row[2],
      low: row[3],
      close: row[4],
      volume: row[5] ?? 0,
    })),
  );
}

export function parseYahooChart(payload: unknown): { candles: Candle[]; price?: number; changePercent?: number; name?: string } {
  const result = (payload as { chart?: { result?: Array<Record<string, unknown>> } }).chart?.result?.[0];
  if (!result) return { candles: [] };
  const timestamp = result.timestamp as number[] | undefined;
  const quote = (result.indicators as { quote?: Array<Record<string, Array<number | null>>> } | undefined)?.quote?.[0];
  const meta = result.meta as
    | { regularMarketPrice?: number; regularMarketChangePercent?: number; shortName?: string; longName?: string }
    | undefined;
  const candles: Candle[] = [];
  if (timestamp && quote) {
    for (let i = 0; i < timestamp.length; i++) {
      const open = quote.open?.[i];
      const high = quote.high?.[i];
      const low = quote.low?.[i];
      const close = quote.close?.[i];
      if (open == null || high == null || low == null || close == null) continue;
      candles.push({
        time: timestamp[i] * 1000,
        open,
        high,
        low,
        close,
        volume: quote.volume?.[i] ?? 0,
      });
    }
  }
  return {
    candles: sortCandles(candles),
    price: meta?.regularMarketPrice,
    changePercent: meta?.regularMarketChangePercent,
    name: meta?.longName || meta?.shortName,
  };
}

export async function loadEquityFile(symbol: string): Promise<EquityFile | null> {
  if (fileCache.has(symbol)) return fileCache.get(symbol) ?? null;
  try {
    const url = new URL(`data/equities/${encodeURIComponent(symbol)}.json`, document.baseURI);
    const response = await fetch(url);
    if (!response.ok) {
      fileCache.set(symbol, null);
      return null;
    }
    const file = (await response.json()) as EquityFile;
    fileCache.set(symbol, file);
    return file;
  } catch {
    fileCache.set(symbol, null);
    return null;
  }
}

export function clearEquityFileCache(symbol?: string): void {
  if (symbol) fileCache.delete(symbol);
  else fileCache.clear();
}

export async function fetchYahooCandles(symbol: string, tf: Timeframe, signal?: AbortSignal): Promise<Candle[]> {
  const key = tf === "4h" ? "1h" : (tf as EquitySeriesKey);
  const plan = YAHOO_PLAN[key];
  if (!plan || !import.meta.env.DEV) return [];
  const url = `/yahoo/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${plan.interval}&range=${plan.range}&includePrePost=false`;
  const payload = await fetchJson(url, { source: "yahoo", gate: gates.yahoo, signal });
  return parseYahooChart(payload).candles;
}
