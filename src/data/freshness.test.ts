import { describe, expect, it } from "vitest";
import { equityCacheFreshness, formatCacheAge, lastRegularClose, yahooCacheStatus } from "./freshness";

const MIN = 60_000;

describe("formatCacheAge", () => {
  it("rounds to minutes under an hour and to hours after that", () => {
    expect(formatCacheAge(90_000)).toBe("2 分钟");
    expect(formatCacheAge(5 * 60 * MIN)).toBe("5 小时");
    expect(formatCacheAge(90 * MIN)).toBe("1.5 小时");
  });
});

describe("last regular close", () => {
  it("uses 16:00 New York, including daylight time", () => {
    expect(new Date(lastRegularClose(Date.parse("2026-11-23T20:00:00Z"))).toISOString()).toBe("2026-11-20T21:00:00.000Z");
    expect(new Date(lastRegularClose(Date.parse("2026-11-23T22:00:00Z"))).toISOString()).toBe("2026-11-23T21:00:00.000Z");
    expect(new Date(lastRegularClose(Date.parse("2026-06-15T18:00:00Z"))).toISOString()).toBe("2026-06-12T20:00:00.000Z");
    expect(new Date(lastRegularClose(Date.parse("2026-06-15T21:00:00Z"))).toISOString()).toBe("2026-06-15T20:00:00.000Z");
  });
});

describe("equity cache freshness", () => {
  it("stays quiet for a cache taken during the session and still under four hours", () => {
    const now = Date.parse("2026-11-23T19:00:00Z");
    const status = equityCacheFreshness(now - 60 * MIN, now, now - 5 * MIN);
    expect(status.stale).toBe(false);
    expect(status.message).toBeNull();
  });

  it("warns once an open-session cache is older than four hours", () => {
    const now = Date.parse("2026-11-23T20:00:00Z");
    const status = equityCacheFreshness(Date.parse("2026-11-23T14:00:00Z"), now, Date.parse("2026-11-23T19:55:00Z"));
    expect(status.stale).toBe(true);
    expect(status.message).toContain("盘中因子可能滞后");
  });

  it("does not warn at exactly four hours", () => {
    const now = Date.parse("2026-11-23T19:00:00Z");
    const status = equityCacheFreshness(now - 4 * 60 * MIN, now, now - 5 * MIN);
    expect(status.stale).toBe(false);
  });

  it("warns after the close when the snapshot missed it", () => {
    const fetchedAt = Date.parse("2026-11-23T20:19:39Z");
    const now = Date.parse("2026-11-24T01:18:00Z");
    const status = equityCacheFreshness(fetchedAt, now, fetchedAt);
    expect(status.stale).toBe(true);
    expect(status.message).toContain("早于最近一次常规收盘");
  });

  it("waits through the post-close grace period", () => {
    const close = Date.parse("2026-11-23T21:00:00Z");
    const fetchedAt = Date.parse("2026-11-23T20:19:39Z");
    expect(equityCacheFreshness(fetchedAt, close + 90 * MIN - 1, fetchedAt).stale).toBe(false);
    expect(equityCacheFreshness(fetchedAt, close + 90 * MIN, fetchedAt).stale).toBe(true);
  });

  it("accepts a cache taken after the close, including over the weekend", () => {
    const afterMonday = Date.parse("2026-11-23T21:30:00Z");
    expect(equityCacheFreshness(afterMonday, Date.parse("2026-11-24T02:00:00Z"), afterMonday).stale).toBe(false);
    const afterFriday = Date.parse("2026-11-27T21:30:00Z");
    expect(equityCacheFreshness(afterFriday, Date.parse("2026-11-28T15:00:00Z"), afterFriday).stale).toBe(false);
  });

  it("warns over the weekend when Friday's close was never captured", () => {
    const status = equityCacheFreshness(Date.parse("2026-11-27T20:00:00Z"), Date.parse("2026-11-28T15:00:00Z"));
    expect(status.stale).toBe(true);
  });

  it("warns in summer time when the snapshot is from before the close", () => {
    const status = equityCacheFreshness(Date.parse("2026-06-15T19:00:00Z"), Date.parse("2026-06-15T21:30:00Z"));
    expect(status.stale).toBe(true);
    expect(status.message).toContain("早于最近一次常规收盘");
  });

  it("warns after the open when intraday bars are still from the previous session", () => {
    const now = Date.parse("2026-11-23T15:15:00Z");
    const status = equityCacheFreshness(Date.parse("2026-11-23T14:40:00Z"), now, Date.parse("2026-11-20T20:55:00Z"));
    expect(status.stale).toBe(true);
    expect(status.message).toContain("上一交易日");
  });

  it("ignores a missing or invalid timestamp", () => {
    expect(equityCacheFreshness(Number.NaN).stale).toBe(false);
    expect(equityCacheFreshness(0).message).toBeNull();
  });
});

describe("yahoo cache status", () => {
  it("uses the oldest Yahoo series and ignores other sources", () => {
    const now = Date.parse("2026-11-24T01:18:00Z");
    const status = yahooCacheStatus(
      [
        { timeframe: "5m", source: "Yahoo Finance", cacheFetchedAt: Date.parse("2026-11-23T20:19:39Z"), latestBar: Date.parse("2026-11-23T20:15:00Z") },
        { timeframe: "1d", source: "Yahoo Finance", cacheFetchedAt: now - 10 * MIN, latestBar: Date.parse("2026-11-23T14:30:00Z") },
        { timeframe: "1d", source: "腾讯行情", cacheFetchedAt: now, latestBar: now },
      ],
      now,
    );
    expect(status?.stale).toBe(true);
    expect(status?.mixed).toBe(true);
    expect(status?.fetchedAt).toBe(Date.parse("2026-11-23T20:19:39Z"));
  });

  it("returns null when the symbol is not served from the Yahoo cache", () => {
    expect(yahooCacheStatus([{ timeframe: "1d", source: "腾讯行情", cacheFetchedAt: 1, latestBar: 1 }])).toBeNull();
  });
});
