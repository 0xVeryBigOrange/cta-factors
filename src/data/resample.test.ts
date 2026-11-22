import { describe, expect, it } from "vitest";
import { resample } from "./resample";
import { parseTencentKlines, parseTencentQuote } from "./tencent";

describe("resample", () => {
  it("rolls four hourly bars into one 4h bar", () => {
    const bars = [0, 1, 2, 3].map((i) => ({
      time: Date.UTC(2024, 0, 1, i),
      open: 10 + i,
      high: 12 + i,
      low: 9,
      close: 11 + i,
      volume: 5,
    }));
    const out = resample(bars, 4 * 60 * 60_000);
    expect(out).toHaveLength(1);
    expect(out[0].open).toBe(10);
    expect(out[0].close).toBe(14);
    expect(out[0].high).toBe(15);
    expect(out[0].low).toBe(9);
    expect(out[0].volume).toBe(20);
  });
});

describe("tencent parsers", () => {
  it("reads daily rows as open, close, high, low, volume", () => {
    const candles = parseTencentKlines(
      {
        code: 0,
        data: {
          "usAAPL.OQ": {
            day: [["2026-11-20", "352.87", "342.56", "354.34", "340.56", "80692545"]],
          },
        },
      },
      "usAAPL.OQ",
      "day",
    );
    expect(candles).toHaveLength(1);
    expect(candles[0].open).toBeCloseTo(352.87);
    expect(candles[0].close).toBeCloseTo(342.56);
    expect(candles[0].high).toBeCloseTo(354.34);
    expect(candles[0].low).toBeCloseTo(340.56);
    expect(candles[0].volume).toBe(80692545);
  });

  it("reads the delayed quote fields used for last price", () => {
    const quote = parseTencentQuote(
      'v_usAAPL="200~苹果~AAPL.OQ~342.56~349.21~352.87~80692545~~~~~~~~~~~~~~~~~~~~~~~~~~2026-11-20 16:00:04~-6.65~-1.90~354.34~340.56~USD";',
    );
    expect(quote?.price).toBeCloseTo(342.56);
    expect(quote?.changePercent).toBeCloseTo(-1.9);
    expect(quote?.name).toBe("苹果");
  });
});
