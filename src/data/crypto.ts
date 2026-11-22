import type { Candle, Timeframe } from "../types";
import { timeframeMs } from "../types";
import { fetchJson, gates, HttpError, sourceIsDown } from "./http";
import { resample, sortCandles } from "./resample";

const BINANCE_INTERVAL: Record<Timeframe, string> = {
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1h",
  "4h": "4h",
  "1d": "1d",
  "1w": "1w",
};

const OKX_BAR: Record<Timeframe, string> = {
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1H",
  "4h": "4H",
  "1d": "1D",
  "1w": "1W",
};

const GATE_INTERVAL: Record<Timeframe, string> = {
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1h",
  "4h": "4h",
  "1d": "1d",
  "1w": "7d",
};

const BITGET_GRANULARITY: Record<Timeframe, string> = {
  "5m": "5min",
  "15m": "15min",
  "30m": "30min",
  "1h": "1h",
  "4h": "4h",
  "1d": "1day",
  "1w": "1week",
};

const KRAKEN_INTERVAL: Record<Timeframe, number> = {
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "4h": 240,
  "1d": 1440,
  "1w": 10080,
};

const COINBASE_GRANULARITY: Partial<Record<Timeframe, number>> = {
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "1d": 86400,
};

const GECKO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  BNB: "binancecoin",
  XRP: "ripple",
  DOGE: "dogecoin",
  ADA: "cardano",
  AVAX: "avalanche-2",
  LINK: "chainlink",
  DOT: "polkadot",
  TON: "the-open-network",
  TRX: "tron",
  SHIB: "shiba-inu",
  LTC: "litecoin",
  BCH: "bitcoin-cash",
  UNI: "uniswap",
  ATOM: "cosmos",
  NEAR: "near",
  APT: "aptos",
  FIL: "filecoin",
  OP: "optimism",
  ARB: "arbitrum",
  SUI: "sui",
  INJ: "injective-protocol",
  AAVE: "aave",
  TIA: "celestia",
  HBAR: "hedera-hashgraph",
  XLM: "stellar",
};

const cooldown = new Map<string, number>();

export type CandleBundle = { candles: Candle[]; source: string };

function cooled(id: string): boolean {
  return (cooldown.get(id) ?? 0) > Date.now();
}

function penalize(id: string): void {
  cooldown.set(id, Date.now() + 3 * 60_000);
}

function makeCandle(time: number, open: unknown, high: unknown, low: unknown, close: unknown, volume: unknown): Candle | null {
  const candle: Candle = {
    time: time < 1e12 ? time * 1000 : time,
    open: Number(open),
    high: Number(high),
    low: Number(low),
    close: Number(close),
    volume: Number(volume) || 0,
  };
  if (![candle.time, candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) || candle.close <= 0) return null;
  return candle;
}

function spacingOk(candles: Candle[], tf: Timeframe): boolean {
  if (candles.length < 3) return candles.length > 0;
  const deltas = [];
  for (let i = 1; i < candles.length; i++) deltas.push(candles[i].time - candles[i - 1].time);
  deltas.sort((a, b) => a - b);
  const median = deltas[Math.floor(deltas.length / 2)];
  const expected = timeframeMs(tf);
  return median > expected * 0.45 && median < expected * 2.2;
}

async function fromBinance(base: string, tf: Timeframe, signal?: AbortSignal): Promise<Candle[]> {
  const url = `https://data-api.binance.vision/api/v3/klines?symbol=${base}USDT&interval=${BINANCE_INTERVAL[tf]}&limit=1000`;
  const data = await fetchJson(url, { source: "binance", gate: gates.binance, signal });
  if (!Array.isArray(data)) return [];
  return sortCandles(
    data.flatMap((row) => {
      if (!Array.isArray(row)) return [];
      const candle = makeCandle(Number(row[0]), row[1], row[2], row[3], row[4], row[5]);
      return candle ? [candle] : [];
    }),
  );
}

async function fromOkx(base: string, tf: Timeframe, signal?: AbortSignal): Promise<Candle[]> {
  const url = `https://www.okx.com/api/v5/market/candles?instId=${base}-USDT&bar=${OKX_BAR[tf]}&limit=300`;
  const data = (await fetchJson(url, { source: "okx", gate: gates.okx, signal })) as { code?: string; data?: unknown[] };
  if (data.code && data.code !== "0") return [];
  const rows = data.data ?? [];
  return sortCandles(
    rows.flatMap((row) => {
      if (!Array.isArray(row)) return [];
      const candle = makeCandle(Number(row[0]), row[1], row[2], row[3], row[4], row[5]);
      return candle ? [candle] : [];
    }),
  );
}

async function fromGate(base: string, tf: Timeframe, signal?: AbortSignal): Promise<Candle[]> {
  const url = `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${base}_USDT&interval=${GATE_INTERVAL[tf]}&limit=999`;
  const data = await fetchJson(url, { source: "gate", gate: gates.gate, signal });
  if (!Array.isArray(data)) return [];
  return sortCandles(
    data.flatMap((row) => {
      if (!Array.isArray(row)) return [];
      const candle = makeCandle(Number(row[0]), row[5], row[3], row[4], row[2], row[6]);
      return candle ? [candle] : [];
    }),
  );
}

