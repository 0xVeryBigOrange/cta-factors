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
