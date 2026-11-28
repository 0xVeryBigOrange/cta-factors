import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./http", async () => {
  const actual = await vi.importActual<typeof import("./http")>("./http");
  return {
    ...actual,
    fetchJson: (url: string, options: Parameters<typeof actual.fetchJson>[1]) =>
      actual.fetchJson(url, { ...options, timeoutMs: options.timeoutMs ?? 40 }),
  };
});

import { clearCryptoCooldown, coinGeckoDailyCandles, fetchCryptoCandles } from "./crypto";

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  clearCryptoCooldown();
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function hourly(count: number): unknown[][] {
  const start = Date.UTC(2024, 0, 1);
  return Array.from({ length: count }, (_, index) => [start + index * 3_600_000, "100", "110", "90", "105", "12"]);
}

describe("crypto source fallback", () => {
  it("uses the first source that returns a long enough series", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      seen.push(String(url));
      return Promise.resolve(json(hourly(240)));
    });
    const bundle = await fetchCryptoCandles("BTC", "1h");
    expect(bundle.source).toBe("Binance");
    expect(bundle.candles).toHaveLength(240);
    expect(seen.some((url) => url.includes("okx.com"))).toBe(false);
  });

  it("skips a source that hangs and keeps the next long series", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      const href = String(url);
      seen.push(href);
      if (href.includes("binance")) {
        return new Promise((_resolve, reject) => {
          const fail = () => reject(new DOMException("Aborted", "AbortError"));
          if (init?.signal?.aborted) {
            fail();
            return;
          }
          init?.signal?.addEventListener("abort", fail, { once: true });
        });
      }
      if (href.includes("okx.com")) return Promise.resolve(json({ code: "0", data: hourly(240) }));
      return Promise.resolve(json([]));
    });
    const started = Date.now();
    const bundle = await fetchCryptoCandles("ETH", "1h");
    expect(bundle.source).toBe("OKX");
    expect(bundle.candles).toHaveLength(240);
    expect(bundle.candles[0].time).toBe(Date.UTC(2024, 0, 1));
    expect(seen.some((url) => url.includes("gateio"))).toBe(false);
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it("stops walking sources when the caller aborts", async () => {
    const controller = new AbortController();
    const seen: string[] = [];
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      seen.push(String(url));
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        setTimeout(() => controller.abort(), 15);
      });
    });
    await expect(fetchCryptoCandles("SOL", "1h", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(seen.some((url) => url.includes("okx.com"))).toBe(false);
  });
});

function dailyChart(days: number, trailing = false): { prices: number[][]; total_volumes: number[][] } {
  const start = Date.UTC(2024, 0, 1);
  const prices: number[][] = [];
  const total_volumes: number[][] = [];
  for (let i = 0; i < days; i++) {
    const time = start + i * 86_400_000;
    prices.push([time, 100 + i]);
    total_volumes.push([time, 1_000 + i]);
  }
  if (trailing) {
    const time = start + (days - 1) * 86_400_000 + 2 * 3_600_000;
    prices.push([time, 50]);
    total_volumes.push([time, 9_999]);
  }
  return { prices, total_volumes };
}

describe("CoinGecko daily fallback", () => {
  it("folds the trailing intraday print into the same UTC day", () => {
    const candles = coinGeckoDailyCandles(dailyChart(3, true).prices, dailyChart(3, true).total_volumes);
    expect(candles).toHaveLength(3);
    expect(candles[2].time).toBe(Date.UTC(2024, 0, 3));
    expect(candles[2].open).toBe(102);
    expect(candles[2].close).toBe(50);
    expect(candles[2].high).toBe(102);
    expect(candles[2].low).toBe(50);
    expect(candles[2].volume).toBe(9_999);
  });

  it("uses the daily market chart for 1d instead of 4-day OHLC", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      const href = String(url);
      seen.push(href);
      if (href.includes("market_chart")) return Promise.resolve(json(dailyChart(30, true)));
      return Promise.resolve(json([]));
    });
    const bundle = await fetchCryptoCandles("BTC", "1d");
    expect(bundle.source).toBe("CoinGecko");
    expect(bundle.candles).toHaveLength(30);
    expect(bundle.candles[0].time).toBe(Date.UTC(2024, 0, 1));
    expect(bundle.candles[29].close).toBe(50);
    expect(bundle.candles[29].volume).toBe(9_999);
    expect(bundle.candles[29].time - bundle.candles[28].time).toBe(86_400_000);
    expect(seen.some((url) => url.includes("ohlc"))).toBe(false);
    expect(seen.some((url) => url.includes("interval=daily"))).toBe(true);
  });

  it("keeps 4h on the 30-day OHLC endpoint", async () => {
    const seen: string[] = [];
    const start = Date.UTC(2024, 0, 1);
    vi.stubGlobal("fetch", (url: string) => {
      const href = String(url);
      seen.push(href);
      if (href.includes("/ohlc")) {
        const rows = Array.from({ length: 24 }, (_, index) => {
          const price = 100 + index;
          return [start + index * 4 * 3_600_000, price, price + 1, price - 1, price];
        });
        return Promise.resolve(json(rows));
      }
      return Promise.resolve(json([]));
    });
    const bundle = await fetchCryptoCandles("ETH", "4h");
    expect(bundle.source).toBe("CoinGecko");
    expect(bundle.candles).toHaveLength(24);
    expect(bundle.candles[0].volume).toBe(0);
    expect(seen.some((url) => url.includes("days=30"))).toBe(true);
    expect(seen.some((url) => url.includes("market_chart"))).toBe(false);
  });

  it("builds Monday weekly bars from the daily chart", async () => {
    vi.stubGlobal("fetch", (url: string) => {
      if (String(url).includes("market_chart")) return Promise.resolve(json(dailyChart(21 * 7)));
      return Promise.resolve(json([]));
    });
    const bundle = await fetchCryptoCandles("SOL", "1w");
    expect(bundle.source).toBe("CoinGecko");
    expect(bundle.candles).toHaveLength(21);
    expect(bundle.candles[0].time).toBe(Date.UTC(2024, 0, 1));
    expect(bundle.candles[0].open).toBe(100);
    expect(bundle.candles[0].close).toBe(106);
    expect(bundle.candles[1].time - bundle.candles[0].time).toBe(7 * 86_400_000);
  });
});
