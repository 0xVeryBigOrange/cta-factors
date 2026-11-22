import type { Candle } from "../types";

export function sma(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length < period || period <= 0) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder smoothing. Leading non-finite values are skipped when seeding. */
export function rma(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (period <= 0) return out;
  let sum = 0;
  let count = 0;
  let prev = NaN;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (!Number.isFinite(value)) continue;
    if (!Number.isFinite(prev)) {
      sum += value;
      count += 1;
      if (count === period) {
        prev = sum / period;
        out[i] = prev;
      }
    } else {
      prev = (prev * (period - 1) + value) / period;
      out[i] = prev;
    }
  }
  return out;
}

export function wma(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (period <= 0) return out;
  const denom = (period * (period + 1)) / 2;
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    let ok = true;
    for (let j = 0; j < period; j++) {
      const value = values[i - j];
      if (!Number.isFinite(value)) {
        ok = false;
        break;
      }
      sum += value * (period - j);
    }
    if (ok) out[i] = sum / denom;
  }
  return out;
}

export function hma(values: number[], period: number): number[] {
  const half = Math.max(1, Math.round(period / 2));
  const root = Math.max(1, Math.round(Math.sqrt(period)));
  const fast = wma(values, half);
  const slow = wma(values, period);
  const diff = values.map((_, i) =>
    Number.isFinite(fast[i]) && Number.isFinite(slow[i]) ? 2 * fast[i] - slow[i] : NaN,
  );
  return wma(diff, root);
}

export function kama(values: number[], erPeriod = 10, fast = 2, slow = 30): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length <= erPeriod) return out;
  const fastSc = 2 / (fast + 1);
  const slowSc = 2 / (slow + 1);
  out[erPeriod] = values[erPeriod];
  for (let i = erPeriod + 1; i < values.length; i++) {
    const change = Math.abs(values[i] - values[i - erPeriod]);
    let volatility = 0;
    for (let j = i - erPeriod + 1; j <= i; j++) {
      volatility += Math.abs(values[j] - values[j - 1]);
    }
    const efficiency = volatility === 0 ? 0 : change / volatility;
    const sc = (efficiency * (fastSc - slowSc) + slowSc) ** 2;
    out[i] = out[i - 1] + sc * (values[i] - out[i - 1]);
  }
  return out;
}

export function rsi(values: number[], period = 14): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length <= period || period <= 0) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const delta = values[i] - values[i - 1];
    if (delta >= 0) gain += delta;
    else loss -= delta;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    const up = delta > 0 ? delta : 0;
    const down = delta < 0 ? -delta : 0;
    gain = (gain * (period - 1) + up) / period;
    loss = (loss * (period - 1) + down) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function trueRanges(candles: Candle[]): number[] {
  return candles.map((candle, i) => {
    if (i === 0) return candle.high - candle.low;
    const prev = candles[i - 1].close;
    return Math.max(candle.high - candle.low, Math.abs(candle.high - prev), Math.abs(candle.low - prev));
  });
}

export function atr(candles: Candle[], period = 14): number[] {
  return rma(trueRanges(candles), period);
}

export function macd(values: number[], fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const line = values.map((_, i) =>
    Number.isFinite(emaFast[i]) && Number.isFinite(emaSlow[i]) ? emaFast[i] - emaSlow[i] : NaN,
  );
  const start = line.findIndex((value) => Number.isFinite(value));
  const signalLine = new Array<number>(values.length).fill(NaN);
  if (start >= 0) {
    const slice = line.slice(start).map((value) => value);
    const smoothed = ema(slice, signal);
    for (let i = 0; i < smoothed.length; i++) signalLine[start + i] = smoothed[i];
  }
  const hist = line.map((value, i) =>
    Number.isFinite(value) && Number.isFinite(signalLine[i]) ? value - signalLine[i] : NaN,
  );
  return { line, signal: signalLine, hist };
}

export function stdev(values: number[], end: number, period: number): number | null {
  const start = end - period + 1;
  if (start < 0 || period <= 0) return null;
  let sum = 0;
  for (let i = start; i <= end; i++) sum += values[i];
  const mean = sum / period;
  let acc = 0;
  for (let i = start; i <= end; i++) {
    const delta = values[i] - mean;
    acc += delta * delta;
  }
  return Math.sqrt(acc / period);
}

