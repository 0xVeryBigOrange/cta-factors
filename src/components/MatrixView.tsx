import { Fragment, useState } from "react";
import { CATEGORY_META, factorsFor, type Derivatives, type PeerReturn } from "../factors/catalog";
import { evaluate } from "../factors/evaluate";
import type { SeriesSnap } from "../data/engine";
import type { Market, Timeframe } from "../types";
import { TIMEFRAMES } from "../types";
import { cellTone, formatScore } from "../lib/format";
import type { Factor } from "../factors/catalog";

type Props = {
  symbol: string;
  market: Market;
  series: Record<Timeframe, SeriesSnap | undefined>;
  derivatives: Derivatives | null;
  peers: Partial<Record<Timeframe, PeerReturn[]>>;
  derivStatus?: "loading" | "ready" | "error" | "idle";
  onOpen: (factor: Factor) => void;
};

export function MatrixView(props: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const factors = factorsFor(props.market);
  const columns = TIMEFRAMES.map((tf) => {
    const snap = props.series[tf.id];
    const ready = snap?.status === "ready" && snap.candles.length > 0;
    const cells = ready
      ? evaluate(
          snap.candles,
          { timeframe: tf.id, symbol: props.symbol, derivatives: props.derivatives, peers: props.peers[tf.id] },
          props.market,
        )
      : [];
    return { tf, snap, cells };
  });

  return (
    <div className="matrix-block">
      <p className="scroll-hint">左右滑动查看其他周期，点分组名可收起。</p>
      <div className="matrix-scroll">
      <table className="matrix">
        <thead>
          <tr>
            <th className="sticky-col">因子</th>
            {columns.map((column) => (
              <th key={column.tf.id}>
                <span>{column.tf.label}</span>
                <small>
                  {column.snap?.status === "loading"
                    ? "加载中"
                    : column.snap?.status === "empty"
                      ? "不可用"
                      : column.snap?.status === "error"
                        ? "失败"
                        : column.snap?.source?.includes("聚合")
                          ? "聚合"
                          : column.snap?.candles.length
                            ? `${column.snap.candles.length}根`
                            : ""}
                </small>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CATEGORY_META.filter((category) => factors.some((factor) => factor.category === category.id)).map((category) => {
            const group = factors.filter((factor) => factor.category === category.id);
            const closed = collapsed[category.id] === true;
            return (
            <Fragment key={category.id}>
              <tr className="group">
                <th colSpan={TIMEFRAMES.length + 1}>
                  <button
                    type="button"
                    className="group-toggle"
                    aria-expanded={!closed}
                    onClick={() => setCollapsed((current) => ({ ...current, [category.id]: !current[category.id] }))}
                  >
                    <span aria-hidden="true">{closed ? "▸" : "▾"}</span>
                    {category.name}
                    <small>{group.length}</small>
                  </button>
                </th>
              </tr>
              {!closed && group.map((factor) => (
                  <tr key={factor.id}>
                    <th className="sticky-col">
                      <button type="button" className="factor-btn" onClick={() => props.onOpen(factor)}>
                        <span>{factor.name}</span>
                        <small>{factor.abbr}</small>
                      </button>
                    </th>
                    {columns.map((column) => {
                      const snap = column.snap;
                      const cell = column.cells.find((item) => item.factor.id === factor.id);
                      const loading =
                        !snap ||
                        snap.status === "loading" ||
                        (factor.cryptoOnly && props.derivStatus === "loading" && !cell?.reading);
                      if (loading && !cell?.reading) {
                        return <td key={column.tf.id}><span className="skeleton" /></td>;
                      }
                      if (!cell?.reading) {
                        const title = snap?.error || (factor.cryptoOnly ? "衍生品数据不可用" : "K 线不足以计算该因子");
                        return (
                          <td key={column.tf.id}>
                            <span className="cell na" title={title}>—</span>
                          </td>
                        );
                      }
                      const tone = cellTone(cell.reading);
                      return (
                        <td key={column.tf.id}>
                          <button
                            type="button"
                            className="cell"
                            style={{ background: tone.background, color: tone.color }}
                            title={`${factor.name} · ${column.tf.label} · ${tone.label} ${formatScore(cell.reading.strength)}`}
                            onClick={() => props.onOpen(factor)}
                          >
                            <b>{tone.label}</b>
                            <small>{formatScore(cell.reading.strength)}</small>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </Fragment>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}

