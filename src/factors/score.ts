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

export function reading(score: number, deadzone = 0.12): Reading | null {
  if (!Number.isFinite(score)) return null;
  const strength = clampSigned(score);
  if (Math.abs(strength) < deadzone) return { direction: "neutral", strength: 0 };
  return { direction: strength > 0 ? "long" : "short", strength };
}

export function directional(long: boolean, magnitude: number, floor = 0.28): Reading {
  const size = Math.max(floor, Math.min(1, Math.abs(magnitude)));
  return { direction: long ? "long" : "short", strength: long ? size : -size };
}

export const NEUTRAL: Reading = { direction: "neutral", strength: 0 };
