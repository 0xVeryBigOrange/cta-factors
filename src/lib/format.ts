import type { Reading } from "../types";

export function formatPrice(value?: number): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return value.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatPercent(value?: number, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

export function formatProbability(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

export function formatScore(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}`;
}

export function formatTime(value?: number): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

export function cellTone(reading: Reading | null): { background: string; color: string; label: string } {
  if (!reading || reading.direction === "neutral") {
    return { background: "#2c3546", color: "#d5deea", label: "中" };
  }
  const mag = Math.min(1, Math.abs(reading.strength));
  if (reading.direction === "long") {
    const light = 16 + mag * 18;
    return { background: `hsl(154 64% ${light}%)`, color: "#f4fff8", label: "多" };
  }
  const light = 20 + mag * 16;
  return { background: `hsl(352 62% ${light}%)`, color: "#fff6f6", label: "空" };
}

export function probabilityTone(probability?: number | null): string {
  if (probability == null || !Number.isFinite(probability)) return "var(--muted)";
  if (probability >= 0.6) return "var(--long-text)";
  if (probability <= 0.4) return "var(--short-text)";
  return "var(--gold)";
}
