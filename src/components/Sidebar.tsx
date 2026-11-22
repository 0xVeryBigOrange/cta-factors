import { useEffect, useMemo, useState } from "react";
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
  sheetOpen: boolean;
  onSheet: (open: boolean) => void;
  onMarket: (market: "all" | Market) => void;
  onSelect: (item: WatchItem) => void;
  onAdd: (market: Market, symbol: string) => void;
  onRemove: (item: WatchItem) => void;
  onReset: () => void;
};

function usePhone() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const apply = () => setPhone(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  return phone;
}

export function Sidebar(props: Props) {
  const [query, setQuery] = useState("");
  const phone = usePhone();
  const suggestions = useMemo(() => searchSymbols(query), [query]);
  const symbol = query.trim().toUpperCase();
  const visible = props.items.filter((item) => props.market === "all" || item.market === props.market);
  const rows = visible.map((item) => {
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
    const selected = props.active != null && itemKey(props.active) === itemKey(item);
    const probability = aggregate && !aggregate.insufficient ? aggregate.probability : null;
    return { item, quote, daily, selected, probability };
  });

  useEffect(() => {
    if (!props.sheetOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") props.onSheet(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.sheetOpen, props.onSheet]);

  return (
    <>
      <div className="watch-chipbar">
        <button
          type="button"
          className="sheet-launch"
          aria-haspopup="dialog"
          aria-expanded={props.sheetOpen}
          onClick={() => props.onSheet(true)}
        >
          自选
        </button>
        <div className="watch-chips">
          {rows.map((row) => (
            <button
              key={itemKey(row.item)}
              type="button"
              className={row.selected ? "on" : ""}
              onClick={() => props.onSelect(row.item)}
            >
              <b>{row.item.symbol}</b>
              <small style={{ color: probabilityTone(row.probability) }}>
                {row.probability == null ? "—" : `日 ${Math.round(row.probability * 100)}%`}
              </small>
            </button>
          ))}
        </div>
      </div>
      {props.sheetOpen && (
        <button type="button" className="sheet-back" aria-label="关闭自选" onClick={() => props.onSheet(false)} />
      )}
      <aside
        className={props.sheetOpen ? "sidebar sheet-open" : "sidebar"}
        aria-label="自选列表"
        role={props.sheetOpen ? "dialog" : undefined}
        aria-modal={props.sheetOpen ? true : undefined}
        inert={phone && !props.sheetOpen ? true : undefined}
      >
        <div className="sheet-handle">
          <span className="sheet-grab" aria-hidden="true" />
          <strong>自选列表</strong>
          <button type="button" className="icon-btn" aria-label="关闭自选" onClick={() => props.onSheet(false)}>
            ×
          </button>
        </div>
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
          {rows.map((row) => (
            <li key={itemKey(row.item)} className={row.selected ? "selected" : ""}>
              <button type="button" className="watch-main" onClick={() => props.onSelect(row.item)}>
                <span className="watch-symbol">
                  <b>{row.item.symbol}</b>
                  <small>{row.quote?.name || displayName(row.item.market, row.item.symbol)}</small>
                </span>
                <span className="watch-px">
                  <b>{formatPrice(row.quote?.price ?? row.daily?.candles.at(-1)?.close)}</b>
                  <small className={row.quote?.changePercent != null && row.quote.changePercent < 0 ? "down" : "up"}>
                    {formatPercent(row.quote?.changePercent)}
                  </small>
                </span>
                <span className="watch-prob" style={{ color: probabilityTone(row.probability) }}>
                  {row.probability != null
                    ? `日 ${Math.round(row.probability * 100)}%`
                    : row.daily?.status === "loading"
                      ? "…"
                      : "—"}
                </span>
              </button>
              <button type="button" className="icon-btn" aria-label={`移除 ${row.item.symbol}`} onClick={() => props.onRemove(row.item)}>
                ×
              </button>
            </li>
          ))}
        </ul>
        {!rows.length && <p className="empty">这个筛选下没有代码。搜索后可以添加。</p>}
        <button type="button" className="text-btn" onClick={props.onReset}>
          恢复默认自选
        </button>
      </aside>
    </>
  );
}
