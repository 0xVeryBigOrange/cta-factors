import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Candle } from "../types";
import { ema, rsi, sma } from "./indicators";
import { aggregate, forecastDiversificationMultiplier, longProbability } from "./aggregate";
import { carverForecast } from "./score";
import { factorHistory } from "./history";
import { evaluateAggregate } from "./evaluate";
import { FACTORS } from "./catalog";

function candles(closes: number[], volume = 1_000): Candle[] {
  return closes.map((close, i) => ({
    time: i * 60_000,
    open: close,
    high: close + 0.5,
    low: close - 0.5,
    close,
    volume,
  }));
}

function trend(count: number, start: number, step: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const close = start + step * i;
    out.push({
      time: Date.UTC(2024, 0, 1) + i * 3_600_000,
      open: close - step * 0.25,
      high: close + Math.abs(step) * 0.2 + 0.1,
      low: close - Math.abs(step) * 0.2 - 0.1,
      close,
      volume: 1_000 + i,
    });
  }
  return out;
}

describe("moving averages and RSI", () => {
  it("computes a simple moving average", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([NaN, NaN, 2, 3, 4]);
  });

  it("seeds EMA with the first SMA then applies the smoothing constant", () => {
    const series = ema([1, 2, 3, 4, 5], 3);
    expect(series[2]).toBeCloseTo(2);
    expect(series[3]).toBeCloseTo(3);
    expect(series[4]).toBeCloseTo(4);
  });

  it("matches Wilder RSI on a short series", () => {
    const values = rsi([10, 11, 12, 11, 10, 11, 13, 14], 3);
    expect(values[3]).toBeCloseTo(66.6667, 3);
    expect(values[4]).toBeCloseTo(44.4444, 3);
    expect(values[values.length - 1]).toBeGreaterThan(50);
  });
});

describe("factor directions on sample paths", () => {
  const up = trend(280, 100, 1);
  const down = trend(280, 400, -1);

  it("reads a steady uptrend as net long and a downtrend as net short", () => {
    const bull = evaluateAggregate(up, { timeframe: "1h", derivatives: null }, "stock");
    const bear = evaluateAggregate(down, { timeframe: "1h", derivatives: null }, "stock");
    expect(bull.insufficient).toBe(false);
    expect(bull.probability).toBeGreaterThan(0.62);
    expect(bear.probability).toBeLessThan(0.38);
    expect(bull.score).toBeGreaterThan(0);
    expect(bear.score).toBeLessThan(0);
  });

  it("treats a bollinger spike as mean-reversion short", () => {
    const flat = candles(Array.from({ length: 40 }, (_, i) => 100 + (i % 2 === 0 ? 0.15 : -0.15)));
    flat.push({
      time: 40 * 60_000,
      open: 100,
      high: 121,
      low: 99.6,
      close: 120,
      volume: 5_000,
    });
    const cell = FACTORS.find((factor) => factor.id === "bb-pctb");
    const value = cell?.compute(flat, { timeframe: "1h" });
    expect(value?.direction).toBe("short");
    expect(value?.strength).toBeLessThan(0);
  });

  it("keeps supertrend and SAR on the trend side", () => {
    for (const id of ["supertrend", "psar"]) {
      const factor = FACTORS.find((item) => item.id === id);
      expect(factor?.compute(up, { timeframe: "1h" })?.direction).toBe("long");
      expect(factor?.compute(down, { timeframe: "1h" })?.direction).toBe("short");
    }
  });
});

describe("documented factors", () => {
  it("keeps a Chinese definition for every factor in the README", () => {
    const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
    expect(FACTORS.length).toBeGreaterThanOrEqual(40);
    for (const factor of FACTORS) {
      expect(readme).toContain(factor.name);
      expect(readme).toContain(factor.abbr);
      expect(readme).toContain(factor.summary.slice(0, 24));
      if (factor.citation) expect(readme).toContain(factor.citation);
    }
    expect(readme).toContain("@0xVeryBigOrange");
    expect(readme).toContain("https://x.com/0xVeryBigOrange");
  });
});

describe("forecast scaling", () => {
  it("caps a Carver forecast at ±20 and maps it onto ±1", () => {
    expect(carverForecast(100, 5)).toBeCloseTo(1);
    expect(carverForecast(-100, 5)).toBeCloseTo(-1);
    expect(carverForecast(2, 5) * 20).toBeCloseTo(10);
  });

  it("uses a diversification multiplier that shrinks when categories correlate", () => {
    expect(forecastDiversificationMultiplier(1)).toBe(1);
    expect(forecastDiversificationMultiplier(6, 0.35)).toBeCloseTo(Math.sqrt(6 / (1 + 5 * 0.35)), 6);
    expect(forecastDiversificationMultiplier(6, -0.4)).toBeCloseTo(Math.sqrt(6), 6);
    expect(forecastDiversificationMultiplier(40, 0)).toBe(2.5);
  });

  it("reads vol-scaled time-series momentum as long on a steady rise", () => {
    const factor = FACTORS.find((item) => item.id === "tsmom-120");
    expect(factor?.compute(upTrend(), { timeframe: "1h" })?.direction).toBe("long");
    const stat = factorHistory(upTrend(), factor!, { timeframe: "1h" });
    expect(stat.samples).toBeGreaterThanOrEqual(8);
    expect(stat.hitRate ?? 0).toBeGreaterThan(0.6);
    if (stat.ic != null) expect(stat.ic).toBeGreaterThan(0);
  });
});

function upTrend() {
  return trend(280, 100, 1);
}

describe("category-balanced probability", () => {
  it("maps a zero score to 50% and saturates the extremes", () => {
    expect(longProbability(0)).toBeCloseTo(0.5);
    expect(longProbability(1)).toBeGreaterThan(0.94);
    expect(longProbability(-1)).toBeLessThan(0.06);
  });

  it("does not let a crowded category outvote another category", () => {
    const result = aggregate([
      ...Array.from({ length: 12 }, () => ({
        category: "momentum" as const,
        reading: { direction: "long" as const, strength: 1 },
      })),
      { category: "trend", reading: { direction: "short", strength: -1 } },
    ]);
    expect(result.score).toBeCloseTo(0);
    expect(result.probability).toBeCloseTo(0.5, 5);
  });

  it("drops missing factors and whole missing categories", () => {
    const result = aggregate([
      { category: "trend", reading: { direction: "long", strength: 1 } },
      { category: "momentum", reading: null },
      { category: "derivatives", reading: null },
    ]);
    expect(result.categories.map((item) => item.category)).toEqual(["trend"]);
    expect(result.score).toBeCloseTo(1);
    expect(result.probability).toBeGreaterThan(0.94);
  });
});
