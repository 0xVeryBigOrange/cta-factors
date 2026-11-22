import type { Reading } from "../types";

export function clampSigned(value: number): number {
  if (!Number.isFinite(value)) return NaN;
  return Math.max(-1, Math.min(1, value));
}

/** Map an unbounded value so that `scale` is a strong but not saturated move. */
export function squash(value: number, scale: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(scale) || scale === 0) return NaN;
  return Math.tanh(value / scale);
}

/**
 * Carver scales a vol-adjusted raw forecast so a typical reading is about 10,
 * then caps it at ±20. Strength here is that capped forecast divided by 20,
 * so ±1 is the cap and ±0.5 is an ordinary strong forecast.
 */
export function carverForecast(rawVolAdjusted: number, scalar: number): number {
  if (!Number.isFinite(rawVolAdjusted) || !Number.isFinite(scalar)) return NaN;
  const capped = Math.max(-20, Math.min(20, rawVolAdjusted * scalar));
  return capped / 20;
}

/** `unit` is the raw move that should land at strength 0.5. Twice that is the cap. */
export function capUnit(raw: number, unit: number): number {
  if (!Number.isFinite(raw) || !Number.isFinite(unit) || unit === 0) return NaN;
  return clampSigned(raw / (2 * unit));
}

export function reading(score: number, deadzone = 0.08): Reading | null {
  if (!Number.isFinite(score)) return null;
  const strength = clampSigned(score);
  if (Math.abs(strength) < deadzone) return { direction: "neutral", strength };
  return { direction: strength > 0 ? "long" : "short", strength };
}

export function directional(long: boolean, magnitude: number, floor = 0.28): Reading {
  const size = Math.max(floor, Math.min(1, Math.abs(magnitude)));
  return { direction: long ? "long" : "short", strength: long ? size : -size };
}

export const NEUTRAL: Reading = { direction: "neutral", strength: 0 };
