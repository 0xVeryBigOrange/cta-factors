import { describe, expect, it } from "vitest";
import { acceptPublishedEquity, mergeEquityFile, publishedEquityUrl, usableSeries } from "./equity-cache.mjs";

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
    expect(merged.file.price).toBe(689);
    expect(merged.file.name).toBe("State Street");
    expect(merged.file.changePercent).toBe(0.2);
  });

  it("keeps the previous timestamp when this run produced no bars", () => {
    const merged = mergeEquityFile(
      { symbol: "SPY", source: "yahoo", fetchedAt: 900, series: {} },
      previous,
    );
    expect(merged.filled).toEqual(["5m", "1d"]);
    expect(merged.file.fetchedAt).toBe(100);
    expect(merged.file.price).toBe(500);
    expect(merged.file.name).toBe("SPDR");
  });
});
