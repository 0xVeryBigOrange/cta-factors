import type { Derivatives } from "../factors/catalog";
import type { Candle, Timeframe, WatchItem } from "../types";
import { TIMEFRAMES, timeframeMs } from "../types";
import { BINANCE_INTERVAL, fetchCryptoCandles, fetchCryptoQuote } from "./crypto";
import { fetchDerivatives } from "./derivatives";
import { fetchYahooCandles, loadEquityFile, rowsToCandles, clearEquityFileCache, type EquityFile, type EquitySeriesKey } from "./equities";
import { isAbort } from "./http";
import { resample } from "./resample";
import { displayName, tencentPreset } from "./symbols";
import { fetchTencentKlines, fetchTencentQuotes, resolveTencentCode } from "./tencent";

const TTL: Record<Timeframe, number> = {
  "5m": 20_000,
  "15m": 30_000,
  "30m": 45_000,
  "1h": 60_000,
  "4h": 120_000,
  "1d": 5 * 60_000,
  "1w": 15 * 60_000,
};

export type SeriesSnap = {
  status: "loading" | "ready" | "error" | "empty";
  candles: Candle[];
  source?: string;
  updatedAt?: number;
  asOf?: number;
  /** When the upstream candle cache was fetched. Independent of updatedAt, which is the last local apply. */
  cacheFetchedAt?: number;
  error?: string;
  final?: boolean;
};

export type DerivSnap = {
  status: "loading" | "ready" | "error" | "idle";
  funding: Derivatives["funding"];
  oi: Derivatives["oi"];
  lsr: Derivatives["lsr"];
  basis: number | null;
  source?: string;
  updatedAt?: number;
  error?: string;
};

export type QuoteSnap = {
  price?: number;
  changePercent?: number;
  name?: string;
  source?: string;
  updatedAt?: number;
};

export type EngineSnapshot = {
  version: number;
  series: Record<string, SeriesSnap>;
  deriv: Record<string, DerivSnap>;
  quotes: Record<string, QuoteSnap>;
  live: "ws" | "poll" | "off";
  loaded: number;
  total: number;
};

type Job = { id: string; priority: number; run: () => Promise<void> };

export function itemKey(item: WatchItem): string {
  return `${item.market}:${item.symbol}`;
}

export function seriesKey(item: WatchItem, tf: Timeframe): string {
  return `${item.market}:${item.symbol}:${tf}`;
}

function emptyDeriv(status: DerivSnap["status"] = "idle"): DerivSnap {
  return { status, funding: [], oi: [], lsr: [], basis: null };
}

const EMPTY_SNAPSHOT: EngineSnapshot = {
  version: 0,
  series: {},
  deriv: {},
  quotes: {},
  live: "off",
  loaded: 0,
  total: 0,
};

class Engine {
  private items: WatchItem[] = [];
  private active: WatchItem | null = null;
  private series: Record<string, SeriesSnap> = {};
  private deriv: Record<string, DerivSnap> = {};
  private quotes: Record<string, QuoteSnap> = {};
  private live: EngineSnapshot["live"] = "off";
  private snapshot: EngineSnapshot = EMPTY_SNAPSHOT;
  private listeners = new Set<() => void>();
  private jobs: Job[] = [];
  private inflight = new Set<string>();
  private running = 0;
  private controllers = new Map<string, AbortController>();
  private stockLoadedAt = new Map<string, number>();
  private quoteAt = 0;
  private socket: WebSocket | null = null;
  private socketSymbol = "";
  private wsAttempts = 0;
  private commitTimer = 0;

  constructor() {
    if (typeof window === "undefined") return;
    window.setInterval(() => this.refreshStale(), 12_000);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): EngineSnapshot => this.snapshot;