export function linregSlope(values: number[], end: number, period: number): number | null {
  const start = end - period + 1;
  if (start < 0 || period < 2) return null;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < period; i++) {
    const y = values[start + i];
    if (!Number.isFinite(y)) return null;
    sumX += i;
    sumY += y;
    sumXY += i * y;
    sumXX += i * i;
  }
  const denom = period * sumXX - sumX * sumX;
  if (denom === 0) return null;
  return (period * sumXY - sumX * sumY) / denom;
}

export function stochasticK(candles: Candle[], period = 14): number[] {
  const out = new Array<number>(candles.length).fill(NaN);
  for (let i = period - 1; i < candles.length; i++) {
    let high = -Infinity;
    let low = Infinity;
    for (let k = i - period + 1; k <= i; k++) {
      high = Math.max(high, candles[k].high);
      low = Math.min(low, candles[k].low);
    }
    const range = high - low;
    out[i] = range === 0 ? 50 : ((candles[i].close - low) / range) * 100;
  }
  return out;
}

export function cciLast(candles: Candle[], period = 20): number | null {
  if (candles.length < period) return null;
  const typical: number[] = [];
  for (let i = candles.length - period; i < candles.length; i++) {
    const candle = candles[i];
    typical.push((candle.high + candle.low + candle.close) / 3);
  }
  const mean = typical.reduce((sum, value) => sum + value, 0) / period;
  const deviation = typical.reduce((sum, value) => sum + Math.abs(value - mean), 0) / period;
  if (deviation === 0) return 0;
  return (typical[typical.length - 1] - mean) / (0.015 * deviation);
}

export function williamsRLast(candles: Candle[], period = 14): number | null {
  if (candles.length < period) return null;
  const end = candles.length - 1;
  let high = -Infinity;
  let low = Infinity;
  for (let i = end - period + 1; i <= end; i++) {
    high = Math.max(high, candles[i].high);
    low = Math.min(low, candles[i].low);
  }
  if (high === low) return -50;
  return ((high - candles[end].close) / (high - low)) * -100;
}

export function obv(candles: Candle[]): number[] {
  const out = new Array<number>(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    const direction = Math.sign(candles[i].close - candles[i - 1].close);
    out[i] = out[i - 1] + direction * candles[i].volume;
  }
  return out;
}

export function mfiLast(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  let positive = 0;
  let negative = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const typical = (candles[i].high + candles[i].low + candles[i].close) / 3;
    const previous = (candles[i - 1].high + candles[i - 1].low + candles[i - 1].close) / 3;
    const flow = typical * candles[i].volume;
    if (typical > previous) positive += flow;
    else if (typical < previous) negative += flow;
  }
  if (positive + negative === 0) return null;
  if (negative === 0) return 100;
  return 100 - 100 / (1 + positive / negative);
}

export function cmfLast(candles: Candle[], period = 20): number | null {
  if (candles.length < period) return null;
  let flow = 0;
  let volume = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const candle = candles[i];
    const range = candle.high - candle.low;
    const multiplier = range === 0 ? 0 : (candle.close - candle.low - (candle.high - candle.close)) / range;
    flow += multiplier * candle.volume;
    volume += candle.volume;
  }
  if (volume === 0) return null;
  return flow / volume;
}

export function vwapLast(candles: Candle[], period = 20): number | null {
  if (candles.length < period) return null;
  let pv = 0;
  let volume = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const candle = candles[i];
    const typical = (candle.high + candle.low + candle.close) / 3;
    pv += typical * candle.volume;
    volume += candle.volume;
  }
  if (volume === 0) return null;
  return pv / volume;
}

