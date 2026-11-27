import type { Timeframe } from "../types";

/** While the cash session is open, a cache older than 4 hours is stale. */
export const EQUITY_OPEN_STALE_MS = 4 * 60 * 60 * 1000;
/** After the cash close, wait long enough for an on-time refresh before warning. */
export const EQUITY_CLOSE_GRACE_MS = 90 * 60 * 1000;
const OPEN_MINUTE = 9 * 60 + 30;
const CLOSE_MINUTE = 16 * 60;
const EARLY_CLOSE_MINUTE = 13 * 60;

/**
 * NYSE cash-market full closures, America/New_York dates.
 * Source: https://www.nyse.com/markets/hours-calendars (2026–2028).
 * January 1, 2028 falls on Saturday and is not observed.
 */
const NYSE_CLOSED = new Set([
  "2026-01-01",
  "2026-01-19",
  "2026-02-16",
  "2026-04-03",
  "2026-05-25",
  "2026-06-19",
  "2026-07-03",
  "2026-09-07",
  "2026-11-26",
  "2026-12-25",
  "2027-01-01",
  "2027-01-18",
  "2027-02-15",
  "2027-03-26",
  "2027-05-31",
  "2027-06-18",
  "2027-07-05",
  "2027-09-06",
  "2027-11-25",
  "2027-12-24",
  "2028-01-17",
  "2028-02-21",
  "2028-04-14",
  "2028-05-29",
  "2028-06-19",
  "2028-07-04",
  "2028-09-04",
  "2028-11-23",
  "2028-12-25",
]);

/** Published 13:00 America/New_York equity early closes for 2026–2028. */
const NYSE_EARLY_CLOSE = new Set([
  "2026-11-27",
  "2026-12-24",
  "2027-11-26",
  "2028-07-03",
  "2028-11-24",
]);
const INTRADAY = new Set<Timeframe>(["5m", "15m", "30m", "1h", "4h"]);
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type CacheFreshness = {
  /** Oldest Yahoo series timestamp used for the label and the age check. */
  fetchedAt: number;
  stale: boolean;
  ageMs: number;
  /** Set when the oldest and newest Yahoo series differ, so the label is the early one. */
  mixed: boolean;
  message: string | null;
};

type YahooSnap = {
  timeframe: Timeframe;
  source?: string;
  cacheFetchedAt?: number;
  latestBar?: number;
};

type Civil = { year: number; month: number; day: number; weekday: number; minutes: number };

function nyParts(utcMs: number): Civil {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date(utcMs))) bag[part.type] = part.value;
  const hour = Number(bag.hour) % 24;
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    weekday: WEEKDAYS.indexOf(bag.weekday),
    minutes: hour * 60 + Number(bag.minute),
  };
}

/** Milliseconds to add to UTC to get America/New_York wall time. */
function nyOffset(utcMs: number): number {
  const parts = nyParts(utcMs);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, Math.floor(parts.minutes / 60), parts.minutes % 60);
  return asUtc - utcMs;
}

function nyCivilToUtc(year: number, month: number, day: number, minutes: number): number {
  const guess = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60);
  const first = guess - nyOffset(guess);
  const second = guess - nyOffset(first);
  return second;
}

