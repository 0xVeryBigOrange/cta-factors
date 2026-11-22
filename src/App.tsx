import { useEffect, useMemo, useState } from "react";
import { useSyncExternalStore } from "react";
import { engine, itemKey, seriesKey } from "./data/engine";
import { displayName } from "./data/symbols";
import { useWatchlist } from "./hooks/useWatchlist";
import { Sidebar } from "./components/Sidebar";
import { MatrixView } from "./components/MatrixView";
import { CombinedView } from "./components/CombinedView";
import { OverviewView } from "./components/OverviewView";
import { FactorModal } from "./components/FactorModal";
import type { Factor } from "./factors/catalog";
import { evaluate } from "./factors/evaluate";
import type { Market, Timeframe } from "./types";
import { TIMEFRAMES } from "./types";
import { formatPercent, formatPrice, formatTime } from "./lib/format";

type Tab = "matrix" | "combined" | "overview";

function describeSources(sources: string[]): string {
  const labels: string[] = [];
  const add = (label: string) => {
    if (!labels.includes(label)) labels.push(label);
  };
  for (const source of sources) {
    if (source.includes("Yahoo")) add("Yahoo Finance");
    else if (source.includes("腾讯")) add("腾讯行情");
    else add(source.split(" · ")[0]);
    if (source.includes("聚合")) add("4小时由1小时聚合");
  }
  return labels.join(" · ");
}

export function App() {
  const watch = useWatchlist();
  const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
  const [market, setMarket] = useState<"all" | Market>("all");
  const [tab, setTab] = useState<Tab>("matrix");
  const [factor, setFactor] = useState<Factor | null>(null);

  useEffect(() => {
    engine.setScope(watch.items, watch.active);
  }, [watch.listKey, watch.active]);

  const active = watch.active;
  const series = useMemo(() => {
    const map = {} as Record<Timeframe, (typeof snapshot.series)[string] | undefined>;
    if (!active) return map;
    for (const tf of TIMEFRAMES) map[tf.id] = snapshot.series[seriesKey(active, tf.id)];
    return map;
  }, [active, snapshot]);

  const derivSnap = active?.market === "crypto" ? snapshot.deriv[`crypto:${active.symbol}`] : undefined;
  const derivatives = derivSnap?.status === "ready" ? derivSnap : null;
  const quote = active ? snapshot.quotes[itemKey(active)] : undefined;
  const daily = active ? series["1d"] : undefined;
  const price = quote?.price ?? daily?.candles.at(-1)?.close;
  const change = quote?.changePercent;
  const sources = describeSources(TIMEFRAMES.map((tf) => series[tf.id]?.source).filter((source): source is string => !!source));
  const updated = Math.max(0, ...TIMEFRAMES.map((tf) => series[tf.id]?.updatedAt ?? 0), quote?.updatedAt ?? 0);
  const asOf = Math.max(0, ...TIMEFRAMES.map((tf) => series[tf.id]?.candles.at(-1)?.time ?? 0));

  const readings = useMemo(() => {
    if (!active || !factor) return {};
    const out: Partial<Record<Timeframe, ReturnType<typeof evaluate>[number]["reading"]>> = {};
    for (const tf of TIMEFRAMES) {
      const snap = series[tf.id];
      if (snap?.status !== "ready") continue;
      const cells = evaluate(snap.candles, { timeframe: tf.id, derivatives }, active.market);
      out[tf.id] = cells.find((cell) => cell.factor.id === factor.id)?.reading ?? null;
    }
    return out;
  }, [active, factor, series, derivatives]);

  const liveLabel = snapshot.live === "ws" ? "实时推送" : snapshot.live === "poll" ? "轮询" : "等待";

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="mark">CTA</span>
          <div>
            <h1>多因子多空看板</h1>
            <p>加密货币与美股 · 多周期趋势跟踪信号</p>
          </div>
        </div>
        <p className="disclaimer">仅供信息展示与学习，不构成投资建议或交易依据。</p>
      </header>
      <div className="layout">
        <Sidebar
          items={watch.items}
          active={active}
          market={market}
          snapshot={snapshot}
          onMarket={setMarket}
          onSelect={(item) => {
            watch.setActive(item);
            setTab("matrix");
          }}
          onAdd={watch.add}
          onRemove={watch.remove}
          onReset={watch.reset}
        />
        <main>
          {active ? (
            <>
              <section className="symbol-head">
                <div>
                  <p className="eyebrow">{active.market === "crypto" ? "加密" : "美股"}</p>
                  <h2>
                    {active.symbol}
                    <span>{quote?.name || displayName(active.market, active.symbol)}</span>
                  </h2>
                </div>
                <div className="px">
                  <strong>{formatPrice(price)}</strong>
                  <em className={change != null && change < 0 ? "down" : "up"}>{formatPercent(change)}</em>
                </div>
                <div className="meta">
                  <span className={snapshot.live === "ws" ? "pill live" : "pill"}>{liveLabel}</span>
                  <span>刷新于 {formatTime(updated || undefined)}</span>
                  <span>最新 K 线 {formatTime(asOf || undefined)}</span>
                  <span>{sources || "正在连接数据源"}</span>
                  {derivSnap?.source && active.market === "crypto" && <span>衍生品 {derivSnap.source}</span>}
                  {derivSnap?.status === "error" && <span>衍生品暂不可用</span>}
                </div>
                <button type="button" className="ghost" onClick={() => engine.refreshNow()}>
                  立即刷新
                </button>
              </section>
              <div className="tabs">
                {(
                  [
                    ["matrix", "因子矩阵"],
                    ["combined", "综合概率"],
                    ["overview", "自选总览"],
                  ] as const
                ).map(([id, label]) => (
                  <button key={id} type="button" className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
                    {label}
                  </button>
                ))}
                <span className="progress">
                  已加载 {snapshot.loaded}/{snapshot.total || watch.items.length * TIMEFRAMES.length}
                </span>
              </div>
              {tab === "matrix" && (
                <MatrixView
                  market={active.market}
                  series={series}
                  derivatives={derivatives}
                  derivStatus={derivSnap?.status}
                  onOpen={setFactor}
                />
              )}
              {tab === "combined" && <CombinedView market={active.market} series={series} derivatives={derivatives} />}
              {tab === "overview" && (
                <OverviewView
                  items={watch.items}
                  market={market}
                  snapshot={snapshot}
                  onOpen={(item) => {
                    watch.setActive(item);
                    setTab("matrix");
                  }}
                />
              )}
              {tab === "matrix" && <p className="legend">绿色为多，红色为空，灰色为中性。颜色越深，强度越接近 ±1。点因子名称可看定义和规则。</p>}
            </>
          ) : (
            <p className="empty">自选是空的。在左侧搜索代码并添加。</p>
          )}
        </main>
      </div>
      <footer>
        <p>
          加密 K 线优先使用 Binance 公共行情（data-api.binance.vision，支持浏览器跨域），失败时依次尝试 OKX、Gate.io、Bitget、Kraken、Coinbase、CoinGecko。
          实时推送使用 Binance 公共 WebSocket。衍生品（资金费率、持仓量、多空比、基差）来自 Gate.io，失败时用 Bitget。
          美股默认股票池在构建时由 GitHub Actions 从 Yahoo Finance 图表接口拉取并写入静态 JSON；浏览器里用腾讯行情补充报价，以及没有缓存的代码的日线 / 周线。
        </p>
        <p>仅供信息展示与学习研究，不构成任何投资建议。市场有风险，盈亏自负。</p>
      </footer>
      {factor && <FactorModal factor={factor} readings={readings} onClose={() => setFactor(null)} />}
    </div>
  );
}
