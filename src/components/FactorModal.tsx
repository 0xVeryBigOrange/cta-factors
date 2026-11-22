import { useEffect } from "react";
import type { Factor } from "../factors/catalog";
import type { FactorStat } from "../factors/history";
import type { Reading, Timeframe } from "../types";
import { TIMEFRAMES } from "../types";
import { cellTone, formatScore } from "../lib/format";

type Props = {
  factor: Factor;
  readings: Partial<Record<Timeframe, Reading | null>>;
  history: Partial<Record<Timeframe, FactorStat>>;
  onClose: () => void;
};

export function FactorModal(props: Props) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") props.onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);

  return (
    <div className="modal-back" onClick={props.onClose} role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="factor-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">{props.factor.abbr}</p>
            <h2 id="factor-title">{props.factor.name}</h2>
          </div>
          <button type="button" className="icon-btn" onClick={props.onClose} aria-label="关闭">
            ×
          </button>
        </header>
        <h3>定义</h3>
        <p>{props.factor.summary}</p>
        <h3>信号规则</h3>
        <p>{props.factor.rule}</p>
        {props.factor.citation && (
          <>
            <h3>文献</h3>
            <p>{props.factor.citation}</p>
          </>
        )}
        <h3>当前各周期</h3>
        <ul className="mini-readings">
          {TIMEFRAMES.map((tf) => {
            const reading = props.readings[tf.id];
            const tone = reading ? cellTone(reading) : null;
            return (
              <li key={tf.id}>
                <span>{tf.label}</span>
                {tone ? (
                  <b style={{ background: tone.background, color: tone.color }}>
                    {tone.label} {formatScore(reading?.strength)}
                  </b>
                ) : (
                  <b className="na-pill">无数据</b>
                )}
              </li>
            );
          })}
        </ul>
        <h3>最近样本</h3>
        <p className="muted">向前 4 根 K 线。样本短，只说明这段历史里信号和随后涨跌是否同向。</p>
        <ul className="mini-readings">
          {TIMEFRAMES.map((tf) => {
            const stat = props.history[tf.id];
            return (
              <li key={tf.id}>
                <span>{tf.label}</span>
                <b className="na-pill">
                  {stat && stat.samples >= 8
                    ? `命中 ${stat.hitRate == null ? "—" : `${Math.round(stat.hitRate * 100)}%`} · IC ${stat.ic == null ? "—" : stat.ic.toFixed(2)}`
                    : "样本不足"}
                </b>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