  setScope(items: WatchItem[], active: WatchItem | null): void {
    this.items = items;
    const activeChanged = !this.active || !active || itemKey(this.active) !== itemKey(active);
    this.active = active;
    if (activeChanged) this.wsAttempts = 0;
    const wanted = new Set(items.map(itemKey));
    for (const [key, controller] of this.controllers) {
      if (!wanted.has(key)) {
        controller.abort();
        this.controllers.delete(key);
      }
    }
    for (const item of items) {
      const priorityBase = this.isActive(item) ? 0 : 2;
      if (item.market === "stock") {
        this.enqueue(`stock:${item.symbol}`, priorityBase, () => this.ensureStock(item.symbol));
      } else {
        this.enqueue(`deriv:${item.symbol}`, priorityBase, () => this.ensureDeriv(item.symbol));
        for (const tf of TIMEFRAMES) {
          const coarse = tf.id === "1d" || tf.id === "4h" || tf.id === "1h";
          const priority = this.isActive(item) ? 0 : coarse ? 1 : 4;
          this.enqueue(`crypto:${item.symbol}:${tf.id}`, priority, () => this.ensureCrypto(item.symbol, tf.id));
        }
      }
    }
    this.syncSocket();
    this.pump();
    this.commit();
  }

  refreshNow(): void {
    clearEquityFileCache();
    this.stockLoadedAt.clear();
    this.quoteAt = 0;
    const series = { ...this.series };
    for (const key of Object.keys(series)) {
      if (series[key].status === "ready") series[key] = { ...series[key], updatedAt: 0 };
      if (series[key].final) series[key] = { ...series[key], final: false, updatedAt: 0 };
    }
    this.series = series;
    const deriv = { ...this.deriv };
    for (const key of Object.keys(deriv)) deriv[key] = { ...deriv[key], updatedAt: 0 };
    this.deriv = deriv;
    this.setScope(this.items, this.active);
  }

  private refreshStale(): void {
    if (typeof document !== "undefined" && document.hidden) return;
    this.setScope(this.items, this.active);
    void this.refreshStockQuotes();
  }

  private enqueue(id: string, priority: number, run: () => Promise<void>): void {
    const existing = this.jobs.find((job) => job.id === id);
    if (existing) {
      existing.priority = Math.min(existing.priority, priority);
      this.jobs.sort((a, b) => a.priority - b.priority);
      return;
    }
    if (this.inflight.has(id)) return;
    this.jobs.push({ id, priority, run });
    this.jobs.sort((a, b) => a.priority - b.priority);
  }

  private pump(): void {
    while (this.running < 3 && this.jobs.length) {
      const job = this.jobs.shift();
      if (!job) return;
      this.running += 1;
      this.inflight.add(job.id);
      job
        .run()
        .catch(() => undefined)
        .finally(() => {
          this.inflight.delete(job.id);
          this.running -= 1;
          this.pump();
        });
    }
  }

  private signalFor(key: string): AbortSignal {
    let controller = this.controllers.get(key);
    if (!controller) {
      controller = new AbortController();
      this.controllers.set(key, controller);
    }
    return controller.signal;
  }

  private isActive(item: WatchItem): boolean {
    return !!this.active && itemKey(this.active) === itemKey(item);
  }

  private hasItem(item: WatchItem): boolean {
    return this.items.some((candidate) => itemKey(candidate) === itemKey(item));
  }

  private isFresh(snap: SeriesSnap | undefined, tf: Timeframe, active: boolean): boolean {
    if (!snap) return false;
    if (snap.status === "empty" && snap.final) return true;
    if (snap.status !== "ready") return false;
    return Date.now() - (snap.updatedAt ?? 0) < TTL[tf] * (active ? 1 : 4);
  }