async function fromBitget(base: string, tf: Timeframe, signal?: AbortSignal): Promise<Candle[]> {
  const url = `https://api.bitget.com/api/v2/spot/market/candles?symbol=${base}USDT&granularity=${BITGET_GRANULARITY[tf]}&limit=1000`;
  const data = (await fetchJson(url, { source: "bitget", gate: gates.bitget, signal })) as { code?: string; data?: unknown[] };
  if (data.code && data.code !== "00000") return [];
  return sortCandles(
    (data.data ?? []).flatMap((row) => {
      if (!Array.isArray(row)) return [];
      const candle = makeCandle(Number(row[0]), row[1], row[2], row[3], row[4], row[5]);
      return candle ? [candle] : [];
    }),
  );
}

async function fromKraken(base: string, tf: Timeframe, signal?: AbortSignal): Promise<Candle[]> {
  const pair = `${base === "BTC" ? "XBT" : base}USDT`;
  const url = `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${KRAKEN_INTERVAL[tf]}`;
  const data = (await fetchJson(url, { source: "kraken", gate: gates.kraken, signal })) as {
    error?: string[];
    result?: Record<string, unknown>;
  };
  if (data.error?.length) return [];
  const rows = Object.entries(data.result ?? {}).find(([key]) => key !== "last")?.[1];
  if (!Array.isArray(rows)) return [];
  return sortCandles(
    rows.flatMap((row) => {
      if (!Array.isArray(row)) return [];
      const candle = makeCandle(Number(row[0]), row[1], row[2], row[3], row[4], row[6]);
      return candle ? [candle] : [];
    }),
  );
}

async function fromCoinbase(base: string, tf: Timeframe, signal?: AbortSignal): Promise<Candle[]> {
  const granularity = COINBASE_GRANULARITY[tf];
  if (!granularity) return [];
  const url = `https://api.exchange.coinbase.com/products/${base}-USD/candles?granularity=${granularity}`;
  const data = await fetchJson(url, { source: "coinbase", gate: gates.coinbase, signal });
  if (!Array.isArray(data)) return [];
  return sortCandles(
    data.flatMap((row) => {
      if (!Array.isArray(row)) return [];
      const candle = makeCandle(Number(row[0]), row[3], row[2], row[1], row[4], row[5]);
      return candle ? [candle] : [];
    }),
  );
}

async function fromCoinGecko(base: string, tf: Timeframe, signal?: AbortSignal): Promise<Candle[]> {
  if (tf === "5m" || tf === "15m" || tf === "30m" || tf === "1h") return [];
  const id = GECKO_IDS[base];
  if (!id) return [];
  const days = tf === "4h" ? 30 : 180;
  const url = `https://api.coingecko.com/api/v3/coins/${id}/ohlc?vs_currency=usd&days=${days}`;
  const data = await fetchJson(url, { source: "coingecko", gate: gates.gecko, signal });
  if (!Array.isArray(data)) return [];
  let candles = sortCandles(
    data.flatMap((row) => {
      if (!Array.isArray(row)) return [];
      const candle = makeCandle(Number(row[0]), row[1], row[2], row[3], row[4], 0);
      return candle ? [candle] : [];
    }),
  );
  if (tf === "1w") candles = resample(candles, timeframeMs("1w"));
  return candles;
}

const PROVIDERS: { id: string; label: string; fetch: (base: string, tf: Timeframe, signal?: AbortSignal) => Promise<Candle[]> }[] = [
  { id: "binance", label: "Binance", fetch: fromBinance },
  { id: "okx", label: "OKX", fetch: fromOkx },
  { id: "gate", label: "Gate.io", fetch: fromGate },
  { id: "bitget", label: "Bitget", fetch: fromBitget },
  { id: "kraken", label: "Kraken", fetch: fromKraken },
  { id: "coinbase", label: "Coinbase", fetch: fromCoinbase },
  { id: "coingecko", label: "CoinGecko", fetch: fromCoinGecko },
];

export async function fetchCryptoCandles(base: string, tf: Timeframe, signal?: AbortSignal): Promise<CandleBundle> {
  let best: CandleBundle | null = null;
  let lastError: unknown = null;
  for (const provider of PROVIDERS) {
    if (cooled(provider.id)) continue;
    try {
      const candles = await provider.fetch(base, tf, signal);
      if (candles.length < 20 || !spacingOk(candles, tf)) continue;
      if (!best || candles.length > best.candles.length) best = { candles, source: provider.label };
      if (candles.length >= 240) return best;
    } catch (error) {
      lastError = error;
      if (sourceIsDown(error)) penalize(provider.id);
    }
  }
  if (best) return best;
  if (lastError instanceof HttpError) throw lastError;
  throw new HttpError(`找不到 ${base}USDT 的 ${tf} 行情`, 404, "crypto");
}

export async function fetchCryptoQuote(
  base: string,
  signal?: AbortSignal,
): Promise<{ price: number; changePercent: number } | null> {
  try {
    const data = (await fetchJson(`https://data-api.binance.vision/api/v3/ticker/24hr?symbol=${base}USDT`, {
      source: "binance",
      gate: gates.binance,
      signal,
    })) as { lastPrice?: string; priceChangePercent?: string };
    const price = Number(data.lastPrice);
    const changePercent = Number(data.priceChangePercent);
    if (!Number.isFinite(price)) return null;
    return { price, changePercent: Number.isFinite(changePercent) ? changePercent : 0 };
  } catch {
    return null;
  }
}

export { BINANCE_INTERVAL };
