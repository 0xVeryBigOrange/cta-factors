import type { Candle, Reading } from "../types";
import { timeframeMs } from "../types";
import type { Factor, FactorContext } from "./catalog";
import {
  barVol,
  ema,
  ewmAbsChange,
  ewmStdChange,
  lastFinite,
  logPriceTStat,
  pearson,
  realizedVol,
  returnMoments,
} from "./indicators";
import { capUnit, carverForecast, reading } from "./score";

function closes(candles: Candle[]): number[] {
  return candles.map((candle) => candle.close);
}

function pct(now: number, then: number): number | null {
  if (!Number.isFinite(now) || !Number.isFinite(then) || then === 0) return null;
  return now / then - 1;
}

/** Carver EWMAC scalars that put an average absolute forecast near 10 before the ±20 cap. */
const EWMAC_SCALAR: Record<number, number> = { 8: 5.3, 16: 3.75, 32: 2.65 };

function ewmac(candles: Candle[], fast: number): Reading | null {
  const price = closes(candles);
  const slow = fast * 4;
  const fastLine = lastFinite(ema(price, fast));
  const slowLine = lastFinite(ema(price, slow));
  const vol = ewmStdChange(price, 32);
  const scalar = EWMAC_SCALAR[fast];
  if (fastLine == null || slowLine == null || vol == null || scalar == null) return null;
  return reading(carverForecast((fastLine - slowLine) / vol, scalar), 0.05);
}

function tsmom(candles: Candle[], horizon: number): Reading | null {
  const price = closes(candles);
  const last = price.length - 1;
  if (last < horizon || price[last - horizon] <= 0) return null;
  const change = price[last] / price[last - horizon] - 1;
  const vol = Math.max(realizedVol(price, Math.min(64, last)) ?? 0, barVol(candles));
  return reading(capUnit(change, vol * Math.sqrt(horizon)), 0.05);
}

function signedReturn(candles: Candle[], lookback: number): number | null {
  const price = closes(candles);
  const last = price.length - 1;
  if (last < lookback) return null;
  return pct(price[last], price[last - lookback]);
}

