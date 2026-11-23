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
  const freshBars = usableSeries(fresh?.series);
  const file = {
    symbol: fresh.symbol,
    source: "yahoo",
    fetchedAt: !freshBars && previous?.fetchedAt ? previous.fetchedAt : fresh.fetchedAt,
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