  private async ensureCrypto(symbol: string, tf: Timeframe): Promise<void> {
    const item: WatchItem = { market: "crypto", symbol };
    const key = seriesKey(item, tf);
    const signal = this.signalFor(itemKey(item));
    const current = this.series[key];
    if (this.isFresh(current, tf, this.isActive(item))) return;
    if (!current || current.status !== "ready") {
      this.series = { ...this.series, [key]: { status: "loading", candles: current?.candles ?? [] } };
      this.commit();
    }
    try {
      const bundle = await fetchCryptoCandles(symbol, tf, signal);
      if (signal.aborted || !this.hasItem(item)) return;
      this.series = {
        ...this.series,
        [key]: {
          status: "ready",
          candles: bundle.candles,
          source: bundle.source,
          updatedAt: Date.now(),
          asOf: bundle.candles.at(-1)?.time,
        },
      };
      this.commit();
    } catch (error) {
      if (isAbort(error) || !this.hasItem(item)) return;
      if (current?.status === "ready" && current.candles.length > 0) return;
      this.series = {
        ...this.series,
        [key]: {
          status: "error",
          candles: current?.candles ?? [],
          error: error instanceof Error ? error.message : "加载失败",
          updatedAt: Date.now(),
        },
      };
      this.commit();
    }
  }

  private async ensureDeriv(symbol: string): Promise<void> {
    const key = `crypto:${symbol}`;
    const signal = this.signalFor(key);
    const current = this.deriv[key];
    if (current?.status === "ready" && Date.now() - (current.updatedAt ?? 0) < 60_000) return;
    if (current?.status !== "ready") {
      this.deriv = { ...this.deriv, [key]: { ...(current ?? emptyDeriv()), status: "loading" } };
      this.commit();
    }
    try {
      const [result, quote] = await Promise.all([fetchDerivatives(symbol, signal), fetchCryptoQuote(symbol, signal)]);
      if (signal.aborted) return;
      this.deriv = {
        ...this.deriv,
        [key]: { status: "ready", ...result.data, source: result.source, updatedAt: Date.now() },
      };
      if (quote) {
        this.quotes = {
          ...this.quotes,
          [key]: {
            price: quote.price,
            changePercent: quote.changePercent,
            source: "Binance",
            updatedAt: Date.now(),
            name: displayName("crypto", symbol),
          },
        };
      }
      this.commit();
    } catch (error) {
      if (isAbort(error)) return;
      if (current?.status === "ready") return;
      this.deriv = {
        ...this.deriv,
        [key]: { ...emptyDeriv("error"), error: "衍生品数据不可用（资金费率、持仓量等）", updatedAt: Date.now() },
      };
      this.commit();
    }
  }

  private async ensureStock(symbol: string): Promise<void> {
    const item: WatchItem = { market: "stock", symbol };
    const signal = this.signalFor(itemKey(item));
    const loadedAt = this.stockLoadedAt.get(symbol) ?? 0;
    if (Date.now() - loadedAt < 10 * 60_000 && this.series[seriesKey(item, "1d")]?.status === "ready") return;
    const needsPlaceholder = TIMEFRAMES.some((tf) => !this.series[seriesKey(item, tf.id)]);
    if (needsPlaceholder) {
      const next = { ...this.series };
      for (const tf of TIMEFRAMES) {
        const key = seriesKey(item, tf.id);
        if (!next[key]) next[key] = { status: "loading", candles: [] };
      }
      this.series = next;
      this.commit();
    }
    try {
      const file = await loadEquityFile(symbol);
      if (signal.aborted || !this.hasItem(item)) return;
      if (file && hasBars(file)) {
        this.applyFile(item, file);
      } else if (import.meta.env.DEV) {
        let yahoo = false;
        try {
          yahoo = await this.loadDevYahoo(item, signal);
        } catch (error) {
          if (isAbort(error) || !this.hasItem(item)) return;
        }
        if (signal.aborted || !this.hasItem(item)) return;
        if (!yahoo) await this.applyTencent(item, signal);
      } else {
        await this.applyTencent(item, signal);
      }
      this.stockLoadedAt.set(symbol, Date.now());
    } catch (error) {
      if (isAbort(error) || !this.hasItem(item)) return;
      const next = { ...this.series };
      for (const tf of TIMEFRAMES) {
        const key = seriesKey(item, tf.id);
        if (!next[key] || next[key].status === "loading") {
          next[key] = { status: "error", candles: [], error: "美股行情加载失败", updatedAt: Date.now() };
        }
      }
      this.series = next;
      this.commit();
    }
  }

