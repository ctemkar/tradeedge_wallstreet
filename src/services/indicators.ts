/**
 * TradeEdge Indicators Engine
 * Technical indicators computed locally for market scanner and backtesting
 */

export interface MACDResult {
  macd: number[];
  signal: number[];
  histogram: number[];
}

/**
 * Calculates Simple Moving Average (SMA)
 */
export function calculateSMA(prices: number[], period: number): number[] {
  const sma: number[] = [];
  if (prices.length === 0) return [];
  
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      // Not enough data yet, calculate partial average
      const sum = prices.slice(0, i + 1).reduce((a, b) => a + b, 0);
      sma.push(sum / (i + 1));
    } else {
      const sum = prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      sma.push(sum / period);
    }
  }
  return sma;
}

/**
 * Calculates Exponential Moving Average (EMA)
 */
export function calculateEMA(prices: number[], period: number): number[] {
  if (prices.length === 0) return [];
  const k = 2 / (period + 1);
  const ema: number[] = [];
  
  // Initialize first value with SMA
  let currentEMA = prices[0];
  const initialSumCount = Math.min(period, prices.length);
  const initialSum = prices.slice(0, initialSumCount).reduce((a, b) => a + b, 0);
  currentEMA = initialSum / initialSumCount;
  ema.push(currentEMA);
  
  for (let i = 1; i < prices.length; i++) {
    currentEMA = prices[i] * k + currentEMA * (1 - k);
    ema.push(currentEMA);
  }
  return ema;
}

/**
 * Calculates MACD (Moving Average Convergence Divergence)
 */
export function calculateMACD(
  prices: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): MACDResult {
  const fastEMA = calculateEMA(prices, fastPeriod);
  const slowEMA = calculateEMA(prices, slowPeriod);
  
  const macd: number[] = [];
  const length = prices.length;
  for (let i = 0; i < length; i++) {
    macd.push((fastEMA[i] || 0) - (slowEMA[i] || 0));
  }
  
  const signal = calculateEMA(macd, signalPeriod);
  const histogram: number[] = [];
  for (let i = 0; i < length; i++) {
    histogram.push(macd[i] - (signal[i] || 0));
  }
  
  return { macd, signal, histogram };
}

/**
 * Calculates Relative Strength Index (RSI)
 */
export function calculateRSI(prices: number[], period = 14): number[] {
  const rsi: number[] = [];
  if (prices.length === 0) return [];
  if (prices.length < period) return Array(prices.length).fill(50);
  
  const gains: number[] = [];
  const losses: number[] = [];
  
  for (let i = 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }
  
  // Initial average gains and losses
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  // Pre-fill initial index points with 50
  for (let i = 0; i <= period; i++) {
    rsi.push(50);
  }
  
  for (let i = period + 1; i < prices.length; i++) {
    const gain = gains[i - 1];
    const loss = losses[i - 1];
    
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    
    if (avgLoss === 0) {
      rsi.push(100);
    } else {
      const rs = avgGain / avgLoss;
      rsi.push(100 - 100 / (1 + rs));
    }
  }
  
  // Align lengths
  while (rsi.length < prices.length) {
    rsi.push(50);
  }
  
  return rsi.slice(0, prices.length);
}

/**
 * Identifies local Support & Resistance levels based on pivot points
 */
export function identifySupportResistance(
  highs: number[],
  lows: number[],
  window = 10
): { support: number; resistance: number } {
  if (highs.length < window * 2 || lows.length < window * 2) {
    return {
      support: lows[lows.length - 1] || 0,
      resistance: highs[highs.length - 1] || 0,
    };
  }

  // Look back at the last 50 candles to find pivots
  const lookback = Math.min(60, highs.length);
  const startIdx = highs.length - lookback;
  
  const pivotHighs: number[] = [];
  const pivotLows: number[] = [];
  
  for (let i = startIdx + window; i < highs.length - window; i++) {
    let isHigh = true;
    let isLow = true;
    
    for (let w = -window; w <= window; w++) {
      if (w === 0) continue;
      if (highs[i] < highs[i + w]) isHigh = false;
      if (lows[i] > lows[i + w]) isLow = false;
    }
    
    if (isHigh) pivotHighs.push(highs[i]);
    if (isLow) pivotLows.push(lows[i]);
  }
  
  const currentPrice = (highs[highs.length - 1] + lows[lows.length - 1]) / 2;
  
  // Find closest pivot high above current price (Resistance)
  const resistUps = pivotHighs.filter(h => h > currentPrice);
  const resistance = resistUps.length > 0
    ? resistUps.reduce((closest, pr) => Math.abs(pr - currentPrice) < Math.abs(closest - currentPrice) ? pr : closest, resistUps[0])
    : Math.max(...highs.slice(highs.length - window));
    
  // Find closest pivot low below current price (Support)
  const supportDowns = pivotLows.filter(l => l < currentPrice);
  const support = supportDowns.length > 0
    ? supportDowns.reduce((closest, ps) => Math.abs(ps - currentPrice) < Math.abs(closest - currentPrice) ? ps : closest, supportDowns[0])
    : Math.min(...lows.slice(lows.length - window));

  return { support, resistance };
}

