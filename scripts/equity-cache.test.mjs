import { describe, expect, it } from "vitest";
import { acceptPublishedEquity, mergeEquityFile, normalizeYahooBars, publishedEquityUrl, usableSeries, yahooShouldRetry } from "./equity-cache.mjs";

const previous = {
  symbol: "SPY",
  source: "yahoo",
  fetchedAt: 100,
  name: "SPDR",
  price: 500,
  changePercent: 0.2,
  series: { "5m": [[1, 1, 1, 1, 1, 1]], "1d": [[2, 2, 2, 2, 2, 2]] },
};

describe("published equity cache", () => {
  it("builds the pages url for a symbol", () => {
    expect(publishedEquityUrl("BRK.B")).toBe(
      "https://0xverybigorange.github.io/cta-factors/data/equities/BRK.B.json",
    );
  });

  it("rejects a cache that is empty or for another symbol", () => {
    expect(usableSeries({ "1d": [] })).toBe(false);
    expect(acceptPublishedEquity({ ...previous, series: { "1d": [] } }, "SPY")).toBeNull();
    expect(acceptPublishedEquity(previous, "AAPL")).toBeNull();
    expect(acceptPublishedEquity({ ...previous, source: "other" }, "SPY")).toBeNull();
    expect(acceptPublishedEquity(previous, "SPY")).toBe(previous);
  });

  it("keeps fresh bars and fills only the missing timeframes", () => {
    const merged = mergeEquityFile(
      {
        symbol: "SPY",
        source: "yahoo",
        fetchedAt: 900,
        name: "State Street",
        price: 689,
        series: { "1d": [[9, 9, 9, 9, 9, 9]] },
      },
      previous,
    );
    expect(merged.filled).toEqual(["5m"]);
    expect(merged.file.series["1d"]).toEqual([[9, 9, 9, 9, 9, 9]]);
    expect(merged.file.series["5m"]).toEqual([[1, 1, 1, 1, 1, 1]]);
    expect(merged.file.fetchedAt).toBe(900);
    expect(merged.file.seriesFetchedAt).toEqual({ "1d": 900, "5m": 100 });
    expect(merged.file.price).toBe(689);
    expect(merged.file.name).toBe("State Street");
    expect(merged.file.changePercent).toBe(0.2);
  });

  it("keeps an older per-series stamp when that timeframe is backfilled", () => {
    const merged = mergeEquityFile(
      {
        symbol: "SPY",
        source: "yahoo",
        fetchedAt: 900,
        seriesFetchedAt: { "1d": 880 },
        series: { "1d": [[9, 9, 9, 9, 9, 9]] },
      },
      { ...previous, seriesFetchedAt: { "5m": 80, "1d": 100 } },
    );
    expect(merged.filled).toEqual(["5m"]);
    expect(merged.file.seriesFetchedAt).toEqual({ "1d": 880, "5m": 80 });
    expect(merged.file.fetchedAt).toBe(900);
  });

  it("keeps the previous timestamp when this run produced no bars", () => {
    const merged = mergeEquityFile(
      { symbol: "SPY", source: "yahoo", fetchedAt: 900, series: {} },
      previous,
    );
    expect(merged.filled).toEqual(["5m", "1d"]);
    expect(merged.file.fetchedAt).toBe(100);
    expect(merged.file.seriesFetchedAt).toEqual({ "5m": 100, "1d": 100 });
    expect(merged.file.price).toBe(500);
    expect(merged.file.name).toBe("SPDR");
  });
});

