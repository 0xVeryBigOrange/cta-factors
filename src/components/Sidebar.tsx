import { useMemo, useState } from "react";
import type { Market, WatchItem } from "../types";
import { canBeCrypto, canBeStock, displayName, searchSymbols } from "../data/symbols";
import { itemKey } from "../data/engine";
import type { EngineSnapshot } from "../data/engine";
import { formatPercent, formatPrice, probabilityTone } from "../lib/format";
import { evaluateAggregate } from "../factors/evaluate";
import { buildPeers, factorContext } from "../factors/peers";

type Props = {
  items: WatchItem[];
  active: WatchItem | null;
  market: "all" | Market;
  snapshot: EngineSnapshot;
  onMarket: (market: "all" | Market) => void;
  onSelect: (item: WatchItem) => void;
  onAdd: (market: Market, symbol: string) => void;
  onRemove: (item: WatchItem) => void;
  onReset: () => void;
};

export function Sidebar(props: Props) {
  const [query, setQuery] = useState("");
  const suggestions = useMemo(() => searchSymbols(query), [query]);
  const symbol = query.trim().toUpperCase();
  const visible = props.items.filter((item) => props.market === "all" || item.market === props.market);

  return (
    <aside className="sidebar">
      <form
        className="search"
        onSubmit={(event) => {
          event.preventDefault();
          if (canBeCrypto(symbol)) props.onAdd("crypto", symbol);
          else if (canBeStock(symbol)) props.onAdd("stock", symbol);
          setQuery("");
        }}
      >
        <label htmlFor="symbol-search">搜索代码</label>
        <input
          id="symbol-search"
          value={query}
          placeholder="BTC、ETH、AAPL…"
          autoCapitalize="characters"
          onChange={(event) => setQuery(event.target.value)}
        />
        {query.trim() && (
          <div className="suggest">
            {suggestions.map((item) => (
              <button
                type="button"
                key={`${item.market}:${item.symbol}`}
                onClick={() => {
                  props.onAdd(item.market, item.symbol);
                  setQuery("");
                }}
              >
                <b>{item.symbol}</b>
                <span>{item.name}</span>
                <em>{item.market === "crypto" ? "加密" : "美股"}</em>
              </button>
            ))}
            <div className="suggest-actions">
              {canBeCrypto(symbol) && (
                <button type="button" onClick={() => { props.onAdd("crypto", symbol); setQuery(""); }}>
                  添加加密 {symbol}
                </button>
              )}
              {canBeStock(symbol) && (
                <button type="button" onClick={() => { props.onAdd("stock", symbol); setQuery(""); }}>
                  添加美股 {symbol}
                </button>
              )}
            </div>
          </div>
        )}
      </form>
      <div className="filters" role="tablist" aria-label="市场筛选">
        {(
          [
            ["all", "全部"],
            ["crypto", "加密"],
            ["stock", "美股"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" className={props.market === id ? "on" : ""} onClick={() => props.onMarket(id)}>
            {label}
          </button>
        ))}
      </div>
      <ul className="watch">
        {visible.map((item) => {
          const quote = props.snapshot.quotes[itemKey(item)];
          const daily = props.snapshot.series[`${item.market}:${item.symbol}:1d`];
          const deriv = item.market === "crypto" ? props.snapshot.deriv[`crypto:${item.symbol}`] : undefined;
          const aggregate =
            daily?.status === "ready"
              ? evaluateAggregate(
                  daily.candles,
                  factorContext(
                    item,
                    "1d",
                    deriv?.status === "ready" ? deriv : null,
                    buildPeers(props.snapshot, props.items, "1d", item.market),
                  ),
                  item.market,
                )
              : null;
          const selected = props.active && itemKey(props.active) === itemKey(item);
          return (
            <li key={itemKey(item)} className={selected ? "selected" : ""}>
              <button type="button" className="watch-main" onClick={() => props.onSelect(item)}>
                <span className="watch-symbol">
                  <b>{item.symbol}</b>
                  <small>{quote?.name || displayName(item.market, item.symbol)}</small>
                </span>
                <span className="watch-px">
                  <b>{formatPrice(quote?.price ?? daily?.candles.at(-1)?.close)}</b>
                  <small className={quote?.changePercent != null && quote.changePercent < 0 ? "down" : "up"}>
                    {formatPercent(quote?.changePercent)}
                  </small>
                </span>
                <span className="watch-prob" style={{ color: probabilityTone(aggregate?.probability) }}>
                  {aggregate && !aggregate.insufficient ? `日 ${Math.round(aggregate.probability * 100)}%` : daily?.status === "loading" ? "…" : "—"}
                </span>
              </button>
              <button type="button" className="icon-btn" aria-label={`移除 ${item.symbol}`} onClick={() => props.onRemove(item)}>
                ×
              </button>
            </li>
          );
        })}
      </ul>
      {!visible.length && <p className="empty">这个筛选下没有代码。搜索后可以添加。</p>}
      <button type="button" className="text-btn" onClick={props.onReset}>
        恢复默认自选
      </button>
    </aside>
  );
}