  private applyFile(item: WatchItem, file: EquityFile): void {
    const updatedAt = Date.now();
    const next = { ...this.series };
    for (const tf of ["5m", "15m", "30m", "1h", "1d", "1w"] as const) {
      const candles = rowsToCandles(file.series[tf], tf, file.price);
      next[seriesKey(item, tf)] = candles.length
        ? { status: "ready", candles, source: "Yahoo Finance", updatedAt, asOf: candles.at(-1)?.time, cacheFetchedAt: cacheStamp(file, tf) }
        : { status: "empty", candles: [], source: "Yahoo Finance", updatedAt, final: true, error: "该周期没有数据" };
    }
    const hourly = rowsToCandles(file.series["1h"], "1h", file.price);
    const fourHour = hourly.length ? resample(hourly, timeframeMs("4h")) : [];
    next[seriesKey(item, "4h")] = fourHour.length
      ? {
          status: "ready",
          candles: fourHour,
          source: "Yahoo Finance · 1小时聚合",
          updatedAt,
          asOf: fourHour.at(-1)?.time,
          cacheFetchedAt: cacheStamp(file, "1h"),
        }
      : { status: "empty", candles: [], final: true, error: "缺少 1 小时 K 线，无法聚合 4 小时", updatedAt };
    this.series = next;
    if (file.price) {
      this.quotes = {
        ...this.quotes,
        [itemKey(item)]: {
          price: file.price,
          changePercent: file.changePercent,
          name: file.name || displayName("stock", item.symbol),
          source: "Yahoo Finance",
          updatedAt: file.fetchedAt,
        },
      };
    }
    this.commit();
  }

  private async loadDevYahoo(item: WatchItem, signal: AbortSignal): Promise<boolean> {
    const keys = ["5m", "15m", "30m", "1h", "1d", "1w"] as const;
    const bundles = await Promise.all(keys.map(async (tf) => ({ tf, candles: await fetchYahooCandles(item.symbol, tf, signal) })));
    if (signal.aborted) return false;
    if (!bundles.some((bundle) => bundle.candles.length)) return false;
    const updatedAt = Date.now();
    const next = { ...this.series };
    for (const bundle of bundles) {
      next[seriesKey(item, bundle.tf)] = bundle.candles.length
        ? {
            status: "ready",
            candles: bundle.candles,
            source: "Yahoo Finance",
            updatedAt,
            asOf: bundle.candles.at(-1)?.time,
            cacheFetchedAt: updatedAt,
          }
        : { status: "empty", candles: [], final: true, error: "该周期没有数据", updatedAt };
    }
    const hourly = bundles.find((bundle) => bundle.tf === "1h")?.candles ?? [];
    const fourHour = hourly.length ? resample(hourly, timeframeMs("4h")) : [];
    next[seriesKey(item, "4h")] = fourHour.length
      ? { status: "ready", candles: fourHour, source: "Yahoo Finance · 1小时聚合", updatedAt, asOf: fourHour.at(-1)?.time, cacheFetchedAt: updatedAt }
      : { status: "empty", candles: [], final: true, error: "缺少 1 小时 K 线", updatedAt };
    this.series = next;
    const daily = bundles.find((bundle) => bundle.tf === "1d")?.candles;
    const last = daily?.at(-1);
    const prev = daily && daily.length > 1 ? daily[daily.length - 2] : undefined;
    if (last) {
      this.quotes = {
        ...this.quotes,
        [itemKey(item)]: {
          price: last.close,
          changePercent: prev ? ((last.close - prev.close) / prev.close) * 100 : undefined,
          name: displayName("stock", item.symbol),
          source: "Yahoo Finance",
          updatedAt,
        },
      };
    }
    this.commit();
    return true;
  }

