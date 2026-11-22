import type { Candle, FactorCategory, Reading, Timeframe } from "../types";
import { timeframeMs } from "../types";
import {
  adxLast,
  aroonLast,
  atr,
  barVol,
  cciLast,
  cmfLast,
  ema,
  hma,
  kama,
  kstLast,
  lastFinite,
  linregSlope,
  macd,
  mfiLast,
  midpoint,
  obv,
  priorChannel,
  psar,
  rsi,
  sma,
  stdev,
  stochasticK,
  supertrend,
  tsiLast,
  vwapLast,
  williamsRLast,
} from "./indicators";
import { capUnit, directional, NEUTRAL, reading, squash } from "./score";
import { LITERATURE_FACTORS } from "./literature";

export type { FactorCategory };

export type DerivPoint = { time: number; value: number };
export type LsrPoint = { time: number; ratio: number };
export type FundingPoint = { time: number; rate: number };

export type Derivatives = {
  funding: FundingPoint[];
  oi: DerivPoint[];
  lsr: LsrPoint[];
  basis: number | null;
};

export type PeerReturn = {
  symbol: string;
  ret20: number | null;
  ret60: number | null;
};

export type FactorContext = {
  timeframe: Timeframe;
  /** Symbol being scored. Cross-sectional rank uses it to find this name in `peers`. */
  symbol?: string;
  derivatives?: Derivatives | null;
  /** Same-market watchlist returns used by the cross-sectional rank. */
  peers?: PeerReturn[];
};

export type Factor = {
  id: string;
  name: string;
  abbr: string;
  category: FactorCategory;
  summary: string;
  rule: string;
  /** Paper or practitioner source. Shown in the info panel and README. */
  citation?: string;
  minBars: number;
  needsVolume?: boolean;
  cryptoOnly?: boolean;
  compute: (candles: Candle[], ctx: FactorContext) => Reading | null;
};

export const CATEGORY_META: { id: FactorCategory; name: string }[] = [
  { id: "trend", name: "趋势" },
  { id: "momentum", name: "动量" },
  { id: "meanReversion", name: "均值回归" },
  { id: "volatility", name: "波动" },
  { id: "volume", name: "量能" },
  { id: "derivatives", name: "衍生品" },
];

function closes(candles: Candle[]): number[] {
  return candles.map((candle) => candle.close);
}

function pctChange(now: number, then: number): number | null {
  if (!Number.isFinite(now) || !Number.isFinite(then) || then === 0) return null;
  return now / then - 1;
}

