import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./http", async () => {
  const actual = await vi.importActual<typeof import("./http")>("./http");
  return {
    ...actual,
    fetchJson: (url: string, options: Parameters<typeof actual.fetchJson>[1]) =>
      actual.fetchJson(url, { ...options, timeoutMs: options.timeoutMs ?? 40 }),
  };
});

import { clearCryptoCooldown, fetchCryptoCandles } from "./crypto";

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