export const LITERATURE_FACTORS: Factor[] = [
  {
    id: "ewmac-8-32",
    name: "EWMAC 8/32",
    abbr: "EW8/32",
    category: "trend",
    minBars: 40,
    summary: "8 与 32 周期指数均线之差，先除以价格变化的波动，再缩放到预测值。",
    rule: "快线高于慢线为多。预测值以绝对强度约 10 为常态、±20 为上限，界面把 ±20 映射成 ±1。很小的差保留，不设硬开关。",
    citation: "Carver《Systematic Trading》EWMAC；预测值常态约 10、上限 ±20。",
    compute: (candles) => ewmac(candles, 8),
  },
  {
    id: "ewmac-16-64",
    name: "EWMAC 16/64",
    abbr: "EW16/64",
    category: "trend",
    minBars: 80,
    summary: "16 与 64 周期指数均线之差，先除以价格变化的波动，再缩放到预测值。",
    rule: "快线高于慢线为多。预测值以绝对强度约 10 为常态、±20 为上限，界面把 ±20 映射成 ±1。跨度按当前周期的 K 线根数。",
    citation: "Carver《Systematic Trading》EWMAC；预测值常态约 10、上限 ±20。",
    compute: (candles) => ewmac(candles, 16),
  },
  {
    id: "ewmac-32-128",
    name: "EWMAC 32/128",
    abbr: "EW32/128",
    category: "trend",
    minBars: 150,
    summary: "32 与 128 周期指数均线之差，先除以价格变化的波动，再缩放到预测值。",
    rule: "快线高于慢线为多。预测值以绝对强度约 10 为常态、±20 为上限，界面把 ±20 映射成 ±1。样本不够时留空。",
    citation: "Carver《Systematic Trading》EWMAC；预测值常态约 10、上限 ±20。",
    compute: (candles) => ewmac(candles, 32),
  },
  {
    id: "tsmom-120",
    name: "时序动量 120",
    abbr: "TSMOM120",
    category: "momentum",
    minBars: 128,
    summary: "过去 120 根收益除以波动率，对应 Moskowitz、Ooi 与 Pedersen 的时序动量。",
    rule: "收益为正做多，为负做空。强度是这段收益相对实现波动的倍数，大约 2 倍波动后封顶。",
    citation: "Moskowitz, Ooi, Pedersen (2012) Time Series Momentum, Journal of Financial Economics.",
    compute: (candles) => tsmom(candles, 120),
  },
  {
    id: "tsmom-250",
    name: "时序动量 250",
    abbr: "TSMOM250",
    category: "momentum",
    minBars: 260,
    summary: "过去 250 根收益的波动率标准化动量，接近论文里的 12 个月回看。",
    rule: "收益为正做多，为负做空。强度是这段收益相对实现波动的倍数，大约 2 倍波动后封顶。根数不够则留空。",
    citation: "Hurst, Ooi, Pedersen (2017) A Century of Evidence on Trend-Following Investing.",
    compute: (candles) => tsmom(candles, 250),
  },
  {
    id: "trend-tstat",
    name: "趋势 t 值",
    abbr: "TrendT",
    category: "trend",
    minBars: 50,
    summary: "最近 50 根对数价格对时间回归的斜率 t 统计量。",
    rule: "t 值为正做多，为负做空。|t| 达到 3 时强度封顶在 ±1，更小的 t 值按比例保留。",
    citation: "Moskowitz, Ooi, Pedersen (2012) 用波动率标准化收益检验趋势；这里用对数价格回归的 t 值。",
    compute: (candles) => {
      const stat = logPriceTStat(closes(candles), candles.length - 1, 50);
      if (stat == null) return null;
      return reading(capUnit(stat, 1.5), 0.05);
    },
  },
  {
    id: "cfm-trend",
    name: "CFM 趋势",
    abbr: "CFM",
    category: "trend",
    minBars: 70,
    summary: "价格相对指数均线的偏离，再除以绝对价格变化的指数平均。",
    rule: "信号为正做多，为负做空。偏离大约达到 2 倍波动后封顶。跨度是 64 根当前周期 K 线，不是日历上的 5 个月。",
    citation: "Lempérière, Deremble, Seager, Potters, Bouchaud (2014) Two Centuries of Trend Following.",
    compute: (candles) => {
      const price = closes(candles);
      const average = lastFinite(ema(price, 64), 1);
      const sigma = ewmAbsChange(price, 64);
      const previous = price[price.length - 2];
      if (average == null || sigma == null || previous == null) return null;
      return reading(capUnit((previous - average) / sigma, 1), 0.05);
    },
  },
  {
    id: "realized-skew",
    name: "已实现偏度",
    abbr: "Skew",
    category: "volatility",
    minBars: 40,
    summary: "最近 60 根对数收益的偏度。期货研究里高偏度对应更高的后续收益。",
    rule: "偏度为正做多，为负做空。偏度大约 1.5 时接近封顶。股票文献里偏度常常反向，这里用期货 CTA 的方向。",
    citation: "海通证券 (2018-11-01)《高频量价因子在股票与期货中的表现》：期货端高频偏度越大，未来收益越高。",
    compute: (candles) => {
      const moments = returnMoments(closes(candles), 60);
      if (!moments) return null;
      return reading(capUnit(moments.skew, 0.75), 0.05);
    },
  },
  {
    id: "upside-vol",
    name: "上行波动占比",
    abbr: "UpVol",
    category: "volatility",
    minBars: 40,
    summary: "正收益平方和占全部收益平方和的比例，描述上涨波动是否主导。",
    rule: "占比高于一半做多，低于一半做空。全部由上涨波动贡献时强度为 +1，全部由下跌波动贡献时为 -1。",
    citation: "海通证券 (2018)《高频量价因子在股票与期货中的表现》，期货端上行波动占比越高越偏多。",
    compute: (candles) => {
      const moments = returnMoments(closes(candles), 60);
      if (!moments) return null;
      return reading(Math.max(-1, Math.min(1, (moments.upside - 0.5) * 2)), 0.05);
    },
  },
  {
    id: "kurtosis-tilt",
    name: "峰度倾斜",
    abbr: "Kurt",
    category: "volatility",
    minBars: 40,
    summary: "收益分布的超额峰度不单独决定方向，肥尾时放大同期偏度的方向。",
    rule: "超额峰度不高时接近中性。肥尾且偏度为正做多，肥尾且偏度为负做空。峰度大约比正态高出 3 以后不再继续放大。",
    citation: "海通证券 (2018) 将已实现峰度与偏度同列为收益分布因子；峰度本身无方向，这里只用它放大偏度。",
    compute: (candles) => {
      const moments = returnMoments(closes(candles), 60);
      if (!moments) return null;
      const gate = Math.max(0, Math.min(1, (moments.excessKurt - 0.5) / 3));
      const tilt = Math.max(-1, Math.min(1, moments.skew / 1.5));
      return reading(gate * tilt, 0.05);
    },
  },
  {
    id: "pv-corr",
    name: "价量相关",
    abbr: "PVCorr",
    category: "volume",
    needsVolume: true,
    minBars: 32,
    summary: "最近 30 根价格变化与成交量变化的相关系数，用来确认价格方向。",
    rule: "相关系数为正时跟随这段价格方向，为负时视为量价背离并反向。强度等于相关系数，并带上确认后的符号。",
    citation: "海通证券 (2018) 与东吴金工 CPV：期货量价相关性高的品种未来收益更高。这里改成单品种的时序确认。",
    compute: (candles) => {
      const lookback = 30;
      const start = candles.length - lookback;
      if (start < 1) return null;
      const priceDelta: number[] = [];
      const volumeDelta: number[] = [];
      for (let i = start; i < candles.length; i++) {
        priceDelta.push(candles[i].close - candles[i - 1].close);
        volumeDelta.push(candles[i].volume - candles[i - 1].volume);
      }
      const corr = pearson(priceDelta, volumeDelta);
      const move = signedReturn(candles, lookback);
      if (corr == null || move == null || move === 0) return null;
      return reading(corr * Math.sign(move), 0.05);
    },
  },
  {
    id: "volume-mom",
    name: "成交量动量",
    abbr: "VolMom",
    category: "volume",
    needsVolume: true,
    minBars: 24,
    summary: "短均量相对长均量是否放大，再与价格方向相乘。",
    rule: "放量上涨做多，放量下跌做空。缩量时强度下降。放量大约 40% 视为较强，再大就封顶。",
    citation: "海通证券《商品期货因子挖掘与组合构建再探究》里的量价与成交活跃度；价涨量增视为多头确认。",
    compute: (candles) => {
      let short = 0;
      let long = 0;
      for (let i = candles.length - 20; i < candles.length; i++) long += candles[i].volume;
      for (let i = candles.length - 5; i < candles.length; i++) short += candles[i].volume;
      const longAvg = long / 20;
      const shortAvg = short / 5;
      const move = signedReturn(candles, 10);
      if (longAvg === 0 || move == null || move === 0) return null;
      const expansion = Math.max(0, capUnit((shortAvg - longAvg) / longAvg, 0.4));
      return reading(expansion * Math.sign(move), 0.05);
    },
  },
  {
    id: "efficiency",
    name: "效率比",
    abbr: "ER",
    category: "trend",
    minBars: 21,
    summary: "Kaufman 效率比：净位移除以路径长度，衡量这段走势有多直。",
    rule: "方向跟随净位移。效率比本身在 0 到 1 之间，直接作为强度。直线上涨接近 +1，来回震荡接近 0。",
    citation: "Perry Kaufman 效率比，见 Trading Systems and Methods。KAMA 用它调节速度，这里直接当成趋势质量。",
    compute: (candles) => {
      const period = 20;
      const end = candles.length - 1;
      const start = end - period;
      let path = 0;
      for (let i = start + 1; i <= end; i++) path += Math.abs(candles[i].close - candles[i - 1].close);
      if (path === 0) return null;
      const net = candles[end].close - candles[start].close;
      return reading(net / path, 0.05);
    },
  },
  {
    id: "residual-mom",
    name: "残差动量",
    abbr: "ResMom",
    category: "momentum",
    minBars: 90,
    summary: "20 根收益减去按时间比例缩放的 80 根收益，再除以波动。",
    rule: "残差为正做多，为负做空。大约 2 倍波动后封顶。没有市场因子，所以用更长的自身收益代替回归残差。",
    citation: "Blitz, Huij, Martens (2011) Residual Momentum 的单序列改编。",
    compute: (candles) => {
      const short = signedReturn(candles, 20);
      const long = signedReturn(candles, 80);
      if (short == null || long == null) return null;
      const residual = short - long * (20 / 80);
      const vol = barVol(candles);
      return reading(capUnit(residual, vol * Math.sqrt(20)), 0.05);
    },
  },
  {
    id: "xs-mom",
    name: "横截面动量",
    abbr: "XSMom",
    category: "momentum",
    minBars: 21,
    summary: "在同一市场的自选池里，按 20 根与 60 根收益排名。至少需要 4 个代码。",
    rule: "收益最高为 +1，最低为 -1，中间线性插值。两个回看都有数据时取平均。这是相对强弱，不是自己涨了多少。",
    citation: "Asness, Moskowitz, Pedersen (2013) Value and Momentum Everywhere。价值需要基本面，这里只做动量排名。",
    compute: (_candles, ctx) => crossSection(ctx),
  },
  {
    id: "funding-mom",
    name: "资金费动量",
    abbr: "FundMom",
    category: "derivatives",
    cryptoOnly: true,
    minBars: 1,
    summary: "最近一段资金费率相对再往前一段的变化，当作加密永续的动态 carry。",
    rule: "资金费率上升表示做多成本变贵，偏空；下降偏多。变化大约 1.5 个基点时接近封顶。历史太短则留空。",
    citation: "Koijen, Moskowitz, Pedersen, Vrugt (2018) Carry 的动态部分；Boons and Prado (2019) Basis-Momentum 用资金费率变化近似。",
    compute: (_candles, ctx) => {
      const points = ctx.derivatives?.funding ?? [];
      if (points.length < 4) return null;
      const span = Math.max(timeframeMs(ctx.timeframe) * 6, 24 * 60 * 60_000);
      const end = points[points.length - 1].time;
      const recent = points.filter((point) => point.time >= end - span);
      const prior = points.filter((point) => point.time < end - span && point.time >= end - span * 2);
      if (recent.length < 2 || prior.length < 2) return null;
      const recentMean = recent.reduce((sum, point) => sum + point.rate, 0) / recent.length;
      const priorMean = prior.reduce((sum, point) => sum + point.rate, 0) / prior.length;
      return reading(capUnit(-(recentMean - priorMean), 0.00015), 0.05);
    },
  },
  {
    id: "oi-mom",
    name: "持仓量动量",
    abbr: "OIMom",
    category: "derivatives",
    cryptoOnly: true,
    minBars: 8,
    summary: "持仓量变化配上同期价格方向。仓增价涨是新多，仓增价跌是新空。",
    rule: "持仓上升时方向跟随价格。持仓下降时仍跟随价格，但强度减半，表示更多是平仓而不是新趋势。大约 8% 的持仓变化接近封顶。",
    citation: "华泰期货 (2025)《成交-持仓-价格三维视角下的期价走势影响研究》：价涨仓增偏多头建仓，价跌仓增偏空头建仓。",
    compute: (candles, ctx) => oiMomentum(candles, ctx),
  },
];