export function adxLast(candles: Candle[], period = 14): { adx: number; plusDI: number; minusDI: number } | null {
  if (candles.length < period * 2 + 2) return null;
  const tr: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      tr.push(candles[i].high - candles[i].low);
      plusDM.push(NaN);
      minusDM.push(NaN);
      continue;
    }
    const up = candles[i].high - candles[i - 1].high;
    const down = candles[i - 1].low - candles[i].low;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
    const prevClose = candles[i - 1].close;
    tr.push(
      Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - prevClose),
        Math.abs(candles[i].low - prevClose),
      ),
    );
  }
  const smoothTr = rma(tr, period);
  const smoothPlus = rma(plusDM, period);
  const smoothMinus = rma(minusDM, period);
  const dx = candles.map((_, i) => {
    if (!Number.isFinite(smoothTr[i]) || smoothTr[i] === 0) return NaN;
    if (!Number.isFinite(smoothPlus[i]) || !Number.isFinite(smoothMinus[i])) return NaN;
    const plusDI = (100 * smoothPlus[i]) / smoothTr[i];
    const minusDI = (100 * smoothMinus[i]) / smoothTr[i];
    const sum = plusDI + minusDI;
    if (sum === 0) return 0;
    return (100 * Math.abs(plusDI - minusDI)) / sum;
  });
  const adx = rma(dx, period);
  const i = candles.length - 1;
  if (!Number.isFinite(adx[i]) || !Number.isFinite(smoothTr[i]) || smoothTr[i] === 0) return null;
  return {
    adx: adx[i],
    plusDI: (100 * smoothPlus[i]) / smoothTr[i],
    minusDI: (100 * smoothMinus[i]) / smoothTr[i],
  };
}

export function priorChannel(candles: Candle[], period: number): { high: number; low: number } | null {
  const end = candles.length - 1;
  const start = end - period;
  if (start < 0) return null;
  let high = -Infinity;
  let low = Infinity;
  for (let i = start; i < end; i++) {
    high = Math.max(high, candles[i].high);
    low = Math.min(low, candles[i].low);
  }
  if (!Number.isFinite(high) || !Number.isFinite(low)) return null;
  return { high, low };
}

export function aroonLast(candles: Candle[], period = 25): { up: number; down: number } | null {
  const end = candles.length - 1;
  if (end < period) return null;
  let highIndex = end;
  let lowIndex = end;
  for (let i = end - period; i <= end; i++) {
    if (candles[i].high >= candles[highIndex].high) highIndex = i;
    if (candles[i].low <= candles[lowIndex].low) lowIndex = i;
  }
  return {
    up: ((period - (end - highIndex)) / period) * 100,
    down: ((period - (end - lowIndex)) / period) * 100,
  };
}

export function psar(candles: Candle[], step = 0.02, maxAf = 0.2): { sar: number; long: boolean } | null {
  if (candles.length < 3) return null;
  let isLong = candles[1].close >= candles[0].close;
  let af = step;
  let extreme = isLong ? candles[0].high : candles[0].low;
  let sar = isLong ? candles[0].low : candles[0].high;
  for (let i = 1; i < candles.length; i++) {
    sar = sar + af * (extreme - sar);
    if (isLong) {
      sar = Math.min(sar, candles[i - 1].low);
      if (i > 1) sar = Math.min(sar, candles[i - 2].low);
      if (candles[i].low < sar) {
        isLong = false;
        sar = extreme;
        extreme = candles[i].low;
        af = step;
      } else if (candles[i].high > extreme) {
        extreme = candles[i].high;
        af = Math.min(maxAf, af + step);
      }
    } else {
      sar = Math.max(sar, candles[i - 1].high);
      if (i > 1) sar = Math.max(sar, candles[i - 2].high);
      if (candles[i].high > sar) {
        isLong = true;
        sar = extreme;
        extreme = candles[i].high;
        af = step;
      } else if (candles[i].low < extreme) {
        extreme = candles[i].low;
        af = Math.min(maxAf, af + step);
      }
    }
  }
  return { sar, long: isLong };
}

