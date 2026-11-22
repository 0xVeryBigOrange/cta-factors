import { useState } from "react";
import { CATEGORY_META } from "../factors/catalog";
import type { Derivatives } from "../factors/catalog";
import { evaluateAggregate } from "../factors/evaluate";
import type { SeriesSnap } from "../data/engine";
import type { Market, Timeframe } from "../types";
import { TIMEFRAMES } from "../types";
import { formatProbability, formatScore, probabilityTone } from "../lib/format";

type Props = {
  market: Market;
  series: Record<Timeframe, SeriesSnap | undefined>;
  derivatives: Derivatives | null;
};

export function CombinedView(props: Props) {
  const [focus, setFocus] = useState<Timeframe>("1d");
  const cards = TIMEFRAMES.map((tf) => {
    const snap = props.series[tf.id];
    if (snap?.status !== "ready") {
      return { tf, aggregate: null, status: snap?.status ?? "loading", error: snap?.error };
    }
    return {
      tf,
      status: "ready" as const,
      error: undefined,
      aggregate: evaluateAggregate(snap.candles, { timeframe: tf.id, derivatives: props.derivatives }, props.market),
    };
  });
  const focused = cards.find((card) => card.tf.id === focus) ?? cards[0];

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
              <i style={{ width: `${probability == null ? 0 : probability * 100}%` }} />
            </button>
          );
        })}
      </div>
      {focused?.aggregate && !focused.aggregate.insufficient && (
        <div className="breakdown">
          <h3>
            {focused.tf.label} 分类得分 <b>{formatScore(focused.aggregate.score)}</b>
            <span>多头概率 {formatProbability(focused.aggregate.probability)} · 使用 {focused.aggregate.used} 个因子</span>
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
      <details className="method" open>
        <summary>综合概率怎么算</summary>
        <ol>
          <li>每个因子给出 [-1, 1] 的强度。正数是多头，负数是空头，接近 0 记为中性。</li>
          <li>先在类别内部取强度的简单平均。趋势、动量、均值回归、波动、量能、衍生品各类权重相同，所以某一类因子多，也不会压过因子少的类别。</li>
          <li>没有数据的因子直接跳过，例如股票没有资金费率，或 K 线根数不够。若一整类都没有数据，这一类不进入平均。</li>
          <li>中性因子的强度是 0，会把该类别拉向 0，表示「这一条没有优势」。</li>
          <li>各类得分再等权合成总分 S。多头概率 = 1 / (1 + e^(−3S))。S = 0 时是 50%，S = 1 时约 95%，S = −1 时约 5%。</li>
        </ol>
        <p>这是因子投票经过逻辑函数后的读数，不是对未来涨跌的胜率预测。</p>
      </details>
    </div>
  );
}
