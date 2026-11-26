import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { acceptPublishedEquity, mergeEquityFile, normalizeYahooBars, publishedEquityUrl, usableSeries, yahooShouldRetry } from "./equity-cache.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "data", "equities");
const universe = JSON.parse(await readFile(join(root, "src", "data", "universe.json"), "utf8"));
const only = (process.env.ONLY ?? "")
  .split(",")
  .map((item) => item.trim().toUpperCase())
  .filter(Boolean);
const symbols = universe.stocks.map((item) => item.symbol).filter((symbol) => !only.length || only.includes(symbol));

const PLANS = [
  ["5m", "5m", ["60d", "30d", "5d"], 700],
  ["15m", "15m", ["60d", "30d", "5d"], 700],
  ["30m", "30m", ["60d", "30d", "10d"], 700],
  ["1h", "1h", ["730d", "1y", "6mo"], 900],
  ["1d", "1d", ["5y", "2y", "1y"], 1400],
  ["1w", "1wk", ["10y", "5y", "max"], 800],
];

const UA = "Mozilla/5.0 (compatible; cta-factors/1.0; +https://github.com/0xVeryBigOrange/cta-factors)";

function round(value) {
  return Math.round(value * 1e6) / 1e6;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function yahoo(symbol, interval, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false&events=div%7Csplits`;
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        if (yahooShouldRetry(response.status, "", attempt)) {
          lastError = new Error(`${response.status} ${interval} ${range}`);
          await delay(700 * (attempt + 1));
          continue;
        }
        throw new Error(`${response.status} ${interval} ${range}`);
      }
      const payload = await response.json();
      const result = payload.chart?.result?.[0];
      if (!result?.timestamp) throw new Error(payload.chart?.error?.description || `empty ${interval}`);
      const quote = result.indicators.quote[0];
      const raw = [];
      for (let i = 0; i < result.timestamp.length; i++) {
        const open = quote.open?.[i];
        if (open == null) continue;
        raw.push([
          result.timestamp[i] * 1000,
          open,
          quote.high?.[i],
          quote.low?.[i],
          quote.close?.[i],
          quote.volume?.[i] ?? 0,
        ]);
      }
      const rows = normalizeYahooBars(raw, interval, result.meta?.regularMarketPrice).map((row) => [
        row[0],
        round(row[1]),
        round(row[2]),
        round(row[3]),
        round(row[4]),
        row[5],
      ]);
      return {
        rows,
        name: result.meta?.longName || result.meta?.shortName,
        price: result.meta?.regularMarketPrice,
        changePercent: result.meta?.regularMarketChangePercent,
      };
    } catch (error) {
      const name = error?.name || "";
      if (yahooShouldRetry(undefined, name, attempt)) {
        lastError = error instanceof Error ? error : new Error(String(error));
        await delay(700 * (attempt + 1));
        continue;
      }
      if (name === "TimeoutError" || name === "AbortError") throw new Error(`timeout ${interval} ${range}`);
      throw error;
    }
  }
  throw lastError ?? new Error(`no ${interval}`);
}

async function publishedEquity(symbol) {
  const response = await fetch(publishedEquityUrl(symbol), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return null;
  return acceptPublishedEquity(await response.json(), symbol);
}

async function series(symbol, interval, ranges, keep) {
  let lastError = null;
  for (const range of ranges) {
    try {
      const chart = await yahoo(symbol, interval, range);
      if (chart.rows.length) return { ...chart, rows: chart.rows.slice(-keep) };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  throw lastError ?? new Error(`no ${interval}`);
}

async function pool(items, limit, task) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

await mkdir(outDir, { recursive: true });
let ok = 0;
const writtenSymbols = [];
await pool(symbols, 3, async (symbol) => {
  const fetchedAt = Date.now();
  const file = { symbol, source: "yahoo", fetchedAt, series: {}, seriesFetchedAt: {} };
  let meta = null;
  for (const [key, interval, ranges, keep] of PLANS) {
    try {
      const chart = await series(symbol, interval, ranges, keep);
      file.series[key] = chart.rows;
      file.seriesFetchedAt[key] = fetchedAt;
      meta = chart;
      process.stdout.write(`${symbol} ${key} ${chart.rows.length}\n`);
    } catch (error) {
      process.stderr.write(`${symbol} ${key} failed: ${error.message}\n`);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  if (meta) {
    file.name = meta.name;
    file.price = meta.price;
    file.changePercent = meta.changePercent;
  }
  let published = file;
  if (PLANS.some(([key]) => !file.series[key]?.length)) {
    try {
      const previous = await publishedEquity(symbol);
      if (previous) {
        const merged = mergeEquityFile(file, previous);
        published = merged.file;
        if (merged.filled.length) process.stderr.write(`${symbol} filled ${merged.filled.join(",")} from previous publish\n`);
      }
    } catch (error) {
      process.stderr.write(`${symbol} previous cache unavailable: ${error?.message || error}\n`);
    }
  }
  if (!usableSeries(published.series)) {
    process.stderr.write(`${symbol} skipped, no bars\n`);
    return;
  }
  await writeFile(join(outDir, `${symbol}.json`), JSON.stringify(published));
  writtenSymbols.push(symbol);
  ok += 1;
});

await writeFile(
  join(outDir, "index.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      symbols: writtenSymbols.slice().sort(),
      requested: symbols.length,
      written: ok,
    },
    null,
    2,
  ),
);
console.log(`wrote ${ok}/${symbols.length} equity files`);
