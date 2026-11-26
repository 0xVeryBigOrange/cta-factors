export const PUBLISHED_EQUITY_BASE = "https://0xverybigorange.github.io/cta-factors/data/equities";

export function publishedEquityUrl(symbol) {
  return `${PUBLISHED_EQUITY_BASE}/${encodeURIComponent(symbol)}.json`;
}

export function usableSeries(series) {
  if (!series || typeof series !== "object") return false;
  return Object.values(series).some((rows) => Array.isArray(rows) && rows.length > 0);
}

export function acceptPublishedEquity(file, symbol) {
  if (!file || typeof file !== "object") return null;
  if (file.symbol !== symbol || file.source !== "yahoo") return null;
  if (!usableSeries(file.series)) return null;
  return file;
}

function finiteStamp(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** When this series was fetched. Explicit per-series stamps win over the file timestamp. */
export function seriesStamp(file, key) {
  return finiteStamp(file?.seriesFetchedAt?.[key]) ?? finiteStamp(file?.fetchedAt);
}

/**
 * Retry a Yahoo chart GET while attempts remain.
 * Timeouts are not retried: the caller already walks a shorter range.
 */
export function yahooShouldRetry(status, errorName, attempt, limit = 3) {
  if (!Number.isInteger(attempt) || attempt < 0 || attempt >= limit - 1) return false;
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return true;
  return errorName === "TypeError";
}

/** Fill missing timeframes from the previous publish. A fresh series always wins. */
export function mergeEquityFile(fresh, previous) {
  const series = { ...(fresh?.series ?? {}) };
  const filled = [];
  const prior = previous && previous.symbol === fresh?.symbol ? previous.series : null;
  if (prior && typeof prior === "object") {
    for (const [key, rows] of Object.entries(prior)) {
      const current = series[key];
      if ((!Array.isArray(current) || current.length === 0) && Array.isArray(rows) && rows.length > 0) {
        series[key] = rows;
        filled.push(key);
      }
    }
  }
  const seriesFetchedAt = {};
  for (const key of Object.keys(series)) {
    const rows = series[key];
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const stamp = filled.includes(key) ? seriesStamp(previous, key) : seriesStamp(fresh, key);
    if (stamp != null) seriesFetchedAt[key] = stamp;
  }
  const freshBars = usableSeries(fresh?.series);
  const file = {
    symbol: fresh.symbol,
    source: "yahoo",
    fetchedAt: !freshBars && previous?.fetchedAt ? previous.fetchedAt : fresh.fetchedAt,
    seriesFetchedAt,
    series,
  };
  const name = fresh.name || previous?.name;
  const price = fresh.price ?? previous?.price;
  const changePercent = fresh.changePercent ?? previous?.changePercent;
  if (name) file.name = name;
  if (price != null) file.price = price;
  if (changePercent != null) file.changePercent = changePercent;
  return { file, filled };
}

const SPLIT_WEEK_MS = 6 * 24 * 60 * 60 * 1000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Monday 00:00 America/New_York, which is where Yahoo stamps a weekly bar. */
function isYahooWeekOpen(utcMs) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hourCycle: "h23",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const bag = {};
  for (const part of fmt.formatToParts(new Date(utcMs))) bag[part.type] = part.value;
  const hour = Number(bag.hour) % 24;
  return WEEKDAYS.indexOf(bag.weekday) === 1 && hour === 0 && Number(bag.minute) === 0;
}

function isFlatPrint(bar) {
  return bar.volume === 0 && bar.close != null && bar.open === bar.high && bar.high === bar.low && bar.low === bar.close;
}

/**
 * Repair a Yahoo chart series before it is stored or drawn.
 * After the cash close Yahoo often nulls the daily close, appends a zero-volume
 * print of the last price, and leaves the current session as its own weekly bar
 * stamped at the quote time instead of folding it into Monday's candle.
 * Rows are chronological `[time, open, high, low, close, volume]`; close may be null.
 */
export function normalizeYahooBars(rows, interval, regularMarketPrice) {
  const points = [];
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const time = finiteNumber(row[0]);
      const open = finiteNumber(row[1]);
      if (time == null || open == null || open <= 0) continue;
      const close = finiteNumber(row[4]);
      const high = finiteNumber(row[2]);
      const low = finiteNumber(row[3]);
      points.push({
        time,
        open,
        high: high ?? Math.max(open, close ?? open),
        low: low ?? Math.min(open, close ?? open),
        close,
        volume: finiteNumber(row[5]) ?? 0,
      });
    }
  }
  if (!points.length) return [];

  let printPrice = null;
  if (isFlatPrint(points[points.length - 1])) {
    printPrice = points.pop().close;
  }
  if (!points.length) return [];

  const fill = finiteNumber(regularMarketPrice) ?? printPrice;
  const last = points[points.length - 1];
  if (last.close == null && fill != null && fill > 0) {
    last.close = fill;
    if (fill > last.high) last.high = fill;
    if (fill < last.low) last.low = fill;
  }

  if ((interval === "1w" || interval === "1wk") && points.length >= 2) {
    const prev = points[points.length - 2];
    const curr = points[points.length - 1];
    const splitWeek = curr.close != null && curr.time > prev.time && curr.time - prev.time < SPLIT_WEEK_MS;
    if (splitWeek && !isYahooWeekOpen(curr.time)) {
      prev.high = Math.max(prev.high, curr.high);
      prev.low = Math.min(prev.low, curr.low);
      prev.close = curr.close;
      prev.volume += curr.volume;
      points.pop();
    }
  }

  const out = [];
  for (const bar of points) {
    if (bar.close == null || bar.close <= 0) continue;
    out.push([bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume]);
  }
  return out;
}