function crossSection(ctx: FactorContext): Reading | null {
  const peers = (ctx.peers ?? []).filter((peer) => peer.ret20 != null || peer.ret60 != null);
  if (peers.length < 4) return null;
  const ranks: number[] = [];
  for (const horizon of [20, 60] as const) {
    const rows = peers
      .map((peer) => (horizon === 20 ? peer.ret20 : peer.ret60))
      .filter((value): value is number => value != null)
      .sort((a, b) => a - b);
    const self = peers.find((peer) => peer.symbol === ctx.symbol);
    const value = horizon === 20 ? self?.ret20 : self?.ret60;
    if (value == null || rows.length < 4) continue;
    let index = rows.findIndex((item) => item >= value);
    if (index < 0) index = rows.length - 1;
    ranks.push(rows.length === 1 ? 0 : (index / (rows.length - 1)) * 2 - 1);
  }
  if (!ranks.length) return null;
  const score = ranks.reduce((sum, value) => sum + value, 0) / ranks.length;
  return reading(score, 0.05);
}

function oiMomentum(candles: Candle[], ctx: FactorContext): Reading | null {
  const points = ctx.derivatives?.oi ?? [];
  if (points.length < 2 || candles.length < 2) return null;
  const lookback = timeframeMs(ctx.timeframe) * 12;
  const end = points[points.length - 1];
  let previous = points[0];
  for (const point of points) {
    if (point.time <= end.time - lookback) previous = point;
  }
  if (previous.time === end.time || previous.value === 0) return null;
  if (end.time - previous.time < lookback * 0.5) return null;
  const oiChange = end.value / previous.value - 1;
  const priceThen = candles.find((candle) => candle.time >= end.time - lookback)?.close ?? candles[0].close;
  const priceNow = candles[candles.length - 1].close;
  if (!priceThen) return null;
  const priceChange = priceNow / priceThen - 1;
  if (priceChange === 0) return null;
  const magnitude = Math.min(1, Math.abs(capUnit(oiChange, 0.04)));
  const signed = Math.sign(priceChange) * magnitude * (oiChange < 0 ? 0.5 : 1);
  return reading(signed, 0.05);
}
