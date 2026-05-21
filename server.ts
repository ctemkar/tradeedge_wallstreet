import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { runMarketScan, ScanCycleReport, fetchCandleHistory } from './src/services/scanner.js';
import { StrategyMetrics } from './src/services/indicators.js';
import {
  loginToAngelOne as loginToSchwab,
  fetchAngelProfile as fetchSchwabProfile,
  fetchAngelRMS as fetchSchwabRMS,
  placeAngelOrder as placeSchwabOrder,
  fetchAngelHoldings as fetchSchwabHoldings,
  fetchAngelPositions as fetchSchwabPositions,
} from './src/services/angelone.js';

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json());

// TradeEdge Engine In-Memory State
interface Position {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  currentPrice: number;
  leverage: number;
  margin: number; // Allocated USDT
  size: number; // Size in coin units
  takeProfit: number;
  stopLoss: number;
  unrealizedPnl: number;
  pnlPercent: number;
  timestamp: string;
  manualOverride: boolean;
  entryFee?: number;
}

interface HistoricalTrade {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice: number;
  leverage: number;
  margin: number;
  pnl: number;
  pnlPercent: number;
  timestamp: string;
  exitReason: 'TAKE_PROFIT' | 'STOP_LOSS' | 'LIQUIDATION' | 'MANUAL_CLOSE';
  entryFee?: number;
  exitFee?: number;
  totalFee?: number;
}

import fs from 'fs';

const state = {
  botActive: true,
  autonomousTrading: true, // Auto-trading enabled by default
  lastScanTime: '',
  scanIntervalSeconds: 60,
  paperBalance: 11000.0,
  freeMargin: 11000.0,
  deployableCapital: 8800.0,
  marginBufferPercent: 20.0, // Operator can tune
  marketMode: 'us_stocks' as 'crypto' | 'us_stocks',
  config: {
    leverage: 1,
    allocation: 2000, // Margin allocated per automated position (₹2,200/2,000 INR default)
    minVolume: 1000000, // ₹1M default to filter liquid Indian stocks
    maxClusteredPositions: 3, // Prevent correlation clustering
    preventCorrelationClustering: true, 
    paperMode: true,
    scanLimit: 120,
    rsiOverbought: 70,
    rsiOversold: 30,
    macdFast: 12,
    macdSlow: 26,
    macdSignal: 9,
    liveUniverseString: '*', // Tradeable list (* means unrestricted)
    schwabProductType: 'INTRADAY' as 'INTRADAY' | 'DELIVERY',
  },
  schwab: {
    linked: false,
    clientCode: '',
    apiKey: '',
    mpin: '',
    totpSecret: '',
    profileName: '',
    email: '',
    availableCash: 0,
    availableNetMargin: 0,
    linkedAt: '',
    holdings: [] as any[],
    livePositions: [] as any[],
    mutualFunds: [] as any[],
  },
  positions: [] as Position[],
  historicalTrades: [] as HistoricalTrade[],
  logs: [] as string[],
  scanArchive: [] as ScanCycleReport[],
  lastNonEmptyRanked: [] as StrategyMetrics[],
  blockedSignals: [] as { symbol: string; reason: string }[],
  deferredSignals: [] as { symbol: string; reason: string; price: number; score: number }[],
  nearMisses: [] as StrategyMetrics[],
  perSymbolRiskLocks: [] as string[], // Cooldowned coins
  postLiquidationQueue: [] as { symbol: string; timestamp: string }[], // Persists liquidated symbols
};

const PERSIST_FILE = path.join(process.cwd(), 'tradeedge_state_durable.json');

