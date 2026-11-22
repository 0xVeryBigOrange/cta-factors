import type { Candle } from "../types";
import { fetchText, gates } from "./http";
import { sortCandles } from "./resample";

export type TencentQuote = {
  code: string;
  name?: string;
  price?: number;
  changePercent?: number;
};

const CODE_CACHE = new Map<string, string | null>();

export function knownTencentCode(symbol: string, preset?: string): string[] {
  if (preset) return [preset];
  return [`us${symbol}.OQ`, `us${symbol}.N`, `us${symbol}.AM`, `us${symbol}.PS`];
}

export function parseTencentKlines(payload: unknown, code: string, period: "day" | "week"): Candle[] {
  const rows = (payload as { data?: Record<string, Record<string, unknown[]>> })?.data?.[code]?.[period];
  if (!Array.isArray(rows)) return [];
  const candles: Candle[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const time = Date.parse(`${row[0]}T00:00:00Z`);
    const open = Number(row[1]);
    const close = Number(row[2]);
    const high = Number(row[3]);
    const low = Number(row[4]);
    const volume = Number(row[5]);
    if (!Number.isFinite(time) || !Number.isFinite(close) || close <= 0) continue;
    candles.push({
      time,
      open: Number.isFinite(open) ? open : close,
      high: Number.isFinite(high) ? high : close,
      low: Number.isFinite(low) ? low : close,
      close,
      volume: Number.isFinite(volume) ? volume : 0,
    });
  }
  return sortCandles(candles);
}

export function parseTencentQuote(text: string): TencentQuote | null {
  return parseTencentQuotes(text)[0] ?? null;
}

export function parseTencentQuotes(text: string): TencentQuote[] {
  const quotes: TencentQuote[] = [];
  const pattern = /v_([^=\s]+)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const fields = match[2].split("~");
    const price = Number(fields[3]);
    const previous = Number(fields[4]);
    let changePercent = Number(fields[32]);
    if (!Number.isFinite(changePercent) && Number.isFinite(price) && Number.isFinite(previous) && previous !== 0) {
      changePercent = ((price - previous) / previous) * 100;
    }
    quotes.push({
      code: (fields[2] || match[1]).toUpperCase(),
      name: fields[1] || undefined,
      price: Number.isFinite(price) && price > 0 ? price : undefined,
      changePercent: Number.isFinite(changePercent) ? changePercent : undefined,
    });
  }
  return quotes;
}

export async function fetchTencentKlines(
  code: string,
  period: "day" | "week",
  limit: number,
  signal?: AbortSignal,
): Promise<Candle[]> {
  const url = `https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=${code},${period},,,${limit},`;
  const text = await fetchText(url, { source: "tencent", gate: gates.tencent, signal });
  const payload = JSON.parse(text) as unknown;
  return parseTencentKlines(payload, code, period);
}

export async function resolveTencentCode(symbol: string, preset: string | undefined, signal?: AbortSignal): Promise<string | null> {
  const cached = CODE_CACHE.get(symbol);
  if (cached !== undefined) return cached;
  for (const code of knownTencentCode(symbol, preset)) {
    try {
      const candles = await fetchTencentKlines(code, "day", 3, signal);
      if (candles.length) {
        CODE_CACHE.set(symbol, code);
        return code;
      }
    } catch {
      /* try the next suffix */
    }
  }
  CODE_CACHE.set(symbol, null);
  return null;
}

export async function fetchTencentQuotes(codes: string[], signal?: AbortSignal): Promise<TencentQuote[]> {
  if (!codes.length) return [];
  const url = `https://qt.gtimg.cn/q=${codes.join(",")}`;
  const text = await fetchText(url, { source: "tencent", gate: gates.tencent, signal });
  return parseTencentQuotes(text);
}
