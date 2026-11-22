import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

async function yahoo(symbol, interval, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false&events=div%7Csplits`;
  const response = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!response.ok) throw new Error(`${response.status} ${interval} ${range}`);
  const payload = await response.json();
  const result = payload.chart?.result?.[0];
  if (!result?.timestamp) throw new Error(payload.chart?.error?.description || `empty ${interval}`);
  const quote = result.indicators.quote[0];
  const rows = [];
  for (let i = 0; i < result.timestamp.length; i++) {
    const open = quote.open?.[i];
    const high = quote.high?.[i];
    const low = quote.low?.[i];
    const close = quote.close?.[i];
    if (open == null || high == null || low == null || close == null) continue;
    rows.push([result.timestamp[i] * 1000, round(open), round(high), round(low), round(close), quote.volume?.[i] ?? 0]);
  }
  return {
    rows,
    name: result.meta?.longName || result.meta?.shortName,
    price: result.meta?.regularMarketPrice,
    changePercent: result.meta?.regularMarketChangePercent,
  };
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
await pool(symbols, 3, async (symbol) => {
  const file = { symbol, source: "yahoo", fetchedAt: Date.now(), series: {} };
  let meta = null;
  for (const [key, interval, ranges, keep] of PLANS) {
    try {
      const chart = await series(symbol, interval, ranges, keep);
      file.series[key] = chart.rows;
      meta = chart;
      process.stdout.write(`${symbol} ${key} ${chart.rows.length}\n`);
    } catch (error) {
      process.stderr.write(`${symbol} ${key} failed: ${error.message}\n`);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  if (!Object.values(file.series).some((rows) => rows?.length)) {
    process.stderr.write(`${symbol} skipped, no bars\n`);
    return;
  }
  if (meta) {
    file.name = meta.name;
    file.price = meta.price;
    file.changePercent = meta.changePercent;
  }
  await writeFile(join(outDir, `${symbol}.json`), JSON.stringify(file));
  ok += 1;
});

await writeFile(
  join(outDir, "index.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), symbols: symbols.filter(() => true), written: ok }, null, 2),
);
console.log(`wrote ${ok}/${symbols.length} equity files`);