  private async applyTencent(item: WatchItem, signal: AbortSignal): Promise<void> {
    const code = await resolveTencentCode(item.symbol, tencentPreset(item.symbol), signal);
    if (signal.aborted) return;
    const updatedAt = Date.now();
    if (!code) {
      const next = { ...this.series };
      for (const tf of TIMEFRAMES) {
        next[seriesKey(item, tf.id)] = {
          status: "error",
          candles: [],
          error: "找不到该美股代码",
          updatedAt,
        };
      }
      this.series = next;
      this.commit();
      return;
    }
    const [daily, weekly] = await Promise.all([
      fetchTencentKlines(code, "day", 800, signal),
      fetchTencentKlines(code, "week", 400, signal),
    ]);
    const note = "这个代码还没有盘中缓存。5分到 4时由 GitHub Actions 从 Yahoo Finance 预取进默认股票池；当前仅有日线与周线（腾讯行情，可能延迟）。";
    const next = { ...this.series };
    for (const tf of ["5m", "15m", "30m", "1h", "4h"] as const) {
      next[seriesKey(item, tf)] = { status: "empty", candles: [], final: true, error: note, source: "腾讯行情", updatedAt };
    }
    next[seriesKey(item, "1d")] = daily.length
      ? { status: "ready", candles: daily, source: "腾讯行情", updatedAt, asOf: daily.at(-1)?.time }
      : { status: "empty", candles: [], final: true, error: "日线为空", updatedAt };
    next[seriesKey(item, "1w")] = weekly.length
      ? { status: "ready", candles: weekly, source: "腾讯行情", updatedAt, asOf: weekly.at(-1)?.time }
      : { status: "empty", candles: [], final: true, error: "周线为空", updatedAt };
    this.series = next;
    const last = daily.at(-1);
    const prev = daily.length > 1 ? daily[daily.length - 2] : undefined;
    this.quotes = {
      ...this.quotes,
      [itemKey(item)]: {
        price: last?.close,
        changePercent: last && prev ? ((last.close - prev.close) / prev.close) * 100 : undefined,
        name: displayName("stock", item.symbol),
        source: "腾讯行情",
        updatedAt,
      },
    };
    this.commit();
  }

  private async refreshStockQuotes(): Promise<void> {
    if (Date.now() - this.quoteAt < 60_000) return;
    const stocks = this.items.filter((item) => item.market === "stock");
    const codes: string[] = [];
    const owners = new Map<string, string>();
    for (const stock of stocks) {
      const preset = tencentPreset(stock.symbol);
      if (!preset) continue;
      codes.push(preset);
      owners.set(preset.toUpperCase(), stock.symbol);
      owners.set(preset.replace(/^us/i, "").toUpperCase(), stock.symbol);
    }
    if (!codes.length) return;
    this.quoteAt = Date.now();
    try {
      const quotes = await fetchTencentQuotes(codes);
      const next = { ...this.quotes };
      for (const quote of quotes) {
        const symbol = owners.get(quote.code.toUpperCase());
        if (!symbol || quote.price == null) continue;
        const key = `stock:${symbol}`;
        next[key] = {
          ...next[key],
          price: quote.price,
          changePercent: quote.changePercent ?? next[key]?.changePercent,
          name: next[key]?.name || quote.name || displayName("stock", symbol),
          source: next[key]?.source ?? "腾讯行情",
          updatedAt: Date.now(),
        };
      }
      this.quotes = next;
      this.commit();
    } catch {
      this.quoteAt = Date.now() - 45_000;
    }
  }