/**
 * Interface representing computed strategy metrics for a coin
 */
export interface StrategyMetrics {
  symbol: string;
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  quoteVolume: number;
  macd: { macd: number; signal: number; hist: number };
  rsi: number;
  ema50: number;
  ema200: number;
  support: number;
  resistance: number;
  direction: 'BUY' | 'SELL' | 'HOLD';
  score: number; // -100 to 100 rating strength
  strengthReasons: string[];
  blockReasons: string[];
  deferReasons: string[];
}

/**
 * Analyses price history and generates detailed trading signals & scores
 */
export function analyzeAsset(
  symbol: string,
  prices: { open: number[]; high: number[]; low: number[]; close: number[]; volume: number[] },
  tickerInfo: { volume24h: number; quoteVolume24h: number; priceChangePercent: number },
  config = {
    minVolume: 10000000, // $10M Default
    rsiOverbought: 70,
    rsiOversold: 30,
    macdFast: 12,
    macdSlow: 26,
    macdSignal: 9,
    emaFast: 50,
    emaSlow: 200,
  }
): StrategyMetrics {
  const closes = prices.close;
  const len = closes.length;
  const currentPrice = closes[len - 1];
  const lastIndex = len - 1;
  
  const macdResult = calculateMACD(closes, config.macdFast, config.macdSlow, config.macdSignal);
  const rsiResult = calculateRSI(closes, 14);
  const ema50Result = calculateEMA(closes, config.emaFast);
  const ema200Result = calculateEMA(closes, config.emaSlow);
  const supRes = identifySupportResistance(prices.high, prices.low, 10);

  const curMacd = macdResult.macd[lastIndex] || 0;
  const curSignal = macdResult.signal[lastIndex] || 0;
  const curHist = macdResult.histogram[lastIndex] || 0;
  const curRsi = rsiResult[lastIndex] || 50;
  const curEma50 = ema50Result[lastIndex] || currentPrice;
  const curEma200 = ema200Result[lastIndex] || currentPrice;

  const prevMacd2 = macdResult.macd[lastIndex - 2] || 0;
  const prevMacd = macdResult.macd[lastIndex - 1] || 0;
  const prevSignal2 = macdResult.signal[lastIndex - 2] || 0;
  const prevSignal = macdResult.signal[lastIndex - 1] || 0;
  const prevHist2 = macdResult.histogram[lastIndex - 2] || 0;
  const prevHist = macdResult.histogram[lastIndex - 1] || 0;
  
  const strengthReasons: string[] = [];
  const blockReasons: string[] = [];
  const deferReasons: string[] = [];

  // 1. Check basic limits (exclusions)
  if (tickerInfo.quoteVolume24h < config.minVolume) {
    blockReasons.push(`Insufficient 24h Volume: ₹${(tickerInfo.quoteVolume24h / 1e5).toFixed(1)} Lakhs / Required ₹${(config.minVolume / 1e5).toFixed(1)} Lakhs`);
  }
  if (len < 100) {
    blockReasons.push(`Insufficient price history (${len}/100 candles)`);
  }

  // Technical checks
  let score = 0;
  let direction: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';

  if (blockReasons.length === 0) {
    // Trend alignment remains a filter, but MACD is now the actual trade trigger.
    const isUptrend = currentPrice > curEma50 && curEma50 > curEma200;
    const isDowntrend = currentPrice < curEma50 && curEma50 < curEma200;
    const bullishCrossThisBar = prevMacd <= prevSignal && curMacd > curSignal;
    const bearishCrossThisBar = prevMacd >= prevSignal && curMacd < curSignal;
    const bullishCrossLastBar = prevMacd2 <= prevSignal2 && prevMacd > prevSignal && curMacd > curSignal;
    const bearishCrossLastBar = prevMacd2 >= prevSignal2 && prevMacd < prevSignal && curMacd < curSignal;
    const freshBullishCross = bullishCrossThisBar || bullishCrossLastBar;
    const freshBearishCross = bearishCrossThisBar || bearishCrossLastBar;
    const histAcceleratingUp = curHist > prevHist && prevHist >= prevHist2;
    const histAcceleratingDown = curHist < prevHist && prevHist <= prevHist2;
    const macdAboveZero = curMacd >= 0;
    const macdBelowZero = curMacd <= 0;

    // Support / Resistance distance
    const distToSupport = Math.max(0, currentPrice - supRes.support);
    const distToResistance = Math.max(0, supRes.resistance - currentPrice);
    
    // Risk/Reward structure
    const rrRatio = distToResistance / (distToSupport || 0.0001);
    const shortRrRatio = distToSupport / (distToResistance || 0.0001);
    const buyRsiWindowOk = curRsi >= 45 && curRsi <= 68;
    const sellRsiWindowOk = curRsi >= 32 && curRsi <= 55;

    const bullishStructureReady = curMacd > curSignal && curHist > 0 && histAcceleratingUp;
    const bearishStructureReady = curMacd < curSignal && curHist < 0 && histAcceleratingDown;

    if (freshBullishCross) {
      strengthReasons.push('Fresh bullish MACD crossover');
      score += 55;
      if (bullishCrossThisBar) score += 10;
    } else if (bullishStructureReady) {
      deferReasons.push('Bullish MACD structure detected, but crossover is stale');
      score += 20;
    }

    if (freshBearishCross) {
      strengthReasons.push('Fresh bearish MACD crossover');
      score -= 55;
      if (bearishCrossThisBar) score -= 10;
    } else if (bearishStructureReady) {
      deferReasons.push('Bearish MACD structure detected, but crossover is stale');
      score -= 20;
    }

    if (freshBullishCross || bullishStructureReady) {
      if (!isUptrend) {
        deferReasons.push('Bullish MACD trigger rejected: trend regime is not aligned (Price > EMA50 > EMA200 required)');
      } else {
        strengthReasons.push('Trend filter aligned for long setup');
        score += 10;
      }

      if (!macdAboveZero) {
        deferReasons.push('Bullish MACD trigger rejected: MACD remains below zero line');
      } else {
        strengthReasons.push('MACD above zero line');
        score += 5;
      }

      if (!histAcceleratingUp) {
        deferReasons.push('Bullish MACD trigger rejected: histogram is not accelerating upward');
      } else {
        strengthReasons.push('Histogram accelerating upward');
        score += 10;
      }

      if (!buyRsiWindowOk) {
        deferReasons.push(`Bullish MACD trigger rejected: RSI ${curRsi.toFixed(1)} is outside the 45-68 entry window`);
      } else {
        strengthReasons.push('RSI in long-entry acceptance window');
        score += 5;
      }

      if (rrRatio < 1.5) {
        deferReasons.push(`Bullish MACD trigger rejected: risk/reward ${rrRatio.toFixed(2)}x is below 1.50x minimum`);
      } else {
        strengthReasons.push(`Long risk/reward acceptable at ${rrRatio.toFixed(2)}x`);
        score += 5;
      }
    }

    if (freshBearishCross || bearishStructureReady) {
      if (!isDowntrend) {
        deferReasons.push('Bearish MACD trigger rejected: trend regime is not aligned (Price < EMA50 < EMA200 required)');
      } else {
        strengthReasons.push('Trend filter aligned for short setup');
        score -= 10;
      }

      if (!macdBelowZero) {
        deferReasons.push('Bearish MACD trigger rejected: MACD remains above zero line');
      } else {
        strengthReasons.push('MACD below zero line');
        score -= 5;
      }

      if (!histAcceleratingDown) {
        deferReasons.push('Bearish MACD trigger rejected: histogram is not accelerating downward');
      } else {
        strengthReasons.push('Histogram accelerating downward');
        score -= 10;
      }

      if (!sellRsiWindowOk) {
        deferReasons.push(`Bearish MACD trigger rejected: RSI ${curRsi.toFixed(1)} is outside the 32-55 entry window`);
      } else {
        strengthReasons.push('RSI in short-entry acceptance window');
        score -= 5;
      }

      if (shortRrRatio < 1.5) {
        deferReasons.push(`Bearish MACD trigger rejected: short risk/reward ${shortRrRatio.toFixed(2)}x is below 1.50x minimum`);
      } else {
        strengthReasons.push(`Short risk/reward acceptable at ${shortRrRatio.toFixed(2)}x`);
        score -= 5;
      }
    }

    const hasFreshMacdEntry = freshBullishCross || freshBearishCross;

    // Decide Direction: only fresh MACD crosses may open positions.
    if (hasFreshMacdEntry && score >= 75 && deferReasons.length === 0) {
      direction = 'BUY';
    } else if (hasFreshMacdEntry && score <= -75 && deferReasons.length === 0) {
      direction = 'SELL';
    } else {
      direction = 'HOLD';
      if (deferReasons.length === 0) {
        deferReasons.push('No fresh MACD crossover with qualifying confirmation filters');
      }
    }
  }

  return {
    symbol,
    price: currentPrice,
    open: prices.open[lastIndex] || currentPrice,
    high: prices.high[lastIndex] || currentPrice,
    low: prices.low[lastIndex] || currentPrice,
    volume: prices.volume[lastIndex] || 0,
    quoteVolume: tickerInfo.quoteVolume24h,
    macd: { macd: curMacd, signal: curSignal, hist: curHist },
    rsi: curRsi,
    ema50: curEma50,
    ema200: curEma200,
    support: supRes.support,
    resistance: supRes.resistance,
    direction,
    score: Math.round(score),
    strengthReasons,
    blockReasons,
    deferReasons,
  };
}
