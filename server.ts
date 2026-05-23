import express from 'express';
import dotenv from 'dotenv';
import https from 'https';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import selfsigned from 'selfsigned';
import { runMarketScan, ScanCycleReport, fetchCandleHistory } from './src/services/scanner.js';
import { StrategyMetrics } from './src/services/indicators.js';
import {
  buildSchwabAuthorizationUrl,
  exchangeSchwabAuthorizationCode,
  fetchSchwabAccounts,
  placeSchwabOrder,
  refreshSchwabAccessToken,
} from './src/services/schwab.js';

dotenv.config({ path: '.env.local' });
dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json());

function getAppBaseUrl() {
  const configured = process.env.APP_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).toString().replace(/\/$/, '');
    } catch {
      // Ignore invalid APP_URL and fall back to the local dev server URL.
    }
  }

  return `http://localhost:${PORT}`;
}

function getSchwabRedirectUriFromEnv() {
  const raw = process.env.SCHWAB_REDIRECT_URI?.trim();
  if (!raw || raw.includes('#')) {
    return null;
  }

  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

async function buildLocalSchwabHttpsOptions() {
  const notAfterDate = new Date();
  notAfterDate.setDate(notAfterDate.getDate() + 30);

  const pems = await selfsigned.generate(
    [{ name: 'commonName', value: '127.0.0.1' }],
    {
      algorithm: 'sha256',
      keySize: 2048,
      notAfterDate,
      extensions: [
        {
          name: 'subjectAltName',
          altNames: [
            { type: 7, ip: '127.0.0.1' },
            { type: 2, value: 'localhost' },
          ],
        },
      ],
    }
  );

  return {
    key: pems.private,
    cert: pems.cert,
  };
}

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

const DEFAULT_PAPER_BALANCE = 1000;
const DEFAULT_ALLOCATION = 200;

function createEmptySchwabState() {
  return {
    linked: false,
    clientCode: '',
    apiKey: '',
    mpin: '',
    totpSecret: '',
    accessToken: '',
    refreshToken: '',
    tokenExpiresAt: 0,
    accountHash: '',
    accountNumber: '',
    profileName: '',
    email: '',
    availableCash: 0,
    availableNetMargin: 0,
    brokerBalances: {
      cashBalance: 0,
      availableFunds: 0,
      buyingPower: 0,
      liquidationValue: 0,
      equity: 0,
    },
    linkedAt: '',
    holdings: [] as any[],
    livePositions: [] as any[],
    mutualFunds: [] as any[],
  };
}

const state = {
  botActive: true,
  autonomousTrading: true, // Auto-trading enabled by default
  lastScanTime: '',
  scanIntervalSeconds: 60,
  paperBalance: DEFAULT_PAPER_BALANCE,
  freeMargin: DEFAULT_PAPER_BALANCE,
  deployableCapital: DEFAULT_PAPER_BALANCE * 0.8,
  marginBufferPercent: 10.0, // Operator can tune
  marketMode: 'us_stocks' as 'crypto' | 'us_stocks',
  config: {
    leverage: 1,
    allocation: DEFAULT_ALLOCATION,
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
  schwab: createEmptySchwabState(),
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

function maskSchwabAccount(accountNumber: string) {
  if (!accountNumber) return 'Schwab Account';
  const lastFour = accountNumber.slice(-4);
  return `Schwab Account ••••${lastFour}`;
}

function parseBrokerNumeric(val: any): number {
  if (val === undefined || val === null) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const clean = val.replace(/[₹$,\s]/g, '');
    const num = parseFloat(clean);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}

function normalizeSchwabAccountData(data: any) {
  const accounts = Array.isArray(data) ? data : data ? [data] : [];
  const primary = accounts[0] || {};
  const securitiesAccount = primary.securitiesAccount || primary;
  const balances = securitiesAccount.currentBalances || {};
  const positions = Array.isArray(securitiesAccount.positions) ? securitiesAccount.positions : [];

  const accountHash = primary.hashValue || primary.accountHash || securitiesAccount.accountHash || '';
  const accountNumber = primary.accountNumber || securitiesAccount.accountNumber || '';
  const availableCash = parseBrokerNumeric(
    balances.cashBalance ?? balances.availableFunds ?? balances.availableFundsNonMarginableTrade ?? balances.buyingPower ?? 0
  );
  const availableNetMargin = parseBrokerNumeric(
    balances.liquidationValue ?? balances.equity ?? balances.cashBalance ?? balances.buyingPower ?? availableCash
  );

  return {
    accountHash,
    accountNumber,
    availableCash,
    availableNetMargin,
    brokerBalances: {
      cashBalance: parseBrokerNumeric(balances.cashBalance),
      availableFunds: parseBrokerNumeric(balances.availableFunds ?? balances.availableFundsNonMarginableTrade),
      buyingPower: parseBrokerNumeric(balances.buyingPower),
      liquidationValue: parseBrokerNumeric(balances.liquidationValue),
      equity: parseBrokerNumeric(balances.equity),
    },
    holdings: positions.filter((position: any) => Number(position.longQuantity || 0) > 0),
    livePositions: positions,
  };
}

async function ensureSchwabAccessToken() {
  if (!state.schwab.linked || !state.schwab.refreshToken) {
    throw new Error('No Schwab developer session is linked.');
  }

  const tokenStillValid = state.schwab.accessToken && state.schwab.tokenExpiresAt > Date.now() + 30_000;
  if (tokenStillValid) {
    return state.schwab.accessToken;
  }

  const refreshed = await refreshSchwabAccessToken(state.schwab.refreshToken);
  state.schwab.accessToken = refreshed.accessToken;
  state.schwab.refreshToken = refreshed.refreshToken;
  state.schwab.tokenExpiresAt = Date.now() + refreshed.expiresIn * 1000;
  saveStateToDisk();
  return state.schwab.accessToken;
}

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
      if (data.schwab !== undefined) state.schwab = { ...createEmptySchwabState(), ...data.schwab };
      let healed = false;
      if (data.config !== undefined) {
        state.config = { ...state.config, ...data.config };
        if (state.config.allocation > state.paperBalance) {
          state.config.allocation = DEFAULT_ALLOCATION;
          healed = true;
        }
      }
      if ((state.schwab.mpin || state.schwab.totpSecret || state.schwab.apiKey) && !state.schwab.refreshToken) {
        state.schwab = createEmptySchwabState();
        state.config.paperMode = true;
        healed = true;
        setTimeout(() => {
          logMessage('[Schwab] Cleared legacy non-Schwab broker credentials from persisted state.');
        }, 120);
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
          const accessToken = await ensureSchwabAccessToken();
          if (accessToken && state.schwab.accountHash) {
            const exitSide = p.side === 'BUY' ? 'SELL' : 'BUY_TO_COVER';
            const quantity = Math.max(1, Math.floor((p.margin * p.leverage) / p.entryPrice));
            const orderRes = await placeSchwabOrder(
              accessToken,
              state.schwab.accountHash,
              {
                symbol: p.symbol,
                instruction: exitSide,
                quantity,
              }
            );
            logMessage(`[Schwab Gateway] 🟢 LIVE BROKER close order placed successfully! Order ID: ${orderRes.orderId}`);
          } else {
            logMessage('[Schwab Gateway] ❌ Live exit auth failed: missing linked access token or account hash.');
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
    if (!state.schwab.accountHash) {
      throw new Error('Linked Schwab session is missing an account hash. Refresh the account and try again.');
    }

    logMessage(`[Schwab Gateway] ⚡ Initializing live partner order for ${symbol}...`);
    const accessToken = await ensureSchwabAccessToken();

    const quantity = Math.max(1, Math.floor((margin * leverage) / entryPrice));
    const orderRes = await placeSchwabOrder(
      accessToken,
      state.schwab.accountHash,
      {
        symbol,
        instruction: side === 'BUY' ? 'BUY' : 'SELL_SHORT',
        quantity,
      }
    );

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
  const { accessToken, refreshToken, ...publicSchwab } = state.schwab;
  res.json({
    ...state,
    schwab: publicSchwab,
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
    if (Boolean(paperMode) === false && !state.schwab.linked) {
      return res.status(400).json({ error: 'Live production mode requires a linked Schwab developer account.' });
    }
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

app.post('/api/schwab/link', async (_req, res) => {
  return res.status(405).json({ error: 'Direct credential linking is disabled. Use /api/schwab/auth-url to start Schwab OAuth.' });
});

app.get('/api/schwab/auth-url', (_req, res) => {
  try {
    const stateToken = Math.random().toString(36).slice(2);
    const authUrl = buildSchwabAuthorizationUrl(stateToken);
    logMessage('[Schwab] Generated developer OAuth authorization URL.');
    res.json({ status: 'ok', authUrl });
  } catch (err: any) {
    res.status(400).json({ error: err.message || String(err) });
  }
});

app.get('/api/schwab/callback', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const error = typeof req.query.error === 'string' ? req.query.error : '';

  if (error) {
    logMessage(`[Schwab] OAuth callback returned error: ${error}`);
    return res.redirect(`${getAppBaseUrl()}/?schwab_error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return res.redirect(`${getAppBaseUrl()}/?schwab_error=missing_authorization_code`);
  }

  try {
    const tokens = await exchangeSchwabAuthorizationCode(code);
    const accounts = await fetchSchwabAccounts(tokens.accessToken);
    const normalized = normalizeSchwabAccountData(accounts);

    state.schwab = {
      ...createEmptySchwabState(),
      linked: true,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiresAt: Date.now() + tokens.expiresIn * 1000,
      accountHash: normalized.accountHash,
      accountNumber: normalized.accountNumber,
      clientCode: normalized.accountNumber,
      profileName: maskSchwabAccount(normalized.accountNumber),
      availableCash: normalized.availableCash,
      availableNetMargin: normalized.availableNetMargin,
      brokerBalances: normalized.brokerBalances,
      linkedAt: new Date().toLocaleDateString(),
      holdings: normalized.holdings,
      livePositions: normalized.livePositions,
    };

    state.positions = [];
    state.config.paperMode = false;
    if (normalized.availableNetMargin > 0) {
      state.paperBalance = normalized.availableNetMargin;
    }
    recalculateFinancials();
    saveStateToDisk();
    logMessage(`[Schwab] Developer account linked successfully. ${state.schwab.profileName} | Net Margin: $${normalized.availableNetMargin.toFixed(2)}`);
    res.redirect(`${getAppBaseUrl()}/?schwab=linked`);
  } catch (err: any) {
    const message = err.message || String(err);
    logMessage(`[Schwab] OAuth callback failed: ${message}`);
    res.redirect(`${getAppBaseUrl()}/?schwab_error=${encodeURIComponent(message)}`);
  }
});

app.post('/api/schwab/unlink', (req, res) => {
  logMessage(`[Schwab] Unlinked active client profile ${state.schwab.clientCode}`);
  state.schwab = createEmptySchwabState();
  state.config.paperMode = true;
  recalculateFinancials();
  saveStateToDisk();
  res.json({ status: 'ok', schwab: state.schwab });
});

app.post('/api/schwab/refresh', async (req, res) => {
  if (!state.schwab.linked) {
    return res.status(400).json({ error: 'No Schwab account linked yet.' });
  }

  logMessage(`[Schwab] Fetching refreshed balance and session diagnostics...`);

  try {
    const accessToken = await ensureSchwabAccessToken();
    const accounts = await fetchSchwabAccounts(accessToken);
    const normalized = normalizeSchwabAccountData(accounts);

    state.schwab.accountHash = normalized.accountHash;
    state.schwab.accountNumber = normalized.accountNumber;
    state.schwab.clientCode = normalized.accountNumber;
    state.schwab.profileName = maskSchwabAccount(normalized.accountNumber);
    state.schwab.availableCash = normalized.availableCash;
    state.schwab.availableNetMargin = normalized.availableNetMargin;
    state.schwab.brokerBalances = normalized.brokerBalances;
    state.schwab.holdings = normalized.holdings;
    state.schwab.livePositions = normalized.livePositions;

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
  } catch (err: any) {
    return res.status(400).json({ error: err.message || String(err) });
  }

  res.json({ status: 'ok', schwab: state.schwab });
});

app.post('/api/schwab/simulate', (req, res) => {
  if (!state.schwab.linked) {
    state.schwab = {
      ...createEmptySchwabState(),
      linked: true,
      clientCode: 'SCHWAB-DEMO',
      accountNumber: 'DEMO-ACCOUNT',
      profileName: 'Demo Wall Street Portfolio',
      email: 'demo.client@example.com',
      availableCash: 42500.0,
      availableNetMargin: 125000.0,
      brokerBalances: {
        cashBalance: 42500.0,
        availableFunds: 42500.0,
        buyingPower: 125000.0,
        liquidationValue: 125000.0,
        equity: 125000.0,
      },
      linkedAt: new Date().toLocaleDateString() + ' (Simulated)',
      accountHash: 'demo-account-hash',
    };
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
  state.paperBalance = DEFAULT_PAPER_BALANCE;
  state.config.allocation = DEFAULT_ALLOCATION;
  state.positions = [];
  state.historicalTrades = [];
  state.scanArchive = [];
  state.lastNonEmptyRanked = [];
  state.blockedSignals = [];
  state.deferredSignals = [];
  state.nearMisses = [];
  state.perSymbolRiskLocks = [];
  state.postLiquidationQueue = [];
  state.logs = [];
  logMessage(`Operator terminal reset instructions executed. Simulator reloaded to $${DEFAULT_PAPER_BALANCE.toFixed(2)} and allocation reset to $${DEFAULT_ALLOCATION.toFixed(2)}.`);
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

  const schwabRedirectUri = getSchwabRedirectUriFromEnv();
  if (schwabRedirectUri?.protocol === 'https:' && ['127.0.0.1', 'localhost'].includes(schwabRedirectUri.hostname)) {
    const httpsPort = Number(schwabRedirectUri.port || 443);
    const httpsHost = schwabRedirectUri.hostname === '127.0.0.1' ? '127.0.0.1' : '0.0.0.0';
    const httpsOptions = await buildLocalSchwabHttpsOptions();

    https.createServer(httpsOptions, app).listen(httpsPort, httpsHost, () => {
      console.log(`TradeEdge Schwab OAuth callback server running on ${schwabRedirectUri.origin}`);
    });
  } else if (process.env.SCHWAB_REDIRECT_URI) {
    logMessage('[Schwab] OAuth callback listener not started. Set SCHWAB_REDIRECT_URI to a local https:// callback such as https://127.0.0.1:3443/api/schwab/callback.');
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TradeEdge operating server up and running on port ${PORT}`);
  });
};

startServer();
