import { describe, expect, it } from "vitest";
import { parseYahooChart, rowsToCandles } from "./equities";

describe("yahoo candles", () => {
  it("repairs a published series that still has the close print and a split week", () => {
    const candles = rowsToCandles(
      [
        [Date.parse("2026-11-23T05:00:00Z"), 724.33, 727.98, 712.14, 718.78, 152_627_000],
        [Date.parse("2026-11-25T20:29:56Z"), 703.2, 718.43, 695.45, 715.57, 57_286_999],
      ],
      "1w",
    );
    expect(candles).toHaveLength(1);
    expect(candles[0].time).toBe(Date.parse("2026-11-23T05:00:00Z"));
    expect(candles[0].close).toBeCloseTo(715.57);
    expect(candles[0].low).toBeCloseTo(695.45);
    expect(candles[0].volume).toBe(152_627_000 + 57_286_999);
  });

  it("fills a null daily close from the chart price", () => {
    const parsed = parseYahooChart(
      {
        chart: {
          result: [
            {
              timestamp: [Date.parse("2026-11-25T14:30:00Z") / 1000],
              indicators: { quote: [{ open: [703.2], high: [718.43], low: [695.45], close: [null], volume: [72_380_475] }] },
              meta: { regularMarketPrice: 716.7, shortName: "SPY" },
            },
          ],
        },
      },
      "1d",
    );
    expect(parsed.name).toBe("SPY");
    expect(parsed.candles).toHaveLength(1);
    expect(parsed.candles[0].close).toBeCloseTo(716.7);
    expect(parsed.candles[0].time).toBe(Date.parse("2026-11-25T14:30:00Z"));
  });
});