export function supertrend(
  candles: Candle[],
  period = 10,
  multiplier = 3,
): { line: number; long: boolean } | null {
  const ranges = atr(candles, period);
  let finalUpper = NaN;
  let finalLower = NaN;
  let isLong = true;
  let line = NaN;
  let ready = false;
  for (let i = 0; i < candles.length; i++) {
    if (!Number.isFinite(ranges[i])) continue;
    const mid = (candles[i].high + candles[i].low) / 2;
    const basicUpper = mid + multiplier * ranges[i];
    const basicLower = mid - multiplier * ranges[i];
    if (!ready) {
      finalUpper = basicUpper;
      finalLower = basicLower;
      isLong = candles[i].close >= mid;
      line = isLong ? finalLower : finalUpper;
      ready = true;
      continue;
    }
    finalUpper = basicUpper < finalUpper || candles[i - 1].close > finalUpper ? basicUpper : finalUpper;
    finalLower = basicLower > finalLower || candles[i - 1].close < finalLower ? basicLower : finalLower;
    if (isLong) {
      if (candles[i].close < finalLower) isLong = false;
    } else if (candles[i].close > finalUpper) {
      isLong = true;
    }
    line = isLong ? finalLower : finalUpper;
  }
  if (!ready || !Number.isFinite(line)) return null;
  return { line, long: isLong };
}

export function tsiLast(values: number[], long = 25, short = 13): number | null {
  if (values.length < long + short) return null;
  const momentum: number[] = [0];
  const absolute: number[] = [0];
  for (let i = 1; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    momentum.push(delta);
    absolute.push(Math.abs(delta));
  }
  const num = ema(ema(momentum, long), short);
  const den = ema(ema(absolute, long), short);
  const n = num[num.length - 1];
  const d = den[den.length - 1];
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return (100 * n) / d;
}

export function kstLast(values: number[]): { kst: number; signal: number } | null {
  const roc = (period: number) =>
    values.map((value, i) => (i < period || values[i - period] === 0 ? NaN : (value / values[i - period] - 1) * 100));
  const smaMasked = (series: number[], period: number) => {
    const out = new Array<number>(series.length).fill(NaN);
    let sum = 0;
    let count = 0;
    for (let i = 0; i < series.length; i++) {
      const value = series[i];
      if (Number.isFinite(value)) {
        sum += value;
        count += 1;
      }
      if (i >= period) {
        const removed = series[i - period];
        if (Number.isFinite(removed)) {
          sum -= removed;
          count -= 1;
        }
      }
      if (i >= period - 1 && count === period) out[i] = sum / period;
    }
    return out;
  };
  const r1 = smaMasked(roc(10), 10);
  const r2 = smaMasked(roc(15), 10);
  const r3 = smaMasked(roc(20), 10);
  const r4 = smaMasked(roc(30), 15);
  const kst = values.map((_, i) =>
    [r1[i], r2[i], r3[i], r4[i]].every(Number.isFinite) ? r1[i] + 2 * r2[i] + 3 * r3[i] + 4 * r4[i] : NaN,
  );
  const signal = smaMasked(kst, 9);
  const i = values.length - 1;
  if (!Number.isFinite(kst[i]) || !Number.isFinite(signal[i])) return null;
  return { kst: kst[i], signal: signal[i] };
}

export function lastFinite(values: number[], back = 0): number | null {
  const index = values.length - 1 - back;
  if (index < 0 || !Number.isFinite(values[index])) return null;
  return values[index];
}

/** Stdev of recent log returns. Null when there are fewer than 8 usable returns. */
export function realizedVol(values: number[], lookback = 32): number | null {
  const start = Math.max(1, values.length - lookback);
  const rets: number[] = [];
  for (let i = start; i < values.length; i++) {
    if (values[i - 1] <= 0 || values[i] <= 0) continue;
    rets.push(Math.log(values[i] / values[i - 1]));
  }
  if (rets.length < 8) return null;
  const mean = rets.reduce((sum, value) => sum + value, 0) / rets.length;
  const variance = rets.reduce((sum, value) => sum + (value - mean) ** 2, 0) / rets.length;
  return Math.sqrt(variance);
}

/** ATR% and return volatility, floored so a smooth trend does not divide by ~0. */
export function barVol(candles: Candle[], lookback = 32): number {
  const close = candles[candles.length - 1]?.close ?? 0;
  const range = lastFinite(atr(candles, 14));
  const atrPct = range && close ? range / close : 0;
  const rv = realizedVol(candles.map((candle) => candle.close), lookback) ?? 0;
  return Math.max(atrPct, rv, 1e-4);
}

