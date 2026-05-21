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
    // Trend alignment
    const isUptrend = currentPrice > curEma50 && curEma50 > curEma200;
    const isDowntrend = currentPrice < curEma50 && curEma50 < curEma200;
    
    // MACD triggers
    const macdCrossoverUp = curHist > 0 && prevHist <= 0;
    const macdCrossoverDown = curHist < 0 && prevHist >= 0;
    const macdRising = curHist > prevHist;
    const macdFalling = curHist < prevHist;

    // RSI triggers
    const rsiOversold = curRsi <= config.rsiOversold;
    const rsiOverbought = curRsi >= config.rsiOverbought;

    // Support / Resistance distance
    const distToSupport = Math.max(0, currentPrice - supRes.support);
    const distToResistance = Math.max(0, supRes.resistance - currentPrice);
    const totalDist = distToSupport + distToResistance;
    
    // Risk/Reward structure
    const rrRatio = distToResistance / (distToSupport || 0.0001);

    // Scoring calculation
    // Base score for MACD alignment
    if (curHist > 0) {
      score += 20;
      if (macdRising) score += 10;
      strengthReasons.push('Positive MACD momentum');
    } else {
      score -= 20;
      if (macdFalling) score -= 10;
      strengthReasons.push('Negative MACD momentum');
    }

    if (macdCrossoverUp) {
      score += 25;
      strengthReasons.push('Bullish MACD crossover (recent)');
    } else if (macdCrossoverDown) {
      score -= 25;
      strengthReasons.push('Bearish MACD crossover (recent)');
    }

    // Trend weight
    if (isUptrend) {
      score += 25;
      strengthReasons.push('Long-term bullish trend regime (Price > EMA50 > EMA200)');
    } else if (isDowntrend) {
      score -= 25;
      strengthReasons.push('Long-term bearish trend regime (Price < EMA50 < EMA200)');
    } else {
      // Choppy range
      score *= 0.5; // slash score in non-trend regime
      deferReasons.push('Choppy trend regime (EMA50/EMA200 alignment weak)');
    }

    // RSI constraints
    if (rsiOversold) {
      score += 15;
      strengthReasons.push('RSI oversold (potential reversal)');
    } else if (rsiOverbought) {
      score -= 15;
      strengthReasons.push('RSI overbought (potential reversal)');
    }

    // Protect against overbought buys or oversold shorts
    if (curRsi > 68) {
      if (score > 30) {
        deferReasons.push(`Late MACD entry (RSI is high: ${curRsi.toFixed(1)})`);
        score *= 0.3; // penalize chasing
      }
    }
    if (curRsi < 32) {
      if (score < -30) {
        deferReasons.push(`Late MACD Short-entry (RSI is low: ${curRsi.toFixed(1)})`);
        score *= 0.3; // penalize chasing
      }
    }

    // Risk reward limit
    if (score > 30 && rrRatio < 1.1) {
      deferReasons.push(`Poor Risk/Reward Ratio: ${rrRatio.toFixed(2)}x (Target lies too close to resistance)`);
      score *= 0.5;
    } else if (score < -30 && (1 / rrRatio) < 1.1) {
      deferReasons.push(`Poor Risk/Reward Ratio for Shorts: ${(1 / rrRatio).toFixed(2)}x (Target lies too close to support)`);
      score *= 0.5;
    }

    // Decide Direction
    if (score >= 45 && deferReasons.length === 0) {
      direction = 'BUY';
    } else if (score <= -45 && deferReasons.length === 0) {
      direction = 'SELL';
    } else {
      direction = 'HOLD';
      if (deferReasons.length === 0) {
        deferReasons.push('Insufficient indicator convergence strength');
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