function priceAtOrBefore(candles: Candle[], time: number): number | null {
  let chosen: number | null = null;
  for (const candle of candles) {
    if (candle.time <= time) chosen = candle.close;
    else break;
  }
  return chosen;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export const FACTORS: Factor[] = [
  {
    id: "sma-10-20",
    name: "SMA 10/20",
    abbr: "SMA10/20",
    category: "trend",
    minBars: 20,
    summary: "10 周期简单移动平均与 20 周期简单移动平均的相对位置。",
    rule: "快慢线百分比差距除以实现波动，再按 2 倍波动封顶。正差距为多，负差距为空。很小的差距仍保留，只是格子显示为中性。",
    citation: "Levine and Pedersen (2016) Which Trend Is Your Friend：波动率标准化后，均线交叉与时序动量是同一类信号。",
    compute: (candles) => maGap(candles, 10, 20),
  },
  {
    id: "sma-20-50",
    name: "SMA 20/50",
    abbr: "SMA20/50",
    category: "trend",
    minBars: 50,
    summary: "20 周期与 50 周期简单移动平均的中期趋势交叉。",
    rule: "快慢线百分比差距除以实现波动，再按 2 倍波动封顶。正差距为多，负差距为空。很小的差距仍保留，只是格子显示为中性。",
    citation: "Levine and Pedersen (2016) Which Trend Is Your Friend：波动率标准化后，均线交叉与时序动量是同一类信号。",
    compute: (candles) => maGap(candles, 20, 50),
  },
  {
    id: "sma-50-200",
    name: "SMA 50/200",
    abbr: "SMA50/200",
    category: "trend",
    minBars: 200,
    summary: "50 与 200 周期均线，对应传统金叉 / 死叉所描述的长周期趋势。",
    rule: "快慢线百分比差距除以实现波动，再按 2 倍波动封顶。正差距为多，负差距为空。很小的差距仍保留，只是格子显示为中性。",
    citation: "Levine and Pedersen (2016) Which Trend Is Your Friend：波动率标准化后，均线交叉与时序动量是同一类信号。",
    compute: (candles) => maGap(candles, 50, 200),
  },
  {
    id: "ema-slope-20",
    name: "EMA 斜率",
    abbr: "EMA Slope",
    category: "trend",
    minBars: 24,
    summary: "20 周期指数移动平均在最近 3 根 K 线上的斜率。",
    rule: "斜率除以实现波动后封顶。斜率为正做多，为负做空。接近 0 的强度在格子上显示为中性，数值仍保留。",
    citation: "Baltas and Kosowski 的趋势信号与 Carver 的波动率标准化一致：斜率先除以波动，再封顶。",
    compute: (candles) => {
      const series = ema(closes(candles), 20);
      const now = lastFinite(series);
      const prev = lastFinite(series, 3);
      if (now == null || prev == null || prev === 0) return null;
      return reading(capUnit((now - prev) / prev, barVol(candles)));
    },
  },
  {
    id: "macd",
    name: "MACD",
    abbr: "MACD",
    category: "trend",
    minBars: 40,
    summary: "MACD(12,26,9)。用快慢指数均线的差描述趋势，柱状图描述该趋势是否在加速。",
    rule: "MACD 线与柱状图都先除以价格和实现波动，再封顶。线的方向为主，柱状图占三成。二者方向冲突时强度减半。",
    citation: "Appel 的 MACD。缩放方式对齐 Carver：先做波动率标准化，再用上限代替硬阈值。",
    compute: (candles) => {
      const price = closes(candles);
      const { line, hist } = macd(price);
      const lineNow = lastFinite(line);
      const histNow = lastFinite(hist);
      const close = price[price.length - 1];
      const vol = barVol(candles);
      if (lineNow == null || histNow == null || close === 0 || vol === 0) return null;
      const lineScore = capUnit(lineNow / close, vol);
      const histScore = capUnit(histNow / close, vol * 0.5);
      let score = 0.7 * lineScore + 0.3 * histScore;
      if (Math.sign(lineNow) !== 0 && Math.sign(histNow) !== 0 && Math.sign(lineNow) !== Math.sign(histNow)) {
        score *= 0.5;
      }
      return reading(score);
    },
  },
  {
    id: "adx-dmi",
    name: "ADX/DMI",
    abbr: "ADX",
    category: "trend",
    minBars: 45,
    summary: "平均趋向指数 ADX(14) 与方向运动指标 +DI / -DI。",
    rule: "ADX 低于 18 视为没有趋势，记中性。否则 +DI 高于 -DI 做多，反之做空。强度同时取决于 ADX 高低和两条 DI 的差距。",
    compute: (candles) => {
      const value = adxLast(candles, 14);
      if (!value) return null;
      if (value.adx < 18) return NEUTRAL;
      const spread = value.plusDI - value.minusDI;
      const magnitude = Math.min(1, value.adx / 40) * Math.min(1, Math.abs(spread) / 20);
      if (magnitude < 0.12) return NEUTRAL;
      return directional(spread > 0, magnitude, 0.12);
    },
  },
  {
    id: "supertrend",
    name: "超级趋势",
    abbr: "Supertrend",
    category: "trend",
    minBars: 20,
    summary: "Supertrend，ATR(10) 乘以 3 得到的跟踪止损式趋势线。",
    rule: "收盘在趋势线之上为多头，之下为空头。离趋势线越远强度越高，并设有最低强度，避免贴线时被记成中性。",
    compute: (candles) => {
      const value = supertrend(candles, 10, 3);
      if (!value) return null;
      const close = candles[candles.length - 1].close;
      if (close === 0) return null;
      const distance = Math.abs(close - value.line) / close;
      return directional(value.long, Math.abs(squash(distance, 0.02)), 0.3);
    },
  },
  {
    id: "ichimoku",
    name: "一目均衡",
    abbr: "Ichimoku",
    category: "trend",
    minBars: 80,
    summary: "一目均衡表，参数 9 / 26 / 52。云层使用 26 根 K 线之前计算出来的先行带。",
    rule: "收盘在云上方且转换线高于基准线为多头；收盘在云下方且转换线低于基准线为空头；价格在云内或两个条件不一致时为中性。",
    compute: (candles) => {
      const end = candles.length - 1;
      const past = end - 26;
      const tenkan = midpoint(candles, end, 9);
      const kijun = midpoint(candles, end, 26);
      const spanATenkan = midpoint(candles, past, 9);
      const spanAKijun = midpoint(candles, past, 26);
      const spanB = midpoint(candles, past, 52);
      if (tenkan == null || kijun == null || spanATenkan == null || spanAKijun == null || spanB == null) return null;
      const spanA = (spanATenkan + spanAKijun) / 2;
      const top = Math.max(spanA, spanB);
      const bottom = Math.min(spanA, spanB);
      const close = candles[end].close;
      const distance = close === 0 ? 0 : Math.abs(close - (close > top ? top : bottom)) / close;
      if (close > top && tenkan > kijun) return directional(true, Math.abs(squash(distance, 0.01)), 0.35);
      if (close < bottom && tenkan < kijun) return directional(false, Math.abs(squash(distance, 0.01)), 0.35);
      return NEUTRAL;
    },
  },
  {
    id: "psar",
    name: "抛物线转向",
    abbr: "SAR",
    category: "trend",
    minBars: 10,
    summary: "抛物线 SAR，步长 0.02，加速因子上限 0.2。",
    rule: "SAR 在价格下方为多头，在价格上方为空头。价格离 SAR 越远强度越高。",
    compute: (candles) => {
      const value = psar(candles);
      if (!value) return null;
      const close = candles[candles.length - 1].close;
      if (close === 0) return null;
      return directional(value.long, Math.abs(squash(Math.abs(close - value.sar) / close, 0.02)), 0.3);
    },
  },
  {
    id: "donchian-20",
    name: "唐奇安 20",
    abbr: "Donchian20",
    category: "trend",
    minBars: 22,
    summary: "20 周期唐奇安通道突破，对应海龟交易系统的短周期入场。",
    rule: "收盘突破前 20 根（不含当根）最高价做多，跌破前 20 根最低价做空，通道内部为中性。强度看突破距离相对 ATR(14)。",
    compute: (candles) => donchian(candles, 20),
  },
  {
    id: "donchian-55",
    name: "唐奇安 55",
    abbr: "Donchian55",
    category: "trend",
    minBars: 57,
    summary: "55 周期唐奇安通道突破，对应海龟交易系统的长周期入场。",
    rule: "收盘突破前 55 根（不含当根）最高价做多，跌破前 55 根最低价做空，通道内部为中性。强度看突破距离相对 ATR(14)。",
    compute: (candles) => donchian(candles, 55),
  },
  {
    id: "aroon",
    name: "阿隆指标",
    abbr: "Aroon",
    category: "trend",
    minBars: 26,
    summary: "Aroon(25)，衡量最近一段高点与低点各出现在多久之前。",
    rule: "(Aroon Up − Aroon Down) / 100 作为分数。绝对值小于 0.2 为中性，正值做多，负值做空。",
    compute: (candles) => {
      const value = aroonLast(candles, 25);
      if (!value) return null;
      return reading((value.up - value.down) / 100, 0.2);
    },
  },
  {
    id: "linreg-slope",
    name: "回归斜率",
    abbr: "LinReg",
    category: "trend",
    minBars: 20,
    summary: "最近 20 根收盘价的普通最小二乘斜率。",
    rule: "把斜率换成这 20 根的涨跌幅，再除以实现波动的平方根时间。上涨做多，下跌做空，约 2 倍波动后封顶。",
    citation: "Moskowitz, Ooi, Pedersen (2012) 用波动率标准化收益描述趋势强度，这里用回归斜率代替简单收益。",
    compute: (candles) => {
      const price = closes(candles);
      const slope = linregSlope(price, price.length - 1, 20);
      const close = price[price.length - 1];
      const vol = barVol(candles);
      if (slope == null || close === 0) return null;
      return reading(capUnit((slope * 20) / close, vol * Math.sqrt(20)));
    },
  },
  {
    id: "hull",
    name: "赫尔均线",
    abbr: "Hull",
    category: "trend",
    minBars: 24,
    summary: "Hull 移动平均(16)，用加权均线减少滞后。",
    rule: "均线上升且收盘在其上方为多头；均线下降且收盘在其下方为空头；方向不一致时为中性。",
    compute: (candles) => {
      const series = hma(closes(candles), 16);
      const now = lastFinite(series);
      const prev = lastFinite(series, 2);
      const close = candles[candles.length - 1].close;
      if (now == null || prev == null || now === 0) return null;
      const rising = now > prev;
      const above = close > now;
      if (rising !== above) return NEUTRAL;
      return directional(above, Math.abs(squash(Math.abs(close - now) / now, 0.008)), 0.25);
    },
  },
  {
    id: "kama",
    name: "考夫曼均线",
    abbr: "KAMA",
    category: "trend",
    minBars: 16,
    summary: "Kaufman 自适应均线，效率比高时跟得更紧，震荡时更钝。参数为 ER 周期 10、快 2、慢 30。",
    rule: "收盘在 KAMA 之上且 KAMA 上升为多头；收盘在下方且 KAMA 下降为空头；其余为中性。",
    compute: (candles) => {
      const series = kama(closes(candles), 10, 2, 30);
      const now = lastFinite(series);
      const prev = lastFinite(series, 2);
      const close = candles[candles.length - 1].close;
      if (now == null || prev == null || now === 0) return null;
      const rising = now > prev;
      const above = close > now;
      if (rising !== above) return NEUTRAL;
      return directional(above, Math.abs(squash(Math.abs(close - now) / now, 0.008)), 0.25);
    },
  },
  {
    id: "roc-10",
    name: "动量 10",
    abbr: "ROC10",
    category: "momentum",
    minBars: 11,
    summary: "10 根 K 线的价格变化率，短周期时间序列动量。",
    rule: "收益除以实现波动再乘以根号回看长度。约为 2 倍波动时封顶。涨做多，跌做空。很小的强度显示为中性，但不再被抹成 0。",
    citation: "Moskowitz, Ooi, Pedersen (2012) Time Series Momentum：方向看过去收益的符号，幅度用实现波动标准化。",
    compute: (candles) => rocSignal(candles, 10),
  },
  {
    id: "roc-20",
    name: "动量 20",
    abbr: "ROC20",
    category: "momentum",
    minBars: 21,
    summary: "20 根 K 线的价格变化率，中周期时间序列动量。",
    rule: "收益除以实现波动再乘以根号回看长度。约为 2 倍波动时封顶。涨做多，跌做空。很小的强度显示为中性，但不再被抹成 0。",
    citation: "Moskowitz, Ooi, Pedersen (2012) Time Series Momentum：方向看过去收益的符号，幅度用实现波动标准化。",
    compute: (candles) => rocSignal(candles, 20),
  },
  {
    id: "roc-60",
    name: "动量 60",
    abbr: "ROC60",
    category: "momentum",
    minBars: 61,
    summary: "60 根 K 线的价格变化率，CTA 里常用的长回看时间序列动量。",
    rule: "收益除以实现波动再乘以根号回看长度。约为 2 倍波动时封顶。涨做多，跌做空。很小的强度显示为中性，但不再被抹成 0。",
    citation: "Hurst, Ooi, Pedersen (2017) A Century of Evidence on Trend-Following Investing：多个回看速度一起用。",
    compute: (candles) => rocSignal(candles, 60),
  },
  {
    id: "rsi-14",
    name: "相对强弱",
    abbr: "RSI",
    category: "momentum",
    minBars: 20,
    summary: "RSI(14)。这里按动量而不是超买超卖来使用：站上 50 视为多头动能。",
    rule: "RSI 高于 50 做多，低于 50 做空，贴近 50 为中性。RSI 75 约对应较强多头，RSI 25 约对应较强空头。",
    compute: (candles) => {
      const value = lastFinite(rsi(closes(candles), 14));
      if (value == null) return null;
      return reading(squash((value - 50) / 50, 0.45));
    },
  },
  {
    id: "stochastic",
    name: "随机指标",
    abbr: "Stoch",
    category: "momentum",
    minBars: 18,
    summary: "随机指标 %K(14) 与 %D（%K 的 3 周期均线）。",
    rule: "%K 相对 50 决定方向。%K 与 %D 方向不一致时强度降为约三分之一。靠近 50 为中性。",
    compute: (candles) => {
      const kSeries = stochasticK(candles, 14);
      const dSeries = sma(kSeries.map((value) => (Number.isFinite(value) ? value : 0)), 3);
      const k = lastFinite(kSeries);
      const d = lastFinite(dSeries);
      if (k == null || d == null) return null;
      let score = (k - 50) / 50;
      const aligned = (k >= 50 && k >= d) || (k < 50 && k <= d);
      if (!aligned) score *= 0.35;
      return reading(score);
    },
  },
  {
    id: "cci",
    name: "顺势指标",
    abbr: "CCI",
    category: "momentum",
    minBars: 20,
    summary: "商品通道指标 CCI(20)，典型价相对其均值的偏离。",
    rule: "CCI 为正做多，为负做空。约 ±100 映射到较强强度，更大的值封顶，不再把 ±50 以内直接清零。",
    compute: (candles) => {
      const value = cciLast(candles, 20);
      if (value == null) return null;
      return reading(squash(value / 100, 1));
    },
  },
  {
    id: "williams-r",
    name: "威廉指标",
    abbr: "WillR",
    category: "momentum",
    minBars: 14,
    summary: "Williams %R(14)。本看板把它放在动量类，而不是超买超卖。",
    rule: "%R 高于 -50 偏多，低于 -50 偏空，贴近 -50（约 ±8）为中性。",
    compute: (candles) => {
      const value = williamsRLast(candles, 14);
      if (value == null) return null;
      if (Math.abs(value + 50) < 8) return NEUTRAL;
      return reading((value + 50) / 50, 0.1);
    },
  },
  {
    id: "tsi",
    name: "真实强度",
    abbr: "TSI",
    category: "momentum",
    minBars: 45,
    summary: "True Strength Index(25,13)，对价格变化做两次指数平滑。",
    rule: "绝对值小于 6 为中性，否则符号就是方向。TSI 约 ±25 视为较强。",
    compute: (candles) => {
      const value = tsiLast(closes(candles), 25, 13);
      if (value == null) return null;
      if (Math.abs(value) < 6) return NEUTRAL;
      return reading(squash(value / 25, 1));
    },
  },
  {
    id: "kst",
    name: "确然指标",
    abbr: "KST",
    category: "momentum",
    minBars: 70,
    summary: "Know Sure Thing：10/15/20/30 周期变化率平滑后按 1/2/3/4 加权，信号线为 9 周期均线。",
    rule: "KST 高于信号线且 KST 本身大于 0 做多；低于信号线且 KST 小于 0 做空；其余中性。",
    compute: (candles) => {
      const value = kstLast(closes(candles));
      if (!value) return null;
      if (value.kst > value.signal && value.kst > 0) return directional(true, Math.abs(squash(value.kst / 30, 1)), 0.25);
      if (value.kst < value.signal && value.kst < 0) return directional(false, Math.abs(squash(value.kst / 30, 1)), 0.25);
      return NEUTRAL;
    },
  },
  {
    id: "bb-pctb",
    name: "布林 %B",
    abbr: "BB%B",
    category: "meanReversion",
    minBars: 20,
    summary: "布林带(20, 2) 的 %B，描述收盘在上下轨之间的位置。",
    rule: "位置高于中线反向做空，低于中线反向做多。越靠近带外强度越高，到带外后封顶。中间很小的偏离显示为中性。",
    compute: (candles) => {
      const price = closes(candles);
      const end = price.length - 1;
      const mid = lastFinite(sma(price, 20));
      const deviation = stdev(price, end, 20);
      if (mid == null || deviation == null || deviation === 0) return NEUTRAL;
      const upper = mid + 2 * deviation;
      const lower = mid - 2 * deviation;
      const pctB = (price[end] - lower) / (upper - lower);
      return bandReversion(pctB);
    },
  },
  {
    id: "zscore-20",
    name: "价格 Z 分数",
    abbr: "Z-Score",
    category: "meanReversion",
    minBars: 20,
    summary: "收盘价相对 SMA(20) 的 Z 分数，标准差使用总体标准差（除以 N）。",
    rule: "Z 为正反向做空，Z 为负反向做多。|Z| 约 2.5 封顶。靠近 0 的强度保留，格子上显示为中性。",
    compute: (candles) => {
      const price = closes(candles);
      const end = price.length - 1;
      const mid = lastFinite(sma(price, 20));
      const deviation = stdev(price, end, 20);
      if (mid == null || deviation == null || deviation === 0) return NEUTRAL;
      const z = (price[end] - mid) / deviation;
      return reading(capUnit(-z, 1.25));
    },
  },
  {
    id: "keltner",
    name: "肯特纳",
    abbr: "Keltner",
    category: "meanReversion",
    minBars: 30,
    summary: "肯特纳通道 EMA(20) ± 2×ATR(20) 上的价格位置，按均值回归解释。",
    rule: "位置高于中线反向做空，低于中线反向做多。越靠近通道外强度越高，到通道外后封顶。",
    compute: (candles) => {
      const price = closes(candles);
      const mid = lastFinite(ema(price, 20));
      const range = lastFinite(atr(candles, 20));
      if (mid == null || range == null || range === 0) return null;
      const upper = mid + 2 * range;
      const lower = mid - 2 * range;
      const close = price[price.length - 1];
      return bandReversion((close - lower) / (upper - lower));
    },
  },
  {
    id: "rsi-2",
    name: "RSI(2)",
    abbr: "RSI2",
    category: "meanReversion",
    minBars: 10,
    summary: "Connors 短周期 RSI(2)，专门捕捉极端偏离后的回归。",
    rule: "按均值回归连续打分：50 对应 0，靠近 0 封顶做多，靠近 100 封顶做空。不再用 10/90 的硬开关。",
    citation: "Larry Connors 的 RSI(2)。这里把极端阈值改成封顶，避免只在极少样本上突然翻转。",
    compute: (candles) => {
      const value = lastFinite(rsi(closes(candles), 2));
      if (value == null) return null;
      return reading((50 - value) / 50);
    },
  },
  {
    id: "atr-channel",
    name: "ATR 通道",
    abbr: "ATR Ch",
    category: "volatility",
    minBars: 30,
    summary: "EMA(20) 上下各 1.5 倍 ATR(20) 的波动突破通道。",
    rule: "收盘上破上轨做多，下破下轨做空，通道内为中性。这是突破因子，不是回归因子。",
    compute: (candles) => {
      const price = closes(candles);
      const mid = lastFinite(ema(price, 20));
      const range = lastFinite(atr(candles, 20));
      const close = price[price.length - 1];
      if (mid == null || range == null || range === 0) return null;
      const upper = mid + 1.5 * range;
      const lower = mid - 1.5 * range;
      if (close > upper) return directional(true, Math.abs(squash((close - upper) / range, 1)), 0.45);
      if (close < lower) return directional(false, Math.abs(squash((lower - close) / range, 1)), 0.45);
      return NEUTRAL;
    },
  },
  {
    id: "vol-regime",
    name: "波动状态",
    abbr: "VolReg",
    category: "volatility",
    minBars: 80,
    summary: "20 根对数收益率的实现波动，相对该波动序列自身的 50 周期均值。",
    rule: "实现波动未放大到均值的 1.05 倍以上时为中性。放大时，方向跟随最近 20 根收盘的涨跌。",
    compute: (candles) => {
      const price = closes(candles);
      const realized: number[] = [];
      for (let i = 20; i < price.length; i++) {
        const sample: number[] = [];
        for (let j = i - 19; j <= i; j++) {
          if (price[j - 1] <= 0 || price[j] <= 0) return null;
          sample.push(Math.log(price[j] / price[j - 1]));
        }
        const meanRet = sample.reduce((sum, value) => sum + value, 0) / sample.length;
        const variance = sample.reduce((sum, value) => sum + (value - meanRet) ** 2, 0) / sample.length;
        realized.push(Math.sqrt(variance));
      }
      if (realized.length < 50) return null;
      const now = realized[realized.length - 1];
      const baseline = realized.slice(-50).reduce((sum, value) => sum + value, 0) / 50;
      if (baseline === 0 || now <= baseline * 1.05) return NEUTRAL;
      const momentum = pctChange(price[price.length - 1], price[price.length - 21]);
      if (momentum == null || momentum === 0) return NEUTRAL;
      return directional(momentum > 0, Math.abs(squash(now / baseline - 1, 0.25)), 0.3);
    },
  },
  {
    id: "squeeze",
    name: "挤压方向",
    abbr: "Squeeze",
    category: "volatility",
    minBars: 40,
    summary: "类 TTM Squeeze：布林带(20,2) 是否完全落在肯特纳通道 EMA(20)±1.5×ATR(20) 里面。",
    rule: "仍在挤压中记为中性，表示方向还没释放。挤压解除后，跟随最近 12 根（收盘减 20 均线）的回归斜率。",
    compute: (candles) => {
      const price = closes(candles);
      const end = price.length - 1;
      const midSeries = sma(price, 20);
      const mid = lastFinite(midSeries);
      const deviation = stdev(price, end, 20);
      const range = lastFinite(atr(candles, 20));
      const basis = lastFinite(ema(price, 20));
      if (mid == null || deviation == null || range == null || basis == null) return null;
      const bbUpper = mid + 2 * deviation;
      const bbLower = mid - 2 * deviation;
      const kcUpper = basis + 1.5 * range;
      const kcLower = basis - 1.5 * range;
      if (bbUpper < kcUpper && bbLower > kcLower) return NEUTRAL;
      const diffs: number[] = [];
      for (let i = end - 11; i <= end; i++) {
        if (!Number.isFinite(midSeries[i])) return null;
        diffs.push(price[i] - midSeries[i]);
      }
      const slope = linregSlope(diffs, diffs.length - 1, diffs.length);
      if (slope == null || price[end] === 0) return null;
      return reading(squash(slope / price[end], 0.0008));
    },
  },
  {
    id: "obv",
    name: "能量潮",
    abbr: "OBV",
    category: "volume",
    needsVolume: true,
    minBars: 25,
    summary: "能量潮 OBV 最近 10 根的变化，用同期平均成交量做标准化。",
    rule: "OBV 上升做多，下降做空，变化很小时为中性。",
    compute: (candles) => {
      const series = obv(candles);
      const now = series[series.length - 1];
      const prev = series[series.length - 11];
      let volume = 0;
      for (let i = candles.length - 20; i < candles.length; i++) volume += candles[i].volume;
      const average = volume / 20;
      if (average === 0) return null;
      return reading(squash((now - prev) / 10 / average, 0.8));
    },
  },
  {
    id: "mfi",
    name: "资金流量",
    abbr: "MFI",
    category: "volume",
    needsVolume: true,
    minBars: 16,
    summary: "资金流量指标 MFI(14)，把典型价和成交量一起放进 RSI 式公式。",
    rule: "按动量解释：高于 50 做多，低于 50 做空，贴近 50 为中性。",
    compute: (candles) => {
      const value = mfiLast(candles, 14);
      if (value == null) return null;
      return reading(squash((value - 50) / 50, 0.45));
    },
  },
  {
    id: "cmf",
    name: "蔡金资金流",
    abbr: "CMF",
    category: "volume",
    needsVolume: true,
    minBars: 20,
    summary: "Chaikin Money Flow(20)，看收盘靠近高点还是低点，并用成交量加权。",
    rule: "正值做多，负值做空。大约 ±0.15 视为较强，接近 0 为中性。",
    compute: (candles) => {
      const value = cmfLast(candles, 20);
      if (value == null) return null;
      return reading(squash(value, 0.12));
    },
  },
  {
    id: "vwap",
    name: "滚动 VWAP",
    abbr: "VWAP",
    category: "volume",
    needsVolume: true,
    minBars: 20,
    summary: "最近 20 根 K 线的滚动 VWAP。不是分时会话 VWAP，因此日线、周线和 7×24 的加密市场也能计算。",
    rule: "收盘高于 VWAP 做多，低于做空。偏离大约 0.8% 视为较强，贴着 VWAP 为中性。",
    compute: (candles) => {
      const value = vwapLast(candles, 20);
      const close = candles[candles.length - 1].close;
      if (value == null || value === 0) return null;
      return reading(squash((close - value) / value, 0.008));
    },
  },
  {
    id: "force",
    name: "力量指数",
    abbr: "Force",
    category: "volume",
    needsVolume: true,
    minBars: 20,
    summary: "Elder 力量指数：价格变化乘以成交量，再做 13 周期指数平均。",
    rule: "用平均成交量和 ATR 标准化后，正值做多，负值做空，接近 0 为中性。",
    compute: (candles) => {
      const raw: number[] = [];
      for (let i = 1; i < candles.length; i++) {
        raw.push((candles[i].close - candles[i - 1].close) * candles[i].volume);
      }
      const smoothed = lastFinite(ema(raw, 13));
      const range = lastFinite(atr(candles, 14));
      let volume = 0;
      const start = Math.max(0, candles.length - 20);
      for (let i = start; i < candles.length; i++) volume += candles[i].volume;
      const average = volume / (candles.length - start);
      if (smoothed == null || range == null || average === 0 || range === 0) return null;
      return reading(squash(smoothed / (average * range), 1.2));
    },
  },
  {
    id: "funding",
    name: "资金费率",
    abbr: "Funding",
    category: "derivatives",
    cryptoOnly: true,
    minBars: 1,
    summary: "永续合约资金费率。正费率表示多头付给空头，通常对应多头更拥挤。",
    rule: "反向解读拥挤度：平均费率为正偏空，为负偏多。短周期至少取最近 8 小时，更长周期取约 3 倍该周期内的平均费率。绝对值极小（大约不足 0.3 个基点/8 小时的量级）记为中性。股票没有这项。",
    compute: (_candles, ctx) => {
      const points = ctx.derivatives?.funding ?? [];
      if (points.length === 0) return null;
      const lookback = Math.max(8 * 60 * 60_000, timeframeMs(ctx.timeframe) * 3);
      const end = points[points.length - 1].time;
      const sample = points.filter((point) => point.time >= end - lookback);
      const value = mean((sample.length ? sample : points.slice(-1)).map((point) => point.rate));
      if (value == null) return null;
      return reading(squash(-value, 0.0003));
    },
  },
  {
    id: "open-interest",
    name: "持仓量",
    abbr: "OI",
    category: "derivatives",
    cryptoOnly: true,
    minBars: 8,
    summary: "未平仓合约量的变化与价格变化的配合，用来区分新开仓和单纯平仓。",
    rule: "回看约 6 根当前周期。持仓上升且价格上涨为多头（新多）；持仓上升且价格下跌为空头（新空）；持仓下降视为平仓，记中性。历史长度盖不住回看窗口则为空。",
    compute: (candles, ctx) => {
      const points = ctx.derivatives?.oi ?? [];
      if (!points.length) return null;
      const lookback = timeframeMs(ctx.timeframe) * 6;
      const move = changeOver(points, lookback);
      if (!move) return null;
      if (Math.abs(move.change) < 0.005) return NEUTRAL;
      const end = candles[candles.length - 1];
      const previous = priceAtOrBefore(candles, end.time - lookback);
      const priceMove = previous == null ? null : pctChange(end.close, previous);
      if (priceMove == null || Math.abs(priceMove) < 0.001) return NEUTRAL;
      if (move.change < 0) return NEUTRAL;
      const magnitude = Math.abs(squash(move.change, 0.04)) * Math.min(1, Math.abs(priceMove) / 0.01);
      return directional(priceMove > 0, Math.max(0.2, magnitude), 0.25);
    },
  },
  {
    id: "long-short-ratio",
    name: "多空比",
    abbr: "LSR",
    category: "derivatives",
    cryptoOnly: true,
    minBars: 1,
    summary: "账户多空比（多头账户 / 空头账户）。加密市场长期略偏多，所以中性区间放得比较宽。",
    rule: "取当前周期窗口内的平均多空比。0.75 到 1.8 为中性；高于 1.8 视为多头拥挤，反向做空；低于 0.75 反向做多。",
    compute: (_candles, ctx) => {
      const points = ctx.derivatives?.lsr ?? [];
      if (!points.length) return null;
      const lookback = Math.max(timeframeMs(ctx.timeframe), 60 * 60_000);
      const end = points[points.length - 1].time;
      const sample = points.filter((point) => point.time >= end - lookback && point.ratio > 0);
      const ratio = mean((sample.length ? sample : points.slice(-1)).map((point) => point.ratio));
      if (ratio == null) return null;
      if (ratio >= 0.75 && ratio <= 1.8) return NEUTRAL;
      if (ratio > 1.8) return directional(false, Math.abs(squash(ratio - 1.8, 0.8)), 0.3);
      return directional(true, Math.abs(squash(0.75 - ratio, 0.35)), 0.3);
    },
  },
  {
    id: "basis",
    name: "期现基差",
    abbr: "Basis",
    category: "derivatives",
    cryptoOnly: true,
    minBars: 1,
    summary: "永续标记价相对现货指数的基差。正值是升水，负值是贴水。",
    rule: "基差 = (标记价 − 指数价) / 指数价。升水超过约 4 个基点视为多头拥挤而偏空，贴水超过约 4 个基点偏多。这是实时快照，每个周期用同一个数。",
    compute: (_candles, ctx) => {
      const basis = ctx.derivatives?.basis;
      if (basis == null || !Number.isFinite(basis)) return null;
      if (Math.abs(basis) < 0.0004) return NEUTRAL;
      return reading(squash(-basis, 0.0015));
    },
  },
];

function rocSignal(candles: Candle[], period: number): Reading | null {
  const price = closes(candles);
  const change = pctChange(price[price.length - 1], price[price.length - 1 - period]);
  if (change == null) return null;
  const vol = barVol(candles);
  return reading(capUnit(change, vol * Math.sqrt(period)));
}

function maGap(candles: Candle[], fastPeriod: number, slowPeriod: number): Reading | null {
  const price = closes(candles);
  const fast = lastFinite(sma(price, fastPeriod));
  const slow = lastFinite(sma(price, slowPeriod));
  if (fast == null || slow == null || slow === 0) return null;
  return reading(capUnit((fast - slow) / slow, barVol(candles)));
}

function donchian(candles: Candle[], period: number): Reading | null {
  const channel = priorChannel(candles, period);
  const range = lastFinite(atr(candles, 14));
  if (!channel || range == null || range === 0) return null;
  const close = candles[candles.length - 1].close;
  if (close > channel.high) return directional(true, Math.abs(squash((close - channel.high) / range, 0.6)), 0.55);
  if (close < channel.low) return directional(false, Math.abs(squash((channel.low - close) / range, 0.6)), 0.55);
  return NEUTRAL;
}

function bandReversion(position: number): Reading | null {
  if (!Number.isFinite(position)) return null;
  return reading(capUnit(0.5 - position, 0.25));
}

function changeOver(points: DerivPoint[], lookbackMs: number): { change: number } | null {
  if (points.length < 2) return null;
  const ordered = [...points].sort((a, b) => a.time - b.time);
  const end = ordered[ordered.length - 1];
  const target = end.time - lookbackMs;
  let previous: DerivPoint | null = null;
  for (const point of ordered) {
    if (point.time <= target) previous = point;
  }
  if (!previous) {
    if (ordered[0].time > end.time - lookbackMs * 0.5) return null;
    previous = ordered[0];
  }
  if (previous.value === 0 || previous.time === end.time) return null;
  return { change: end.value / previous.value - 1 };
}

FACTORS.push(...LITERATURE_FACTORS);

export function factorsFor(market: "crypto" | "stock"): Factor[] {
  return market === "crypto" ? FACTORS : FACTORS.filter((factor) => !factor.cryptoOnly);
}
