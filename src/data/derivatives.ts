import { fetchJson, gates, HttpError } from "./http";
import type { Derivatives } from "../factors/catalog";

type Stat = {
  time?: number;
  open_interest?: number | string;
  lsr_account?: number | string;
  mark_price?: number | string;
};

function asNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function mergePoints<T extends { time: number }>(groups: T[][]): T[] {
  const map = new Map<number, T>();
  for (const group of groups) {
    for (const point of group) map.set(point.time, point);
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

async function gateStats(contract: string, interval: string, limit: number, signal?: AbortSignal): Promise<Stat[]> {
  const url = `https://api.gateio.ws/api/v4/futures/usdt/contract_stats?contract=${contract}&interval=${interval}&limit=${limit}`;
  const data = await fetchJson(url, { source: "gate", gate: gates.gate, signal });
  if (!Array.isArray(data) || data.length === 0) throw new HttpError("gate empty", 404, "gate");
  return data as Stat[];
}

function pointsFromStats(rows: Stat[], field: "open_interest" | "lsr_account"): { time: number; value: number }[] {
  const points: { time: number; value: number }[] = [];
  for (const row of rows) {
    const time = asNumber(row.time);
    const value = asNumber(row[field]);
    if (time == null || value == null) continue;
    points.push({ time: time * 1000, value });
  }
  return points;
}

async function fromGate(base: string, signal?: AbortSignal): Promise<{ data: Derivatives; source: string }> {
  const contract = `${base}_USDT`;
  const [intraday, hourly, daily, fundingRaw, tickerRaw] = await Promise.all([
    gateStats(contract, "5m", 100, signal),
    gateStats(contract, "1h", 200, signal),
    gateStats(contract, "1d", 90, signal),
    fetchJson(`https://api.gateio.ws/api/v4/futures/usdt/funding_rate?contract=${contract}&limit=100`, {
      source: "gate",
      gate: gates.gate,
      signal,
    }),
    fetchJson(`https://api.gateio.ws/api/v4/futures/usdt/tickers?contract=${contract}`, {
      source: "gate",
      gate: gates.gate,
      signal,
    }),
  ]);
  const stats = [intraday, hourly, daily];
  const funding = (Array.isArray(fundingRaw) ? fundingRaw : [])
    .map((row) => {
      const item = row as { r?: string; t?: number };
      const rate = asNumber(item.r);
      const time = asNumber(item.t);
      if (rate == null || time == null) return null;
      return { time: time * 1000, rate };
    })
    .filter((row): row is { time: number; rate: number } => !!row)
    .sort((a, b) => a.time - b.time);
  const ticker = Array.isArray(tickerRaw) ? (tickerRaw[0] as { mark_price?: string; index_price?: string } | undefined) : undefined;
  const mark = asNumber(ticker?.mark_price);
  const index = asNumber(ticker?.index_price);
  const basis = mark != null && index != null && index !== 0 ? (mark - index) / index : null;
  return {
    source: "Gate.io",
    data: {
      funding,
      oi: mergePoints(stats.map((rows) => pointsFromStats(rows, "open_interest"))),
      lsr: mergePoints(stats.map((rows) => pointsFromStats(rows, "lsr_account"))).map((point) => ({
        time: point.time,
        ratio: point.value,
      })),
      basis,
    },
  };
}

async function fromBitget(base: string, signal?: AbortSignal): Promise<{ data: Derivatives; source: string }> {
  const symbol = `${base}USDT`;
  const [fundingRaw, ratioRaw, tickerRaw] = await Promise.all([
    fetchJson(`https://api.bitget.com/api/v2/mix/market/history-fund-rate?symbol=${symbol}&productType=USDT-FUTURES&pageSize=100`, {
      source: "bitget",
      gate: gates.bitget,
      signal,
    }),
    fetchJson(`https://api.bitget.com/api/v2/mix/market/account-long-short?symbol=${symbol}&productType=USDT-FUTURES&period=1h`, {
      source: "bitget",
      gate: gates.bitget,
      signal,
    }),
    fetchJson(`https://api.bitget.com/api/v2/mix/market/ticker?symbol=${symbol}&productType=USDT-FUTURES`, {
      source: "bitget",
      gate: gates.bitget,
      signal,
    }),
  ]);
  const fundingRows = ((fundingRaw as { data?: { fundingRate?: string; fundingTime?: string }[] }).data ?? [])
    .map((row) => {
      const rate = asNumber(row.fundingRate);
      const time = asNumber(row.fundingTime);
      if (rate == null || time == null) return null;
      return { time, rate };
    })
    .filter((row): row is { time: number; rate: number } => !!row)
    .sort((a, b) => a.time - b.time);
  const lsr = ((ratioRaw as { data?: { longShortAccountRatio?: string; ts?: string }[] }).data ?? [])
    .map((row) => {
      const ratio = asNumber(row.longShortAccountRatio);
      const time = asNumber(row.ts);
      if (ratio == null || time == null) return null;
      return { time, ratio };
    })
    .filter((row): row is { time: number; ratio: number } => !!row)
    .sort((a, b) => a.time - b.time);
  const ticker = ((tickerRaw as { data?: Record<string, string>[] }).data ?? [])[0];
  const mark = asNumber(ticker?.markPrice);
  const index = asNumber(ticker?.indexPrice);
  const basis = mark != null && index != null && index !== 0 ? (mark - index) / index : null;
  if (!fundingRows.length && !lsr.length && basis == null) throw new HttpError("bitget empty", 404, "bitget");
  return { source: "Bitget", data: { funding: fundingRows, oi: [], lsr, basis } };
}

export async function fetchDerivatives(base: string, signal?: AbortSignal): Promise<{ data: Derivatives; source: string }> {
  try {
    return await fromGate(base, signal);
  } catch (error) {
    if ((error as { name?: string }).name === "AbortError") throw error;
    return fromBitget(base, signal);
  }
}
