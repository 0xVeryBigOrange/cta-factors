import { useMemo, useState } from "react";
import type { WatchItem, Timeframe } from "../types";
import { TIMEFRAMES } from "../types";
import type { EngineSnapshot } from "../data/engine";
import { itemKey } from "../data/engine";
import { displayName } from "../data/symbols";
import { evaluateAggregate } from "../factors/evaluate";
import { buildPeers, factorContext } from "../factors/peers";
import { formatProbability, probabilityTone } from "../lib/format";

type Props = {
  items: WatchItem[];
  market: "all" | "crypto" | "stock";
  snapshot: EngineSnapshot;
  onOpen: (item: WatchItem) => void;
};

type Bias = "all" | "long" | "short" | "flat";

export function OverviewView(props: Props) {
  const [biasTf, setBiasTf] = useState<Timeframe>("1d");
  const [bias, setBias] = useState<Bias>("all");
  const [sortKey, setSortKey] = useState<Timeframe | "symbol">("1d");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  const rows = useMemo(() => {
    return props.items
      .filter((item) => props.market === "all" || item.market === props.market)
      .map((item) => {
        const deriv = item.market === "crypto" ? props.snapshot.deriv[`crypto:${item.symbol}`] : undefined;
        const derivatives = deriv?.status === "ready" ? deriv : null;
        const probs = Object.fromEntries(
          TIMEFRAMES.map((tf) => {
            const snap = props.snapshot.series[`${item.market}:${item.symbol}:${tf.id}`];
            if (snap?.status !== "ready") return [tf.id, null];
            const aggregate = evaluateAggregate(
              snap.candles,
              factorContext(item, tf.id, derivatives, buildPeers(props.snapshot, props.items, tf.id, item.market)),
              item.market,
            );
            return [tf.id, aggregate.insufficient ? null : aggregate.probability];
          }),
        ) as Record<Timeframe, number | null>;
        return { item, probs };
      });
  }, [props.items, props.market, props.snapshot]);

  const filtered = rows.filter((row) => {
    const value = row.probs[biasTf];
    if (bias === "all") return true;
    if (value == null) return false;
    if (bias === "long") return value >= 0.65;
    if (bias === "short") return value <= 0.35;
    return value > 0.35 && value < 0.65;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortKey === "symbol") {
      const order = a.item.symbol.localeCompare(b.item.symbol);
      return sortDir === "asc" ? order : -order;
    }
    const av = a.probs[sortKey];
    const bv = b.probs[sortKey];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return sortDir === "asc" ? av - bv : bv - av;
  });

  function toggleSort(key: Timeframe | "symbol") {
    if (sortKey === key) setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "symbol" ? "asc" : "desc");
    }
  }

  return (
    <div className="overview">
      <div className="overview-tools">
        <label>
          筛选周期
          <select value={biasTf} onChange={(event) => setBiasTf(event.target.value as Timeframe)}>
            {TIMEFRAMES.map((tf) => (
              <option key={tf.id} value={tf.id}>
                {tf.label}
              </option>
            ))}
          </select>
        </label>
        <div className="filters">
          {(
            [
              ["all", "全部"],
              ["long", "强多 ≥65%"],
              ["short", "强空 ≤35%"],
              ["flat", "中性"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" className={bias === id ? "on" : ""} onClick={() => setBias(id)}>
              {label}
            </button>
          ))}
        </div>
        <span className="muted">{sorted.length} 个代码</span>
      </div>
      <div className="matrix-scroll">
        <table className="overview-table">
          <thead>
            <tr>
              <th>
                <button type="button" onClick={() => toggleSort("symbol")}>
                  代码 {sortKey === "symbol" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                </button>
              </th>
              {TIMEFRAMES.map((tf) => (
                <th key={tf.id}>
                  <button type="button" onClick={() => toggleSort(tf.id)}>
                    {tf.label} {sortKey === tf.id ? (sortDir === "asc" ? "↑" : "↓") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={itemKey(row.item)}>
                <th>
                  <button type="button" className="linkish" onClick={() => props.onOpen(row.item)}>
                    <b>{row.item.symbol}</b>
                    <small>
                      {row.item.market === "crypto" ? "加密" : "美股"} · {displayName(row.item.market, row.item.symbol)}
                    </small>
                  </button>
                </th>
                {TIMEFRAMES.map((tf) => {
                  const value = row.probs[tf.id];
                  return (
                    <td key={tf.id} style={{ color: probabilityTone(value) }}>
                      {formatProbability(value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!sorted.length && <p className="empty">没有符合筛选的代码。可以换一个周期，或等行情加载完。</p>}
    </div>
  );
}
