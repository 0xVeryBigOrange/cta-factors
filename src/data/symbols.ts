import type { Market, WatchItem } from "../types";
import universe from "./universe.json";

export type ListedSymbol = {
  symbol: string;
  name: string;
  tencent?: string;
};

export const CRYPTO_UNIVERSE: ListedSymbol[] = universe.crypto;
export const STOCK_UNIVERSE: ListedSymbol[] = universe.stocks;

export const DEFAULT_WATCHLIST: WatchItem[] = [
  ...["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ADA", "AVAX", "LINK", "DOT"].map((symbol) => ({
    market: "crypto" as const,
    symbol,
  })),
  ...["AAPL", "NVDA", "TSLA", "MSFT", "AMZN", "META", "GOOGL", "SPY", "QQQ"].map((symbol) => ({
    market: "stock" as const,
    symbol,
  })),
];

export function displayName(market: Market, symbol: string): string {
  const list = market === "crypto" ? CRYPTO_UNIVERSE : STOCK_UNIVERSE;
  return list.find((item) => item.symbol === symbol)?.name ?? symbol;
}

export function tencentPreset(symbol: string): string | undefined {
  return STOCK_UNIVERSE.find((item) => item.symbol === symbol)?.tencent;
}

export function searchSymbols(query: string): { market: Market; symbol: string; name: string }[] {
  const text = query.trim().toLowerCase();
  if (!text) return [];
  const crypto = CRYPTO_UNIVERSE.filter((item) => item.symbol.toLowerCase().includes(text) || item.name.toLowerCase().includes(text)).map(
    (item) => ({ market: "crypto" as const, symbol: item.symbol, name: item.name }),
  );
  const stocks = STOCK_UNIVERSE.filter((item) => item.symbol.toLowerCase().includes(text) || item.name.toLowerCase().includes(text)).map(
    (item) => ({ market: "stock" as const, symbol: item.symbol, name: item.name }),
  );
  return [...crypto, ...stocks].slice(0, 10);
}

export function normalizeSymbol(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9.]/g, "");
}

export function canBeCrypto(symbol: string): boolean {
  return /^[A-Z0-9]{2,12}$/.test(symbol);
}

export function canBeStock(symbol: string): boolean {
  return /^[A-Z][A-Z.]{0,5}$/.test(symbol);
}

export function sameItem(a: WatchItem, b: WatchItem): boolean {
  return a.market === b.market && a.symbol === b.symbol;
}
