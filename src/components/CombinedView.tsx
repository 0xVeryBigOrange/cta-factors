import { useMemo, useState } from "react";
import { CATEGORY_META, type Derivatives } from "../factors/catalog";
import { evaluate } from "../factors/evaluate";
import { aggregate } from "../factors/aggregate";
import { factorHistory, icWeight, type FactorStat } from "../factors/history";
import type { PeerReturn } from "../factors/catalog";
import type { SeriesSnap } from "../data/engine";
import type { Market, Timeframe, WatchItem } from "../types";
import { TIMEFRAMES } from "../types";
import { formatProbability, formatScore, probabilityTone } from "../lib/format";

type Props = {
  item: WatchItem;
  market: Market;
  series: Record<Timeframe, SeriesSnap | undefined>;
  derivatives: Derivatives | null;
  peers: Partial<Record<Timeframe, PeerReturn[]>>;
};

function formatHit(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

function formatIc(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
}

export function CombinedView(props: Props) {
  const [focus, setFocus] = useState<Timeframe>("1d");
  const [weightByHistory, setWeightByHistory] = useState(() => {
    try {
      return localStorage.getItem("cta-factors-ic-weight-v1") !== "0";
    } catch {
      return true;
    }
  });

  function toggleWeight() {
    setWeightByHistory((current) => {
      const next = !current;
      try {
        localStorage.setItem("cta-factors-ic-weight-v1", next ? "1" : "0");
      } catch {
        /* ignore private-mode storage failures */
      }
      return next;
    });
  }

  const cards = useMemo(() => {
    return TIMEFRAMES.map((tf) => {
      const snap = props.series[tf.id];
      if (snap?.status !== "ready") {
        return { tf, aggregate: null, rows: [] as { name: string; stat: FactorStat; weight: number }[], status: snap?.status ?? "loading", error: snap?.error };
      }
      const ctx = {
        timeframe: tf.id,
        symbol: props.item.symbol,
        derivatives: props.derivatives,
        peers: props.peers[tf.id],
      };
      const cells = evaluate(snap.candles, ctx, props.market);
      const rows = cells.map((cell) => {
        const stat = factorHistory(snap.candles, cell.factor, ctx);
        return { name: cell.factor.name, stat, weight: icWeight(stat), reading: cell.reading, category: cell.factor.category };
      });
      const result = aggregate(
        rows.map((row) => ({
          category: row.category,
          reading: row.reading,
          weight: weightByHistory ? row.weight : 1,
        })),
      );
      return { tf, status: "ready" as const, error: undefined, aggregate: result, rows };
    });
  }, [props.series, props.derivatives, props.peers, props.market, props.item.symbol, weightByHistory]);

  const focused = cards.find((card) => card.tf.id === focus) ?? cards[0];
  const ranked = [...(focused?.rows ?? [])].sort((a, b) => (b.stat.ic ?? -2) - (a.stat.ic ?? -2));

  return (
    <div className="combined">
      <div className="prob-grid">
        {cards.map((card) => {
          const probability = card.aggregate && !card.aggregate.insufficient ? card.aggregate.probability : null;
          return (
            <button
              key={card.tf.id}
              type="button"
              className={card.tf.id === focus ? "prob-card on" : "prob-card"}
              onClick={() => setFocus(card.tf.id)}
            >
              <span>{card.tf.label}</span>
              <strong style={{ color: probabilityTone(probability) }}>
                {card.status === "loading" ? "…" : card.status === "ready" ? formatProbability(probability) : "不可用"}
              </strong>
              <small>{probability == null ? (card.error ? "无数据" : "计算中") : probability >= 0.5 ? "偏多" : "偏空"}</small>
              <i style={{ width: `${probability == null ? 0 : probability * 100}%`, background: probabilityTone(probability) }} />
            </button>
          );
        })}
      </div>
      <label className="weight-toggle">
        <input type="checkbox" checked={weightByHistory} onChange={toggleWeight} />
        用历史 IC 加权（只影响这个代码的综合概率）
      </label>
      {focused?.aggregate && !focused.aggregate.insufficient && (
        <div className="breakdown">
          <h3>
            {focused.tf.label} 综合分 <b>{formatScore(focused.aggregate.score)}</b>
            <span>
              多头概率 {formatProbability(focused.aggregate.probability)} · 使用 {focused.aggregate.used} 个因子 · 原始分{" "}
              {formatScore(focused.aggregate.rawScore)} × 分散乘数 {focused.aggregate.fdm.toFixed(2)}
            </span>
          </h3>
          <ul>
            {CATEGORY_META.map((category) => {
              const score = focused.aggregate?.categories.find((item) => item.category === category.id);
              return (
                <li key={category.id}>
                  <span>{category.name}</span>
                  <b style={{ color: probabilityTone(score ? (score.score + 1) / 2 : null) }}>{score ? formatScore(score.score) : "—"}</b>
                  <small>{score ? `${score.count} 个` : "未计入"}</small>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {ranked.some((row) => row.stat.samples > 0) && (
        <details className="method" open>
          <summary>{focused.tf.label} 上各因子最近样本的命中率与 IC</summary>
          <p>向前 4 根 K 线的收益。样本大约 16 个点，只覆盖手头这截历史，不是完整回测。横截面动量和基差快照不参与。</p>
          <div className="quality-scroll">
            <table className="quality">
              <thead>
                <tr>
                  <th>因子</th>
                  <th>命中率</th>
                  <th>IC</th>
                  <th>样本</th>
                  <th>权重</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((row) => (
                  <tr key={row.name}>
                    <td>{row.name}</td>
                    <td>{formatHit(row.stat.hitRate)}</td>
                    <td className={row.stat.ic != null && row.stat.ic < 0 ? "down" : "up"}>{formatIc(row.stat.ic)}</td>
                    <td>{row.stat.samples || "—"}</td>
                    <td>{weightByHistory ? row.weight.toFixed(2) : "1.00"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <details className="method" open>
        <summary>综合概率怎么算</summary>
        <ol>
          <li>每个因子先把原始信号除以实现波动，再封顶到 [-1, 1]。正数是多头，负数是空头。接近 0 的格子显示为中性，但数值仍参与平均，不再被硬阈值清成 0。</li>
          <li>EWMAC 用 Carver 的刻度：波动调整后的均线差放大到「常态大约 10、上限 ±20」，界面再除以 20。其他因子用「大约 2 倍波动对应 ±1」的同样封顶。</li>
          <li>类别内部做加权平均。默认权重是 1。打开历史 IC 加权时，权重 = 0.6 + 0.4 × 把 IC/0.08 限制在 [-1, 1]，并且不低于 0.2。样本少于 12 或算不出 IC 时权重保持 1。</li>
          <li>六个类别再等权，得到原始分。因子多的类别不会压过因子少的类别。缺数据的因子跳过；整类都没有数据时，这一类不进入平均。</li>
          <li>原始分乘以分散乘数。类别之间用先验相关 0.35，负相关按 0 处理。乘数 = min(2.5, sqrt(N / (1+(N-1)×0.35)))。类别完全同向时乘数把分数拉回单一预测的量级，然后仍封顶在 ±1。这是 Carver 的 forecast diversification multiplier。</li>
          <li>多头概率 = 1 / (1 + e^(−3S))。S = 0 时是 50%，S = 1 时约 95%，S = −1 时约 5%。</li>
        </ol>
        <p>自选总览和侧栏上的日线概率使用同一套类别等权和分散乘数，但不逐个代码重算 IC。这是因子投票的映射，不是未来涨跌的胜率。</p>
      </details>
    </div>
  );
}
