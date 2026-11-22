import { useEffect, useMemo, useState } from "react";
import type { Market, WatchItem } from "../types";
import { DEFAULT_WATCHLIST, normalizeSymbol, sameItem } from "../data/symbols";

const LIST_KEY = "cta-factors-watchlist-v1";
const ACTIVE_KEY = "cta-factors-active-v1";

function validItem(value: unknown): value is WatchItem {
  if (!value || typeof value !== "object") return false;
  const item = value as WatchItem;
  return (item.market === "crypto" || item.market === "stock") && typeof item.symbol === "string" && /^[A-Z0-9.]{1,12}$/.test(item.symbol);
}

function readList(): WatchItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LIST_KEY) ?? "");
    if (!Array.isArray(parsed)) return DEFAULT_WATCHLIST;
    const items = parsed.filter(validItem);
    return items.length ? items : DEFAULT_WATCHLIST;
  } catch {
    return DEFAULT_WATCHLIST;
  }
}

function readActive(items: WatchItem[]): WatchItem {
  try {
    const parsed = JSON.parse(localStorage.getItem(ACTIVE_KEY) ?? "");
    if (validItem(parsed)) {
      const found = items.find((item) => sameItem(item, parsed));
      if (found) return found;
    }
  } catch {
    /* use the first symbol */
  }
  return items[0];
}

export function useWatchlist() {
  const [items, setItems] = useState<WatchItem[]>(readList);
  const [active, setActive] = useState<WatchItem>(() => readActive(readList()));

  useEffect(() => {
    localStorage.setItem(LIST_KEY, JSON.stringify(items));
  }, [items]);

  useEffect(() => {
    localStorage.setItem(ACTIVE_KEY, JSON.stringify(active));
  }, [active]);

  useEffect(() => {
    if (!items.length) return;
    if (!items.some((item) => sameItem(item, active))) setActive(items[0]);
  }, [items, active]);

  const listKey = useMemo(() => items.map((item) => `${item.market}:${item.symbol}`).join("|"), [items]);

  function add(market: Market, raw: string) {
    const symbol = normalizeSymbol(raw);
    if (!symbol) return;
    const item = { market, symbol };
    setItems((current) => (current.some((candidate) => sameItem(candidate, item)) ? current : [...current, item]));
    setActive(item);
  }

  function remove(item: WatchItem) {
    setItems((current) => current.filter((candidate) => !sameItem(candidate, item)));
  }

  function reset() {
    setItems(DEFAULT_WATCHLIST);
    setActive(DEFAULT_WATCHLIST[0]);
  }

  return { items, active: items.find((item) => sameItem(item, active)) ?? items[0] ?? null, listKey, setActive, add, remove, reset };
}