  private syncSocket(): void {
    if (typeof WebSocket === "undefined") return;
    const active = this.active;
    if (!active || active.market !== "crypto") {
      this.closeSocket();
      if (this.live !== "poll") {
        this.live = this.items.length ? "poll" : "off";
        this.commit();
      }
      return;
    }
    const symbol = active.symbol.toLowerCase();
    if (this.socketSymbol === symbol && this.socket && this.socket.readyState <= WebSocket.OPEN) return;
    this.closeSocket();
    this.socketSymbol = symbol;
    const streams = TIMEFRAMES.map((tf) => `${symbol}usdt@kline_${BINANCE_INTERVAL[tf.id]}`).join("/");
    let ws: WebSocket;
    try {
      ws = new WebSocket(`wss://data-stream.binance.vision/stream?streams=${streams}`);
    } catch {
      this.live = "poll";
      return;
    }
    this.socket = ws;
    ws.onopen = () => {
      this.wsAttempts = 0;
      this.live = "ws";
      this.commit();
    };
    ws.onmessage = (event) => this.onKline(active, event.data);
    ws.onerror = () => {
      this.live = "poll";
    };
    ws.onclose = () => {
      if (this.socket !== ws) return;
      this.socket = null;
      this.live = "poll";
      this.commit();
      if (this.active && itemKey(this.active) === itemKey(active) && this.wsAttempts < 4) {
        this.wsAttempts += 1;
        window.setTimeout(() => this.syncSocket(), 4000);
      }
    };
  }

  private onKline(item: WatchItem, raw: unknown): void {
    let payload: { data?: { k?: Record<string, unknown> }; k?: Record<string, unknown> };
    try {
      payload = JSON.parse(String(raw)) as { data?: { k?: Record<string, unknown> }; k?: Record<string, unknown> };
    } catch {
      return;
    }
    const kline = payload.data?.k ?? payload.k;
    if (!kline) return;
    const tf = String(kline.i ?? "") as Timeframe;
    if (!TIMEFRAMES.some((itemTf) => itemTf.id === tf)) return;
    const key = seriesKey(item, tf);
    const current = this.series[key];
    if (!current || current.status !== "ready" || !current.candles.length) return;
    if (current.source && !current.source.includes("Binance")) return;
    const candle: Candle = {
      time: Number(kline.t),
      open: Number(kline.o),
      high: Number(kline.h),
      low: Number(kline.l),
      close: Number(kline.c),
      volume: Number(kline.v),
    };
    if (![candle.time, candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)) return;
    const candles = current.candles.slice();
    const last = candles[candles.length - 1];
    if (candle.time === last.time) candles[candles.length - 1] = candle;
    else if (candle.time > last.time) candles.push(candle);
    else return;
    this.series = {
      ...this.series,
      [key]: { ...current, candles, updatedAt: Date.now(), asOf: candle.time },
    };
    const quoteKey = itemKey(item);
    this.quotes = {
      ...this.quotes,
      [quoteKey]: { ...this.quotes[quoteKey], price: candle.close, updatedAt: Date.now(), source: this.quotes[quoteKey]?.source ?? "Binance" },
    };
    this.commitSoon();
  }

  private closeSocket(): void {
    if (!this.socket) return;
    const socket = this.socket;
    this.socket = null;
    this.socketSymbol = "";
    socket.onclose = null;
    socket.close();
  }

  private commitSoon(): void {
    if (this.commitTimer) return;
    this.commitTimer = window.setTimeout(() => {
      this.commitTimer = 0;
      this.commit();
    }, 700);
  }

  private commit(): void {
    let loaded = 0;
    let total = 0;
    for (const item of this.items) {
      for (const tf of TIMEFRAMES) {
        total += 1;
        const snap = this.series[seriesKey(item, tf.id)];
        if (snap && snap.status !== "loading") loaded += 1;
      }
    }
    this.snapshot = {
      version: this.snapshot.version + 1,
      series: this.series,
      deriv: this.deriv,
      quotes: this.quotes,
      live: this.live,
      loaded,
      total,
    };
    for (const listener of this.listeners) listener();
  }
}

function hasBars(file: EquityFile): boolean {
  return Object.values(file.series).some((rows) => Array.isArray(rows) && rows.length > 0);
}

function cacheStamp(file: EquityFile, key: EquitySeriesKey): number {
  const specific = file.seriesFetchedAt?.[key];
  if (typeof specific === "number" && Number.isFinite(specific) && specific > 0) return specific;
  return file.fetchedAt;
}

export const engine = new Engine();