describe("yahoo close prints", () => {
  const at = (iso) => Date.parse(iso);

  it("drops a trailing zero-volume print and keeps the real intraday close", () => {
    const bars = normalizeYahooBars(
      [
        [at("2026-11-25T20:55:00Z"), 716.74, 718.41, 716.15, 716.71, 3_693_325],
        [at("2026-11-25T21:00:00Z"), 716.7, 716.7, 716.7, 716.7, 0],
      ],
      "5m",
      716.7,
    );
    expect(bars).toEqual([[at("2026-11-25T20:55:00Z"), 716.74, 718.41, 716.15, 716.71, 3_693_325]]);
  });

  it("drops an in-session quote stamped at the fetch second", () => {
    const bars = normalizeYahooBars(
      [
        [at("2026-11-25T20:25:00Z"), 716.03, 716.29, 715.58, 715.92, 281_388],
        [at("2026-11-25T20:29:56Z"), 715.705, 715.705, 715.705, 715.705, 0],
      ],
      "1h",
    );
    expect(bars).toHaveLength(1);
    expect(bars[0][0]).toBe(at("2026-11-25T20:25:00Z"));
    expect(bars[0][4]).toBe(715.92);
  });

  it("keeps a zero-volume bar that still has a range, and a flat print that is not last", () => {
    const rows = [
      [at("2026-11-25T20:00:00Z"), 10, 10, 10, 10, 0],
      [at("2026-11-25T20:30:00Z"), 10, 11, 9, 10.5, 0],
    ];
    expect(normalizeYahooBars(rows, "1h")).toEqual(rows);
  });

  it("fills a null daily close from the official price without moving a finished bar", () => {
    const tuesday = [at("2026-11-24T14:30:00Z"), 715.15, 720.93, 712.14, 718.78, 64_343_200];
    const bars = normalizeYahooBars(
      [tuesday, [at("2026-11-25T14:30:00Z"), 703.2, 718.43, 695.45, null, 72_380_475]],
      "1d",
      716.7,
    );
    expect(bars[0]).toEqual(tuesday);
    expect(bars[1]).toEqual([at("2026-11-25T14:30:00Z"), 703.2, 718.43, 695.45, 716.7, 72_380_475]);
  });

  it("extends the daily range when the official close is outside it", () => {
    const bars = normalizeYahooBars([[1, 10, 11, 9, null, 100]], "1d", 12);
    expect(bars).toEqual([[1, 10, 12, 9, 12, 100]]);
  });

  it("drops a bar that still has no close", () => {
    const prior = [at("2026-11-24T14:30:00Z"), 10, 11, 9, 10.5, 100];
    expect(normalizeYahooBars([prior, [at("2026-11-25T14:30:00Z"), 10, 11, 9, null, 80]], "1d")).toEqual([prior]);
  });

  it("folds the session Yahoo split off the weekly candle back into that week", () => {
    const older = [at("2026-11-16T05:00:00Z"), 749.66, 749.82, 686.75, 689.81, 420_764_300];
    const bars = normalizeYahooBars(
      [
        older,
        [at("2026-11-23T05:00:00Z"), 724.33, 727.98, 712.14, 718.78, 152_627_000],
        [at("2026-11-25T21:00:00Z"), 703.2, 718.43, 695.45, 716.7, 72_380_475],
      ],
      "1wk",
      716.7,
    );
    expect(bars).toHaveLength(2);
    expect(bars[0]).toEqual(older);
    expect(bars[1]).toEqual([
      at("2026-11-23T05:00:00Z"),
      724.33,
      727.98,
      695.45,
      716.7,
      152_627_000 + 72_380_475,
    ]);
  });

  it("leaves Monday-stamped weekly bars a week apart, including daylight time", () => {
    const rows = [
      [at("2026-11-16T05:00:00Z"), 749.66, 749.82, 686.75, 689.81, 420_764_300],
      [at("2026-11-23T05:00:00Z"), 724.33, 727.98, 712.14, 718.78, 152_627_000],
    ];
    const summer = [
      [at("2026-06-01T04:00:00Z"), 1, 2, 1, 1.5, 10],
      [at("2026-06-08T04:00:00Z"), 1.5, 2, 1, 1.8, 12],
    ];
    expect(normalizeYahooBars(rows, "1w", 999)).toEqual(rows);
    expect(normalizeYahooBars(summer, "1wk")).toEqual(summer);
    expect(normalizeYahooBars(normalizeYahooBars(rows, "1wk"), "1wk")).toEqual(rows);
  });
});

describe("yahoo retries", () => {
  it("retries rate limits, gateway errors, and network failures only while attempts remain", () => {
    for (const status of [429, 500, 502, 503, 504]) expect(yahooShouldRetry(status, "", 0)).toBe(true);
    expect(yahooShouldRetry(429, "", 2)).toBe(false);
    expect(yahooShouldRetry(404, "", 0)).toBe(false);
    expect(yahooShouldRetry(undefined, "TypeError", 1)).toBe(true);
    expect(yahooShouldRetry(undefined, "TimeoutError", 0)).toBe(false);
    expect(yahooShouldRetry(undefined, "AbortError", 0)).toBe(false);
    expect(yahooShouldRetry(undefined, "SyntaxError", 0)).toBe(false);
  });
});