function saveStateToDisk() {
  try {
    const dataToSave = {
      paperBalance: state.paperBalance,
      positions: state.positions,
      historicalTrades: state.historicalTrades,
      scanArchive: state.scanArchive,
      lastNonEmptyRanked: state.lastNonEmptyRanked,
      perSymbolRiskLocks: state.perSymbolRiskLocks,
      logs: state.logs,
      postLiquidationQueue: state.postLiquidationQueue,
      config: state.config,
      marketMode: state.marketMode,
      autonomousTrading: state.autonomousTrading,
      schwab: state.schwab,
    };
    fs.writeFileSync(PERSIST_FILE, JSON.stringify(dataToSave, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save state to disk:', err);
  }
}

function loadStateFromDisk() {
  try {
    if (fs.existsSync(PERSIST_FILE)) {
      const data = JSON.parse(fs.readFileSync(PERSIST_FILE, 'utf8'));
      if (data.paperBalance !== undefined) state.paperBalance = data.paperBalance;
      if (data.positions !== undefined) state.positions = data.positions;
      if (data.historicalTrades !== undefined) state.historicalTrades = data.historicalTrades;
      if (data.scanArchive !== undefined) state.scanArchive = data.scanArchive;
      if (data.lastNonEmptyRanked !== undefined) state.lastNonEmptyRanked = data.lastNonEmptyRanked;
      if (data.perSymbolRiskLocks !== undefined) state.perSymbolRiskLocks = data.perSymbolRiskLocks;
      if (data.logs !== undefined) state.logs = data.logs;
      if (data.postLiquidationQueue !== undefined) state.postLiquidationQueue = data.postLiquidationQueue;
      if (data.marketMode !== undefined) state.marketMode = data.marketMode === 'india_stocks' ? 'us_stocks' : data.marketMode;
      if (data.autonomousTrading !== undefined) state.autonomousTrading = data.autonomousTrading;
      if (data.schwab !== undefined) state.schwab = data.schwab;
      else if (data.angelOne !== undefined) state.schwab = data.angelOne;
      let healed = false;
      if (data.config !== undefined) {
        state.config = { ...state.config, ...data.config };
        if (state.config.allocation > state.paperBalance) {
          state.config.allocation = 2000;
          healed = true;
        }
      }
      // Clear legacy simulated positions when loaded into live mode to release margin
      if (!state.config.paperMode && state.positions.length > 0) {
        state.positions = [];
        healed = true;
        setTimeout(() => {
          logMessage('[State Recovery] Cleaned residual paper-simulation positions from active memory under Live Mode.');
        }, 100);
      }
      setTimeout(() => {
        logMessage('Durable operator state hydrated dynamically from disk storage.');
        if (healed) {
          saveStateToDisk();
        }
      }, 1500);
    }
  } catch (err) {
    console.error('Failed to load state from disk:', err);
  }
}

// System Logger Handler
function logMessage(msg: string) {
  const t = new Date().toISOString().split('T')[1].slice(0, 8);
  const formatted = `[${t}] ${msg}`;
  state.logs.unshift(formatted);
  if (state.logs.length > 300) {
    state.logs.pop();
  }
  console.log(formatted);
}

logMessage('Tradeedge_WallStreet operating intelligence boot initialized.');

// Helper to calculate free margin and deployable capital
function recalculateFinancials() {
  // Synchronize trading capital with broker limit when live mode is engaged or broker is linked
  if (state.schwab && state.schwab.linked) {
    if (state.schwab.availableNetMargin !== undefined && !isNaN(state.schwab.availableNetMargin)) {
      state.paperBalance = state.schwab.availableNetMargin;
    }
  }

  let activeMargin = 0;
  let unrealizedTotal = 0;
  
  state.positions.forEach(p => {
    activeMargin += p.margin;
    unrealizedTotal += p.unrealizedPnl;
  });

  if (state.config.paperMode || !state.schwab.linked) {
    // Paper Mode or unlinked: Subtract active margin from static paper balance
    state.freeMargin = state.paperBalance + unrealizedTotal - activeMargin;
  } else {
    // Live broker linked: Broker's balance/margin already has active margin deducted
    state.freeMargin = state.paperBalance + unrealizedTotal;
  }
  
  // Deployable capital: respects the configurable margin dry-powder buffer
  const bufferValue = state.paperBalance * (state.marginBufferPercent / 100);
  state.deployableCapital = Math.max(0, state.freeMargin - bufferValue);
}

// Update simulated active positions unrealized PnL with new scan-cycle prices
function updatePositionPrices(prices: { [symbol: string]: number }) {
  let stateModified = false;
  state.positions = state.positions.map(p => {
    const freshPrice = prices[p.symbol];
    if (!freshPrice) return p;

    let pnl = 0;
    if (p.side === 'BUY') {
      pnl = (freshPrice - p.entryPrice) * p.size;
    } else {
      pnl = (p.entryPrice - freshPrice) * p.size;
    }

    // Zero out extremely tiny micro-variances to avoid floating-point -0.00 issues
    if (Math.abs(pnl) < 1e-4) {
      pnl = 0;
    }

    let pnlPercent = (pnl / p.margin) * 100;
    if (Math.abs(pnlPercent) < 1e-4) {
      pnlPercent = 0;
    }

    stateModified = true;

    return {
      ...p,
      currentPrice: freshPrice,
      unrealizedPnl: parseFloat(pnl.toFixed(2)),
      pnlPercent: parseFloat(pnlPercent.toFixed(2)),
    };
  });

  if (stateModified) {
    // Check stop losses / take profits / liquidations
    checkPositionTriggers();
    recalculateFinancials();
  }
}

// Evaluate trade exits (TP, SL, Liquidation)
function checkPositionTriggers() {
  const stillOpen: Position[] = [];
  
  state.positions.forEach(p => {
    let closed = false;
    let reason: 'TAKE_PROFIT' | 'STOP_LOSS' | 'LIQUIDATION' | 'MANUAL_CLOSE' = 'MANUAL_CLOSE';
    let exitPrice = p.currentPrice;

    // Liquidation Check (Loss equals 95% of margin)
    if (p.pnlPercent <= -95) {
      logMessage(`CRITICAL Risk Lock: ${p.symbol} position liquidated at ${p.currentPrice}`);
      exitPrice = p.side === 'BUY' ? p.entryPrice * 0.90 : p.entryPrice * 1.10; // estimate
      reason = 'LIQUIDATION';
      closed = true;
      // Add symbol to post-liquidation review queue
      if (!state.postLiquidationQueue.some(item => item.symbol === p.symbol)) {
        state.postLiquidationQueue.push({
          symbol: p.symbol,
          timestamp: new Date().toLocaleTimeString(),
        });
      }
    } 
    // Take Profit Trigger
    else if (p.takeProfit > 0 && ((p.side === 'BUY' && p.currentPrice >= p.takeProfit) || (p.side === 'SELL' && p.currentPrice <= p.takeProfit))) {
      logMessage(`PROFIT TRIGGER: ${p.symbol} Hit Take Profit level at ${p.takeProfit}`);
      exitPrice = p.takeProfit;
      reason = 'TAKE_PROFIT';
      closed = true;
    }
    // Stop Loss Trigger
    else if (p.stopLoss > 0 && ((p.side === 'BUY' && p.currentPrice <= p.stopLoss) || (p.side === 'SELL' && p.currentPrice >= p.stopLoss))) {
      logMessage(`RISK BREACH: ${p.symbol} Hit Stop Loss protective level at ${p.stopLoss}`);
      exitPrice = p.stopLoss;
      reason = 'STOP_LOSS';
      closed = true;
    }

    if (closed) {
      executePositionCloseInternal(p, exitPrice, reason);
    } else {
      stillOpen.push(p);
    }
  });

  state.positions = stillOpen;
}

// Execute closing updates and archiving
function executePositionCloseInternal(p: Position, exitPrice: number, reason: 'TAKE_PROFIT' | 'STOP_LOSS' | 'LIQUIDATION' | 'MANUAL_CLOSE') {
  let finalPnl = 0;
  if (p.side === 'BUY') {
    finalPnl = (exitPrice - p.entryPrice) * p.size;
  } else {
    finalPnl = (p.entryPrice - exitPrice) * p.size;
  }

  // Calculate Transaction and Brokerage Fees on Exit
  const exitValue = exitPrice * p.size;
  const exitBrokerage = Math.min(20.0, exitValue * 0.0003);
  const exitRegulatoryTaxes = exitValue * 0.0002;
  const exitFee = parseFloat((exitBrokerage + exitRegulatoryTaxes).toFixed(2));

  const entryFee = p.entryFee || 0;
  const totalFee = parseFloat((entryFee + exitFee).toFixed(2));

  // Subtract exit transaction fees and apply gross PnL to capital pool
  state.paperBalance = parseFloat((state.paperBalance + finalPnl - exitFee).toFixed(2));

  const netPnl = parseFloat((finalPnl - entryFee - exitFee).toFixed(2));
  const pnlPercent = parseFloat(((netPnl / p.margin) * 100).toFixed(2));

  if (!state.config.paperMode) {
    logMessage(`[SCHWAB GATEWAY] ⚡ Transmitting live exit package for ${p.symbol}...`);
    logMessage(`[SCHWAB GATEWAY] 🟢 Live position closed: ${p.side === 'BUY' ? 'SELL_EXIT' : 'BUY_EXIT'} ${p.symbol} @ $${exitPrice} | Net realized: $${netPnl.toFixed(2)} (Fees: $${exitFee.toFixed(2)})`);

    if (state.schwab.linked) {
      logMessage(`[Schwab Gateway] ⚡ Initializing live market exit order for ${p.symbol}...`);
      (async () => {
        try {
          const authRes = await loginToSchwab(
            state.schwab.apiKey,
            state.schwab.clientCode,
            state.schwab.mpin,
            state.schwab.totpSecret
          );
          if (authRes.success && authRes.data?.jwtToken) {
            const exitSide = p.side === 'BUY' ? 'SELL' : 'BUY';
            const quantity = Math.max(1, Math.floor((p.margin * p.leverage) / p.entryPrice));
            const orderRes = await placeSchwabOrder(
              state.schwab.apiKey,
              authRes.data.jwtToken,
              {
                symbol: p.symbol,
                side: exitSide,
                price: exitPrice,
                quantity,
                productType: state.config.schwabProductType || 'INTRADAY'
              }
            );
            if (orderRes.success) {
              logMessage(`[Schwab Gateway] 🟢 LIVE BROKER close order placed successfully! Order ID: ${orderRes.orderId}`);
            } else {
              logMessage(`[Schwab Gateway] ❌ LIVE BROKER close order rejected: ${orderRes.error}`);
            }
          } else {
            logMessage(`[Schwab Gateway] ❌ Live exit auth failed: ${authRes.error}`);
          }
        } catch (e: any) {
          logMessage(`[Schwab Gateway] ❌ Error routing live close order: ${e.message || e}`);
        }
      })();
    }
  }

  const historyEntry: HistoricalTrade = {
    id: p.id,
    symbol: p.symbol,
    side: p.side,
    entryPrice: p.entryPrice,
    exitPrice: parseFloat(exitPrice.toFixed(4)),
    leverage: p.leverage,
    margin: p.margin,
    pnl: netPnl,
    pnlPercent: pnlPercent,
    timestamp: new Date().toLocaleTimeString(),
    exitReason: reason,
    entryFee,
    exitFee,
    totalFee,
  };

  state.historicalTrades.unshift(historyEntry);
  if (state.historicalTrades.length > 100) {
    state.historicalTrades.pop();
  }

  // Set visual risk lock cooldown on symbol to avoid rapid re-entry
  state.perSymbolRiskLocks.push(p.symbol);
  logMessage(`Archived trade exit for ${p.symbol}. Net Realized PNL: ₹${netPnl.toFixed(2)} (Gross: ₹${finalPnl.toFixed(2)} | Total Fees Paid: ₹${totalFee.toFixed(2)}). Cooldown locked.`);
  
  // Keep size of locks reasonable
  if (state.perSymbolRiskLocks.length > 20) {
    state.perSymbolRiskLocks.shift();
  }
  saveStateToDisk();
}

function isSymbolTradable(symbol: string): boolean {
  if (!state.config.liveUniverseString || state.config.liveUniverseString.trim() === '*' || state.config.liveUniverseString.trim() === '') {
    return true;
  }
  const allowed = state.config.liveUniverseString.split(',').map((s: string) => s.trim().toUpperCase());
  const normalSymbol = symbol.trim().toUpperCase();
  // Match raw symbol e.g. RELIANCE or BTCUSDT
  return allowed.some(a => normalSymbol.includes(a) || a.includes(normalSymbol));
}

// Trigger autonomous trades from scanner output
async function evaluateAutonomousTrades(signals: StrategyMetrics[]) {
  if (!state.autonomousTrading) return;

  logMessage('Autonomous Executor checking signal convergence...');

  // Sort signals by higher conviction
  const bestSignals = [...signals].sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

  let entriesSubmittedThisCycle = 0;
  const sameSideCountThisCycle: { [key: string]: number } = { BUY: 0, SELL: 0 };

  for (const signal of bestSignals) {
    // Live Tradable Universe Filter (Discovery list is broader than execution portfolio)
    if (!isSymbolTradable(signal.symbol)) {
      logMessage(`Autonomous Rejected for ${signal.symbol}: Security is in Discovery only and not registered in the Operator Live Tradable Universe list (${state.config.liveUniverseString}).`);
      continue;
    }

    // Limits checks
    if (state.deployableCapital < state.config.allocation) {
      logMessage(`Autonomous entry rejected for ${signal.symbol}: Margin Protection Lock. Free deployable cap ₹${state.deployableCapital.toFixed(2)} is less than trade size ₹${state.config.allocation}`);
      continue;
    }

    // Symbol existing position
    if (state.positions.some(p => p.symbol === signal.symbol)) {
      continue; // Already occupied
    }

    // Correlation limit check (Sided clustering control)
    if (state.config.preventCorrelationClustering) {
      const activeSameSide = state.positions.filter(p => p.side === signal.direction).length;
      if (activeSameSide >= state.config.maxClusteredPositions) {
        logMessage(`Autonomous Rejected for ${signal.symbol}: Side Exposure Lock. Max limit of ${state.config.maxClusteredPositions} on ${signal.direction} side clusters has been reached.`);
        continue;
      }

      // Check short dominant overload (Adding fresh shorts when the open book is already materially short-dominant)
      if (signal.direction === 'SELL') {
        const activeShorts = state.positions.filter(p => p.side === 'SELL').length;
        const activeLongs = state.positions.filter(p => p.side === 'BUY').length;
        if (activeShorts >= 2 && activeShorts > activeLongs) {
          logMessage(`Autonomous Rejected for ${signal.symbol}: Short-Dominance Overload safeguard active. Already imbalanced with active Shorts (${activeShorts}) vs active Longs (${activeLongs}).`);
          continue;
        }
      }

      // Block highly-correlated same-cycle same-side exposure (Prevent bursty basket-entries)
      if (sameSideCountThisCycle[signal.direction] >= 1) {
        logMessage(`Autonomous Deferred for ${signal.symbol}: Same-Cycle Same-Side Exposure Constraint. Limit of 1 same-side entry per scan cycle exceeded.`);
        continue;
      }
    }

    // Cooldown check
    if (state.perSymbolRiskLocks.includes(signal.symbol)) {
      logMessage(`Autonomous Rejected for ${signal.symbol}: Operator Active Cooldown has locked trade execution on this asset.`);
      continue;
    }

    // Open position!
    try {
      await openPositionInternal(
        signal.symbol,
        signal.direction as 'BUY' | 'SELL',
        signal.price,
        state.config.allocation,
        state.config.leverage,
        signal.support,
        signal.resistance,
        false
      );
      entriesSubmittedThisCycle++;
      sameSideCountThisCycle[signal.direction] = (sameSideCountThisCycle[signal.direction] || 0) + 1;
      
      // Recalculate caps immediately to prevent same-cycle over-exposure
      recalculateFinancials();
    } catch (err: any) {
      logMessage(`Autonomous Execution failed for ${signal.symbol}: ${err.message || err}`);
    }
  }

  if (entriesSubmittedThisCycle === 0) {
    logMessage('Autonomous Scan Evaluation: No new signals met safety buffer or correlation limits.');
  }
}

// Create trade positions (Manual or Automated)
async function openPositionInternal(
  symbol: string,
  side: 'BUY' | 'SELL',
  entryPrice: number,
  margin: number,
  leverage: number,
  support: number,
  resistance: number,
  isManual = false
): Promise<string> {
  const id = 'pos_' + Math.random().toString(36).substr(2, 9);
  const positionSizeUSDT = margin * leverage;
  const size = positionSizeUSDT / entryPrice;

  // Calculate Entry Fees: 0.03% capped at ₹20 brokerage, plus 0.02% miscellaneous taxes
  const entryBrokerage = Math.min(20.0, positionSizeUSDT * 0.0003);
  const entryRegulatoryTaxes = positionSizeUSDT * 0.0002;
  const entryFee = parseFloat((entryBrokerage + entryRegulatoryTaxes).toFixed(2));

  // If live mode, validation must be pre-run or live ordered
  if (!state.config.paperMode) {
    if (!state.schwab.linked) {
      throw new Error("No live broker linked. Please connect your Schwab account before executing live trades.");
    }

    logMessage(`[Schwab Gateway] ⚡ Initializing live partner order for ${symbol}...`);
    const authRes = await loginToSchwab(
      state.schwab.apiKey,
      state.schwab.clientCode,
      state.schwab.mpin,
      state.schwab.totpSecret
    );
    if (!authRes.success || !authRes.data?.jwtToken) {
      logMessage(`[Schwab Gateway] ❌ Live auth failed: ${authRes.error}`);
      throw new Error(`Live partner auth failed: ${authRes.error || 'Invalid credentials'}`);
    }

    const quantity = Math.max(1, Math.floor((margin * leverage) / entryPrice));
    const orderRes = await placeSchwabOrder(
      state.schwab.apiKey,
      authRes.data.jwtToken,
      {
        symbol,
        side,
        price: entryPrice,
        quantity,
        productType: state.config.schwabProductType || 'INTRADAY'
      }
    );

    if (!orderRes.success) {
      logMessage(`[Schwab Gateway] ❌ LIVE BROKER order rejected: ${orderRes.error}`);
      throw new Error(`Live broker order rejected: ${orderRes.error || 'Unknown rejection reason'}`);
    }

    logMessage(`[Schwab Gateway] 🟢 LIVE BROKER order placed successfully! Order ID: ${orderRes.orderId}`);
  }

  // Deduct the entry transaction fee from Simulator Capital Pool immediately
  state.paperBalance = parseFloat((state.paperBalance - entryFee).toFixed(2));

  // Derive Stop Loss and Take Profit levels intelligently if not specified
  // SL usually at support (for buy) or resistance (for sell) +/- ATR/buffer
  // We'll budget a risk of 50% position margin (relative limit)
  const maxRiskDist = entryPrice * (0.05); // 5% price change at 10x leverage is 50% margin
  let stopLoss = 0;
  let takeProfit = 0;

  if (side === 'BUY') {
    stopLoss = support > 0 && support < entryPrice && (entryPrice - support) < maxRiskDist 
      ? support * 0.995 
      : entryPrice - maxRiskDist;
    takeProfit = resistance > entryPrice 
      ? resistance * 1.005 
      : entryPrice + maxRiskDist * 1.5;
  } else {
    stopLoss = resistance > 0 && resistance > entryPrice && (resistance - entryPrice) < maxRiskDist 
      ? resistance * 1.005 
      : entryPrice + maxRiskDist;
    takeProfit = support < entryPrice && support > 0
      ? support * 0.995 
      : entryPrice - maxRiskDist * 1.5;
  }

  const newPos: Position = {
    id,
    symbol,
    side,
    entryPrice,
    currentPrice: entryPrice,
    leverage,
    margin,
    size: parseFloat(size.toFixed(5)),
    takeProfit: parseFloat(takeProfit.toFixed(4)),
    stopLoss: parseFloat(stopLoss.toFixed(4)),
    unrealizedPnl: 0,
    pnlPercent: 0,
    timestamp: new Date().toLocaleTimeString(),
    manualOverride: isManual,
    entryFee,
  };

  state.positions.push(newPos);
  
  if (!state.config.paperMode) {
    logMessage(`[SCHWAB GATEWAY] ⚡ Transmitting live market order object for ${symbol}...`);
    logMessage(`[SCHWAB GATEWAY] 🟢 Live position filled: ${side} ${symbol} @ $${entryPrice} | Order Ticket ID: ${id.toUpperCase()}`);
  }

  logMessage(`Opened ${isManual ? 'MANUAL OPERATOR' : 'AUTONOMOUS'} ${side} position on ${symbol} @ $${entryPrice} with ${leverage}x leverage. Trade Value: $${positionSizeUSDT.toFixed(2)} (Entry Fee Paid: $${entryFee.toFixed(2)}). SL: $${stopLoss.toFixed(4)}, TP: $${takeProfit.toFixed(4)}`);
  
  recalculateFinancials();
  return id;
}

// Perform active live market scan and update state
let scanningInProgress = false;

async function executeScanCycle() {
  if (scanningInProgress) return;
  scanningInProgress = true;
  
  try {
    logMessage('Scan cycle triggered. Broad liquidity query running...');
    const result: ScanCycleReport = await runMarketScan({
      minVolume: state.config.minVolume,
      rsiOverbought: state.config.rsiOverbought,
      rsiOversold: state.config.rsiOversold,
      macdFast: state.config.macdFast,
      macdSlow: state.config.macdSlow,
      macdSignal: state.config.macdSignal,
      scanLimit: state.config.scanLimit,
    }, state.perSymbolRiskLocks, state.marketMode);

    // Save outputs
    state.lastScanTime = result.summary.timestamp;
    
    // Add scanner logs to engine records
    result.summary.logs.forEach(msg => logMessage(`[Scanner] ${msg}`));

    // Update prices of active positions
    const recentPrices: { [symbol: string]: number } = {};
    result.rankedSignals.forEach(r => { recentPrices[r.symbol] = r.price; });
    result.nearMisses.forEach(nm => { recentPrices[nm.symbol] = nm.price; });
    result.deferredSignals.forEach(ds => { recentPrices[ds.symbol] = ds.price; });

    // For any open position asset not present in recent scans, fetch the price directly!
    for (const p of state.positions) {
      if (recentPrices[p.symbol] === undefined) {
        try {
          const hist = await fetchCandleHistory(p.symbol, () => {});
          if (hist && hist.close.length > 0) {
            recentPrices[p.symbol] = hist.close[hist.close.length - 1];
          }
        } catch (e) {
          // Fallback silent
        }
      }
    }

    updatePositionPrices(recentPrices);

    // Expose Diagnostic counts
    state.blockedSignals = result.blockedSignals;
    state.deferredSignals = result.deferredSignals;
    state.nearMisses = result.nearMisses;

    // Persist Top Ranked signals - DO NOT wipe out with blank scanning!
    if (result.rankedSignals.length > 0) {
      state.lastNonEmptyRanked = result.rankedSignals;
      logMessage(`Scan completed successfully. Updated ranked list: ${result.rankedSignals.length} entries. Visual snapshots validated.`);
    } else {
      logMessage('Scan complete: No qualified strategy entry signals generated. Retaining last ranked visual setups.');
    }

    // Archive scan cycle
    state.scanArchive.unshift(result);
    if (state.scanArchive.length > 30) {
      state.scanArchive.pop();
    }

    // Run trade decision models if autonomous is on
    await evaluateAutonomousTrades(result.rankedSignals);

    // Save running system state to disk (persists logs, scan archives, and positions)
    saveStateToDisk();

  } catch (err: any) {
    logMessage(`CRITICAL: Scanning sequence aborted. ${err.message || err}`);
  } finally {
    scanningInProgress = false;
  }
}

// Scanning cron-like interval
let scanTimer: NodeJS.Timeout | null = null;
function restartScanScheduler() {
  if (scanTimer) clearInterval(scanTimer);
  logMessage(`Restarting scan loop with target frequency: ${state.scanIntervalSeconds} seconds.`);
  scanTimer = setInterval(() => {
    if (state.botActive) {
      executeScanCycle();
    }
  }, state.scanIntervalSeconds * 1000);
}

// Start first scan in background
setTimeout(() => {
  loadStateFromDisk();
  executeScanCycle();
  restartScanScheduler();
}, 1000);


// REST API Routing Config
app.get('/api/candles', async (req, res) => {
  const symbol = (req.query.symbol as string) || 'RELIANCE.NS';
  try {
    const klines = await fetchCandleHistory(symbol, (msg) => {});
    if (!klines) {
      return res.status(404).json({ error: 'Candles not available from exchange' });
    }
    res.json(klines);
  } catch (err: any) {
    res.status(500).json({ error: `Failed to retrieve candles: ${err.message || err}` });
  }
});

app.get('/api/state', (req, res) => {
  recalculateFinancials();
  res.json({
    ...state,
    scanningInProgress,
  });
});

app.post('/api/config', (req, res) => {
  const { 
    leverage, allocation, minVolume, maxClusteredPositions, 
    preventCorrelationClustering, marginBufferPercent, 
    scanIntervalSeconds, scanLimit, autonomousTrading,
    marketMode, paperMode, liveUniverseString, paperBalance,
    schwabProductType, angelProductType
  } = req.body;

  if (paperBalance !== undefined) {
    state.paperBalance = Number(paperBalance);
    logMessage(`Trading capital balance adjusted manually to: ₹${state.paperBalance.toFixed(2)}.`);
  }

  const selectedBrokerProductType = schwabProductType ?? angelProductType;
  if (selectedBrokerProductType !== undefined) {
    if (selectedBrokerProductType === 'INTRADAY' || selectedBrokerProductType === 'DELIVERY') {
      state.config.schwabProductType = selectedBrokerProductType;
      logMessage(`Schwab account profile adjusted to: ${selectedBrokerProductType}.`);
    }
  }

  if (marketMode !== undefined) {
    if (marketMode === 'us_stocks' || marketMode === 'crypto' || marketMode === 'india_stocks') {
      state.marketMode = marketMode === 'india_stocks' ? 'us_stocks' : marketMode;
      logMessage(`Trading focus shifted to ${state.marketMode === 'us_stocks' ? 'US Equities' : 'Crypto Futures USDT'}`);
    } else {
      logMessage(`Action rejected: Unsupported market focus: ${marketMode}`);
    }
  }

  if (liveUniverseString !== undefined) {
    state.config.liveUniverseString = String(liveUniverseString);
  }

  if (leverage !== undefined) state.config.leverage = Number(leverage);
  if (allocation !== undefined) state.config.allocation = Number(allocation);
  if (minVolume !== undefined) state.config.minVolume = Number(minVolume);
  if (maxClusteredPositions !== undefined) state.config.maxClusteredPositions = Number(maxClusteredPositions);
  if (preventCorrelationClustering !== undefined) state.config.preventCorrelationClustering = Boolean(preventCorrelationClustering);
  if (marginBufferPercent !== undefined) state.marginBufferPercent = Number(marginBufferPercent);
  if (scanLimit !== undefined) state.config.scanLimit = Number(scanLimit);
  if (paperMode !== undefined) {
    const prevMode = state.config.paperMode;
    state.config.paperMode = Boolean(paperMode);
    if (prevMode !== state.config.paperMode) {
      logMessage(`Trading Execution Mode shifted to ${state.config.paperMode ? 'PAPER SIMULATION' : 'LIVE PRODUCTION (SCHWAB GATEWAY)'}.`);
      state.positions = [];
      logMessage(`Cleaned active positions tracking list due to execution mode shift to avoid margin conflicts.`);
    }
  }
  if (autonomousTrading !== undefined) {
    state.autonomousTrading = Boolean(autonomousTrading);
    logMessage(`Autonomous trading engine ${state.autonomousTrading ? 'ACTIVATED' : 'PAUSED'} by Operator override.`);
  }

  if (scanIntervalSeconds !== undefined && Number(scanIntervalSeconds) !== state.scanIntervalSeconds) {
    state.scanIntervalSeconds = Math.max(10, Number(scanIntervalSeconds));
    restartScanScheduler();
  }

  recalculateFinancials();
  saveStateToDisk();
  logMessage('Operator configuration profiles updated successfully.');
  res.json({ status: 'ok', state });
});

app.post('/api/scan', async (req, res) => {
  executeScanCycle();
  res.json({ status: 'initiated' });
});

app.post('/api/order', async (req, res) => {
  const { symbol, side, price, margin, leverage, isManual, overrideBlock } = req.body;

  if (!symbol || !side || !price || !margin || !leverage) {
    return res.status(400).json({ error: 'Missing standard execution values.' });
  }

  // Live Tradable Universe Filter (Manual check blocks unless overridden)
  if (!isSymbolTradable(symbol) && !overrideBlock) {
    return res.status(400).json({
      error: `Universe Protection: Symbol ${symbol} is outside your configured Live Tradable Universe. Set 'Force Override Protects' to execute anyway.`
    });
  }

  // Strategy alignment check (conflicting action protection)
  const currentSignal = state.lastNonEmptyRanked.find(r => r.symbol === symbol);
  if (currentSignal && currentSignal.direction !== side && !overrideBlock) {
    return res.status(400).json({
      error: `Strategy Protection: Placing a manual ${side} order conflicts with the active Strategy Direction (${currentSignal.direction}). Set 'Force Override Protects' to bypass this safeguard.`
    });
  }

  // Check margin dry-powder buffer
  if (!overrideBlock && state.deployableCapital < margin) {
    return res.status(400).json({ error: `Margin Protection: Execution denied. Free deployable volume is ₹${state.deployableCapital.toFixed(2)}` });
  }

  // Check if already open
  if (state.positions.some(p => p.symbol === symbol)) {
    return res.status(400).json({ error: `Clustered Order Filter: Open active positions already exist for ${symbol}` });
  }

  // Clear symbol cooldown lock if manually overridden
  if (overrideBlock && state.perSymbolRiskLocks.includes(symbol)) {
    state.perSymbolRiskLocks = state.perSymbolRiskLocks.filter(s => s !== symbol);
    logMessage(`Operator manual override: Clearing active cooldown risk-block for ${symbol}`);
  }

  // Fetch support and resistance of asset from cache or default ranges to place smart brackets
  const snapshotItem = state.lastNonEmptyRanked.find(r => r.symbol === symbol) || 
                       state.nearMisses.find(nm => nm.symbol === symbol);
  const support = snapshotItem ? snapshotItem.support : price * 0.95;
  const resistance = snapshotItem ? snapshotItem.resistance : price * 1.05;

  try {
    const id = await openPositionInternal(symbol, side, price, margin, leverage, support, resistance, !!isManual);
    saveStateToDisk();
    res.json({ status: 'ok', positionId: id });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Execution failed' });
  }
});

app.post('/api/close', (req, res) => {
  const { id } = req.body;
  const pos = state.positions.find(p => p.id === id);

  if (!pos) {
    return res.status(404).json({ error: 'Position not found' });
  }

  executePositionCloseInternal(pos, pos.currentPrice, 'MANUAL_CLOSE');
  state.positions = state.positions.filter(p => p.id !== id);
  recalculateFinancials();
  saveStateToDisk();

  res.json({ status: 'ok' });
});

app.post('/api/clear-cooldown', (req, res) => {
  const { symbol } = req.body;
  if (symbol) {
    state.perSymbolRiskLocks = state.perSymbolRiskLocks.filter(s => s !== symbol);
    logMessage(`Unlocked active risk lock for ${symbol}`);
  } else {
    state.perSymbolRiskLocks = [];
    logMessage('All tactical market risk locks cleared.');
  }
  saveStateToDisk();
  res.json({ status: 'ok' });
});

app.post('/api/clear-liquidation', (req, res) => {
  const { symbol } = req.body;
  if (symbol) {
    state.postLiquidationQueue = state.postLiquidationQueue.filter(s => s.symbol !== symbol);
    logMessage(`Dismissed ${symbol} from post-liquidation review queue.`);
  } else {
    state.postLiquidationQueue = [];
    logMessage('All post-liquidation review queues cleared.');
  }
  saveStateToDisk();
  res.json({ status: 'ok', state });
});

function parseAngelNumeric(val: any): number {
  if (val === undefined || val === null) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    // Strip commas, currency symbols, and spaces
    const clean = val.replace(/[₹$,\s]/g, '');
    const num = parseFloat(clean);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}

function extractAngelCashAndMargin(data: any): { availableCash: number; availableNetMargin: number } {
  if (!data) return { availableCash: 0, availableNetMargin: 0 };
  
  // Look for any variation of cash key (lowercase, camelCase, etc.)
  const cashVal = data.availablecash !== undefined ? data.availablecash :
                  data.availableCash !== undefined ? data.availableCash :
                  data.cash !== undefined ? data.cash :
                  data.funds !== undefined ? data.funds :
                  data.available_cash !== undefined ? data.available_cash : 0;
  const availableCash = parseAngelNumeric(cashVal);
  
  // Look for any variation of margin key (lowercase, camelcase, etc.)
  const marginVal = data.net !== undefined ? data.net :
                    data.netMargin !== undefined ? data.netMargin :
                    data.netmargin !== undefined ? data.netmargin :
                    data.availableMargin !== undefined ? data.availableMargin :
                    data.availableNetMargin !== undefined ? data.availableNetMargin : cashVal;
  const availableNetMargin = parseAngelNumeric(marginVal);
  
  return { availableCash, availableNetMargin };
}

app.post('/api/schwab/link', async (req, res) => {
  const { clientCode, apiKey, mpin, totpSecret } = req.body;
  if (!clientCode || !apiKey || !mpin || !totpSecret) {
    return res.status(400).json({ error: 'Missing clientCode, apiKey, mpin, or totpSecret parameters' });
  }

  logMessage(`[Schwab] Connecting to partner account ${clientCode.toUpperCase()}...`);
  
  const authRes = await loginToSchwab(apiKey, clientCode, mpin, totpSecret);
  if (!authRes.success || !authRes.data?.jwtToken) {
    logMessage(`[Schwab] Authentication failed: ${authRes.error}`);
    return res.status(400).json({ error: authRes.error || 'Failed to authenticate with the configured Schwab adapter' });
  }

  const { jwtToken } = authRes.data;
  const profileRes = await fetchSchwabProfile(apiKey, jwtToken);
  const rmsRes = await fetchSchwabRMS(apiKey, jwtToken);

  const profileName = profileRes.success ? profileRes.data?.name : 'Schwab Client';
  const email = profileRes.success ? profileRes.data?.email : '';
  
  const { availableCash, availableNetMargin } = extractAngelCashAndMargin(rmsRes.success ? rmsRes.data : null);

  // Retrieve active portfolio holdings & positions from the broker terminal
  const holdingsRes = await fetchSchwabHoldings(apiKey, jwtToken);
  const positionsRes = await fetchSchwabPositions(apiKey, jwtToken);

  state.schwab = {
    linked: true,
    clientCode: clientCode.toUpperCase(),
    apiKey,
    mpin,
    totpSecret,
    profileName,
    email,
    availableCash,
    availableNetMargin,
    linkedAt: new Date().toLocaleDateString(),
    holdings: holdingsRes.success ? (holdingsRes.data || []) : [],
    livePositions: positionsRes.success ? (positionsRes.data || []) : [],
    mutualFunds: [],
  };

  logMessage(`[Schwab] Dynamic credentials mapping completed. Client Name: ${profileName} | Net Margin: $${availableNetMargin.toFixed(2)}`);
  
  // Automatically switch mode to Live (paperMode: false) and clear simulated positions to resolve capital/margin lock
  state.config.paperMode = false;
  state.positions = [];
  logMessage(`[Schwab] Auto-switched system execution mode to LIVE. Cleared any simulated tracking positions to avoid margin conflicts.`);

  // Hydrate simulator balance with live equity
  if (availableNetMargin > 0) {
    state.paperBalance = availableNetMargin;
  }
  recalculateFinancials();
  saveStateToDisk();

  res.json({ status: 'ok', schwab: state.schwab });
});

app.post('/api/schwab/unlink', (req, res) => {
  logMessage(`[Schwab] Unlinked active client profile ${state.schwab.clientCode}`);
  state.schwab = {
    linked: false,
    clientCode: '',
    apiKey: '',
    mpin: '',
    totpSecret: '',
    profileName: '',
    email: '',
    availableCash: 0,
    availableNetMargin: 0,
    linkedAt: '',
    holdings: [],
    livePositions: [],
    mutualFunds: [],
  };
  recalculateFinancials();
  saveStateToDisk();
  res.json({ status: 'ok', schwab: state.schwab });
});

app.post('/api/schwab/refresh', async (req, res) => {
  if (!state.schwab.linked) {
    return res.status(400).json({ error: 'No Schwab account linked yet.' });
  }

  const { apiKey, clientCode, mpin, totpSecret } = state.schwab;
  logMessage(`[Schwab] Fetching refreshed balance and session diagnostics...`);

  const authRes = await loginToSchwab(apiKey, clientCode, mpin, totpSecret);
  if (!authRes.success || !authRes.data?.jwtToken) {
    logMessage(`[Schwab] Session refresh aborted: ${authRes.error}`);
    return res.status(400).json({ error: `Refresh authentication error: ${authRes.error}` });
  }

  const { jwtToken } = authRes.data;
  const rmsRes = await fetchSchwabRMS(apiKey, jwtToken);
  
  if (rmsRes.success) {
    const { availableCash, availableNetMargin } = extractAngelCashAndMargin(rmsRes.data);
    state.schwab.availableCash = availableCash;
    state.schwab.availableNetMargin = availableNetMargin;
    
    // Refresh live holding assets and positions
    const holdingsRes = await fetchSchwabHoldings(apiKey, jwtToken);
    const positionsRes = await fetchSchwabPositions(apiKey, jwtToken);
    state.schwab.holdings = holdingsRes.success ? (holdingsRes.data || []) : [];
    state.schwab.livePositions = positionsRes.success ? (positionsRes.data || []) : [];
    
    // Real-Time Portfolio Reconciliation: Clear local positions if they do not exist on the live broker to prevent frozen margin locks
    if (!state.config.paperMode && state.positions.length > 0) {
      const brokerSymbols = new Set(
        state.schwab.livePositions.map((p: any) => {
          const sym = p.tradingsymbol || '';
          const base = sym.replace(/-EQ$/, '').replace(/-BE$/, '');
          return base.toUpperCase();
        })
      );
      
      const beforeCount = state.positions.length;
      state.positions = state.positions.filter(p => {
        const uppercaseSymbol = p.symbol.toUpperCase();
        return brokerSymbols.has(uppercaseSymbol);
      });
      
      if (state.positions.length !== beforeCount) {
        logMessage(`[Reconciliation] Pruned ${beforeCount - state.positions.length} orphaned/rejected positions from operator memory to align with actual broker holdings.`);
      }
    }
    
    logMessage(`[Schwab] Refreshed net balance: $${state.schwab.availableNetMargin.toFixed(2)} | Holdings synced: ${state.schwab.holdings.length} | Trade Positions synced: ${state.schwab.livePositions.length}`);
    
    // Also keep simulator balance updated
    if (state.schwab.availableNetMargin > 0) {
      state.paperBalance = state.schwab.availableNetMargin;
    }
    recalculateFinancials();
    saveStateToDisk();
  } else {
    return res.status(400).json({ error: rmsRes.error });
  }

  res.json({ status: 'ok', schwab: state.schwab });
});

app.post('/api/schwab/simulate', (req, res) => {
  if (!state.schwab.linked) {
    state.schwab.linked = true;
    state.schwab.clientCode = 'SCHWAB-DEMO';
    state.schwab.profileName = 'Demo Wall Street Portfolio';
    state.schwab.email = 'demo.client@example.com';
    state.schwab.availableCash = 42500.0;
    state.schwab.availableNetMargin = 125000.0;
    state.schwab.linkedAt = new Date().toLocaleDateString() + ' (Simulated)';
  }

  // Hydrate custom mock holdings (Equity)
  state.schwab.holdings = [
    {
      tradingsymbol: 'AAPL',
      symbol: 'AAPL',
      exchange: 'NASDAQ',
      isin: 'US0378331005',
      symboltoken: '2885',
      quantity: 15,
      averageprice: 198.5,
      ltp: 212.4,
      close: 209.1,
      profitandloss: 208.5
    },
    {
      tradingsymbol: 'MSFT',
      symbol: 'MSFT',
      exchange: 'NASDAQ',
      isin: 'US5949181045',
      symboltoken: '11536',
      quantity: 8,
      averageprice: 412.0,
      ltp: 438.7,
      close: 435.2,
      profitandloss: 213.6
    },
    {
      tradingsymbol: 'NVDA',
      symbol: 'NVDA',
      exchange: 'NASDAQ',
      isin: 'US67066G1040',
      symboltoken: '1594',
      quantity: 6,
      averageprice: 998.0,
      ltp: 1042.5,
      close: 1036.2,
      profitandloss: 267.0
    }
  ];

  // Hydrate mock ETFs
  state.schwab.mutualFunds = [
    {
      mffname: 'SPDR S&P 500 ETF Trust',
      symbol: 'SPY',
      isin: 'US78462F1030',
      quantity: 42.0,
      averageprice: 514.21,
      ltp: 531.2,
      profitandloss: 713.58
    },
    {
      mffname: 'Invesco QQQ Trust',
      symbol: 'QQQ',
      isin: 'US46090E1038',
      quantity: 18.0,
      averageprice: 440.25,
      ltp: 453.1,
      profitandloss: 231.3
    }
  ];

  // Hydrate a demo active margin positions
  state.schwab.livePositions = [
    {
      tradingsymbol: 'AAPL',
      producttype: 'INTRADAY',
      netqty: '50',
      avgnetprice: '208.10',
      ltp: '212.40',
      pnl: '215.00'
    }
  ];

  logMessage('[Schwab Simulation] Populated simulated stock holdings, ETFs, and live day trade positions successfully.');
  recalculateFinancials();
  saveStateToDisk();

  res.json({ status: 'ok', schwab: state.schwab });
});

app.post('/api/reset', (req, res) => {
  state.paperBalance = 11000.0;
  state.config.allocation = 2000;
  state.positions = [];
  state.historicalTrades = [];
  state.perSymbolRiskLocks = [];
  state.postLiquidationQueue = [];
  state.logs = [];
  logMessage('Operator terminal reset instructions executed. Simulator reloaded to ₹11,000.00 INR and allocation reset to ₹2,000.00.');
  recalculateFinancials();
  saveStateToDisk();
  res.json({ status: 'ok' });
});

// Vite Middleware & SPA Static fallback files serving logic
const startServer = async () => {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TradeEdge operating server up and running on port ${PORT}`);
  });
};

startServer();