/** EWM standard deviation of price changes. Span matches Carver's vol_lookback. */
export function ewmStdChange(values: number[], span = 32): number | null {
  if (values.length < span + 1) return null;
  const alpha = 2 / (span + 1);
  let mean = values[1] - values[0];
  let variance = 0;
  for (let i = 2; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const prev = mean;
    mean = alpha * diff + (1 - alpha) * mean;
    variance = (1 - alpha) * (variance + alpha * (diff - prev) ** 2);
  }
  const sd = Math.sqrt(variance);
  return sd > 1e-12 ? sd : null;
}

/** EWM of absolute price changes, the volatility in Lempérière et al. */
export function ewmAbsChange(values: number[], span: number): number | null {
  if (values.length < Math.max(8, Math.floor(span / 2))) return null;
  const alpha = 2 / (span + 1);
  let level = Math.abs(values[1] - values[0]);
  for (let i = 2; i < values.length; i++) {
    level = alpha * Math.abs(values[i] - values[i - 1]) + (1 - alpha) * level;
  }
  return level > 0 ? level : null;
}

export function returnMoments(
  values: number[],
  lookback: number,
): { skew: number; excessKurt: number; upside: number } | null {
  const start = Math.max(1, values.length - lookback);
  const rets: number[] = [];
  for (let i = start; i < values.length; i++) {
    if (values[i - 1] <= 0 || values[i] <= 0) continue;
    rets.push(Math.log(values[i] / values[i - 1]));
  }
  if (rets.length < 12) return null;
  const count = rets.length;
  const mean = rets.reduce((sum, value) => sum + value, 0) / count;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  let up = 0;
  let total = 0;
  for (const ret of rets) {
    const delta = ret - mean;
    m2 += delta * delta;
    m3 += delta * delta * delta;
    m4 += delta ** 4;
    const square = ret * ret;
    total += square;
    if (ret > 0) up += square;
  }
  m2 /= count;
  m3 /= count;
  m4 /= count;
  if (m2 <= 0 || total <= 0) return null;
  return { skew: m3 / m2 ** 1.5, excessKurt: m4 / (m2 * m2) - 3, upside: up / total };
}

export function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 8) return null;
  const count = xs.length;
  const meanX = xs.reduce((sum, value) => sum + value, 0) / count;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / count;
  let num = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < count; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  if (varX === 0 || varY === 0) return null;
  return num / Math.sqrt(varX * varY);
}

/** t-statistic of the slope of log price on time. */
export function logPriceTStat(values: number[], end: number, period: number): number | null {
  const start = end - period + 1;
  if (start < 0 || period < 8) return null;
  const y: number[] = [];
  for (let i = start; i <= end; i++) {
    if (!(values[i] > 0)) return null;
    y.push(Math.log(values[i]));
  }
  const count = y.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < count; i++) {
    sumX += i;
    sumY += y[i];
    sumXY += i * y[i];
    sumXX += i * i;
  }
  const meanX = sumX / count;
  const slopeNumerator = sumXY - sumX * sumY / count;
  const sxx = sumXX - sumX * meanX;
  if (sxx <= 0) return null;
  const slope = slopeNumerator / sxx;
  const intercept = sumY / count - slope * meanX;
  let sse = 0;
  for (let i = 0; i < count; i++) {
    const error = y[i] - (intercept + slope * i);
    sse += error * error;
  }
  if (count <= 2) return null;
  const se = Math.sqrt(sse / (count - 2) / sxx);
  if (!(se > 0)) return slope > 0 ? Infinity : slope < 0 ? -Infinity : 0;
  return slope / se;
}

export function midpoint(candles: Candle[], end: number, period: number): number | null {
  const start = end - period + 1;
  if (start < 0) return null;
  let high = -Infinity;
  let low = Infinity;
  for (let i = start; i <= end; i++) {
    high = Math.max(high, candles[i].high);
    low = Math.min(low, candles[i].low);
  }
  return (high + low) / 2;
}