function previousDate(year: number, month: number, day: number): { year: number; month: number; day: number } {
  const prev = new Date(Date.UTC(year, month - 1, day, 12) - 24 * 60 * 60 * 1000);
  return { year: prev.getUTCFullYear(), month: prev.getUTCMonth() + 1, day: prev.getUTCDate() };
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Cash close in minutes from midnight, or null when the NYSE cash market is shut. */
function cashCloseMinute(year: number, month: number, day: number): number | null {
  const weekday = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  if (weekday === 0 || weekday === 6) return null;
  const key = dateKey(year, month, day);
  if (NYSE_CLOSED.has(key)) return null;
  if (NYSE_EARLY_CLOSE.has(key)) return EARLY_CLOSE_MINUTE;
  return CLOSE_MINUTE;
}

/**
 * Most recent NYSE cash close already in the past, as UTC ms.
 * Regular days use 16:00 America/New_York. Published early closes use 13:00.
 * Full holidays are skipped. Dates after 2028 follow the weekday schedule.
 */
export function lastRegularClose(now: number): number {
  const parts = nyParts(now);
  let date = { year: parts.year, month: parts.month, day: parts.day };
  for (let guard = 0; guard < 14; guard += 1) {
    const closeMinute = cashCloseMinute(date.year, date.month, date.day);
    if (closeMinute != null) {
      const close = nyCivilToUtc(date.year, date.month, date.day, closeMinute);
      if (close <= now) return close;
    }
    date = previousDate(date.year, date.month, date.day);
  }
  return nyCivilToUtc(parts.year, parts.month, parts.day, CLOSE_MINUTE);
}

export function formatCacheAge(ageMs: number): string {
  const minutes = Math.max(1, Math.round(ageMs / 60_000));
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} 小时`;
}

function finite(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Decide whether a published Yahoo equity cache is too old to treat as current.
 * The cash session is 09:30–16:00 America/New_York on weekdays, except published
 * full holidays (no session) and 13:00 early closes. `fetchedAt` should be the
 * oldest series in the file.
 */
export function equityCacheFreshness(
  fetchedAt: number,
  now = Date.now(),
  latestIntradayBar?: number,
): { stale: boolean; ageMs: number; message: string | null } {
  if (!finite(fetchedAt)) return { stale: false, ageMs: Number.NaN, message: null };
  const ageMs = Math.max(0, now - fetchedAt);
  const parts = nyParts(now);
  const closeMinute = cashCloseMinute(parts.year, parts.month, parts.day);
  const sessionOpen = closeMinute != null && parts.minutes >= OPEN_MINUTE && parts.minutes < closeMinute;
  const openUtc = nyCivilToUtc(parts.year, parts.month, parts.day, OPEN_MINUTE);
  const barsBeforeOpen = finite(latestIntradayBar) && latestIntradayBar < openUtc;
  const age = formatCacheAge(ageMs);
  if (sessionOpen && barsBeforeOpen && (parts.minutes - OPEN_MINUTE >= 45 || ageMs > EQUITY_OPEN_STALE_MS)) {
    return {
      stale: true,
      ageMs,
      message: `美股盘中 K 线仍停在上一交易日（缓存已 ${age}），今天的走势还没写进因子。报价可以更新。`,
    };
  }
  if (sessionOpen && ageMs > EQUITY_OPEN_STALE_MS) {
    return {
      stale: true,
      ageMs,
      message: `美股 K 线缓存已 ${age}，盘中因子可能滞后。报价可以更新，因子仍按这份缓存计算。`,
    };
  }
  const close = lastRegularClose(now);
  if (!sessionOpen && now >= close + EQUITY_CLOSE_GRACE_MS && fetchedAt < close) {
    return {
      stale: true,
      ageMs,
      message: `美股 K 线缓存早于最近一次收盘（已 ${age}），收盘段还没写进因子。报价可以更新。`,
    };
  }
  return { stale: false, ageMs, message: null };
}

/** Oldest Yahoo cache time across ready series, plus whether that cache is stale. */
export function yahooCacheStatus(entries: YahooSnap[], now = Date.now()): CacheFreshness | null {
  const yahoo = entries.filter((entry) => entry.source?.includes("Yahoo Finance") && finite(entry.cacheFetchedAt));
  if (!yahoo.length) return null;
  const times = yahoo.map((entry) => entry.cacheFetchedAt as number);
  const fetchedAt = Math.min(...times);
  const newest = Math.max(...times);
  let latestIntradayBar: number | undefined;
  for (const entry of yahoo) {
    if (!INTRADAY.has(entry.timeframe) || !finite(entry.latestBar)) continue;
    latestIntradayBar = latestIntradayBar == null ? entry.latestBar : Math.max(latestIntradayBar, entry.latestBar);
  }
  const freshness = equityCacheFreshness(fetchedAt, now, latestIntradayBar);
  return { ...freshness, fetchedAt, mixed: newest - fetchedAt > 15 * 60 * 1000 };
}
