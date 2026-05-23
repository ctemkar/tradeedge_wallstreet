import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  TrendingUp,
  TrendingDown,
  ShieldAlert,
  Play,
  Pause,
  RefreshCw,
  Sliders,
  Database,
  Activity,
  Terminal,
  History,
  Unlock,
  Settings,
  Layers,
  Percent,
  Clock,
  Coins,
  Zap,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  X,
  ChevronRight,
  HelpCircle,
  Eye,
  Trash2
} from 'lucide-react';

// Interfaces mapping server-side types
interface Position {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  currentPrice: number;
  leverage: number;
  margin: number;
  size: number;
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

interface StrategyMetrics {
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
  score: number;
  strengthReasons: string[];
  blockReasons: string[];
  deferReasons: string[];
}

interface ScanSummary {
  timestamp: string;
  unix: number;
  totalMarkets: number;
  futuresUSDTCount: number;
  analyzedCount: number;
  buyCount: number;
  sellCount: number;
  holdCount: number;
  blockedCount: number;
  deferredCount: number;
  logs: string[];
}

interface ScanCycleReport {
  summary: ScanSummary;
  rankedSignals: StrategyMetrics[];
  blockedSignals: { symbol: string; reason: string }[];
  deferredSignals: { symbol: string; reason: string; price: number; score: number }[];
  nearMisses: StrategyMetrics[];
}

interface SystemState {
  botActive: boolean;
  autonomousTrading: boolean;
  lastScanTime: string;
  scanIntervalSeconds: number;
  paperBalance: number;
  freeMargin: number;
  deployableCapital: number;
  marginBufferPercent: number;
  marketMode: 'crypto' | 'us_stocks';
  config: {
    leverage: number;
    allocation: number;
    minVolume: number;
    maxClusteredPositions: number;
    preventCorrelationClustering: boolean;
    paperMode: boolean;
    scanLimit: number;
    rsiOverbought: number;
    rsiOversold: number;
    macdFast: number;
    macdSlow: number;
    macdSignal: number;
    liveUniverseString?: string;
    schwabProductType?: 'INTRADAY' | 'DELIVERY';
  };
  schwab?: {
    linked: boolean;
    clientCode: string;
    apiKey?: string;
    mpin?: string;
    totpSecret?: string;
    profileName?: string;
    email?: string;
    availableCash?: number;
    availableNetMargin?: number;
    brokerBalances?: {
      cashBalance?: number;
      availableFunds?: number;
      buyingPower?: number;
      liquidationValue?: number;
      equity?: number;
    };
    linkedAt?: string;
    holdings?: any[];
    livePositions?: any[];
    mutualFunds?: any[];
  };
  positions: Position[];
  historicalTrades: HistoricalTrade[];
  logs: string[];
  scanArchive: ScanCycleReport[];
  lastNonEmptyRanked: StrategyMetrics[];
  blockedSignals: { symbol: string; reason: string }[];
  deferredSignals: { symbol: string; reason: string; price: number; score: number }[];
  nearMisses: StrategyMetrics[];
  perSymbolRiskLocks: string[];
  scanningInProgress?: boolean;
  postLiquidationQueue?: { symbol: string; timestamp: string }[];
}

interface CandleKlines {
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
}

export default function App() {
  // Console system state
  const [state, setState] = useState<SystemState | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('AAPL');
  const [chartData, setChartData] = useState<CandleKlines | null>(null);
  const [chartLoading, setChartLoading] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeTab, setActiveTab] = useState<string>('positions');
  const [showConfigPanel, setShowConfigPanel] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [successMessage, setSuccessMessage] = useState<string>('');
  const [showResetConfirm, setShowResetConfirm] = useState<boolean>(false);
  const [onlineStatus, setOnlineStatus] = useState<boolean>(true);

  // Schwab State Hooks
  const [showAngelModal, setShowAngelModal] = useState<boolean>(false);
  const [angelClientCode, setAngelClientCode] = useState<string>('');
  const [angelApiKey, setAngelApiKey] = useState<string>('');
  const [angelMpin, setAngelMpin] = useState<string>('');
  const [angelTotpSecret, setAngelTotpSecret] = useState<string>('');
  const [angelLoading, setAngelLoading] = useState<boolean>(false);
  const [angelError, setAngelError] = useState<string>('');
  const [hasAutoRefreshed, setHasAutoRefreshed] = useState<boolean>(false);
  const [hasAutoRestored, setHasAutoRestored] = useState<boolean>(false);
  const [angelTab, setAngelTab] = useState<'holdings' | 'positions' | 'settings'>('holdings');
  const schwabOAuthLinkAvailable = true;

  // Quick execution desk values
  const [tradeMargin, setTradeMargin] = useState<number>(200);
  const [tradeLeverage, setTradeLeverage] = useState<number>(1);
  const [manualOverrideBox, setManualOverrideBox] = useState<boolean>(true);

  // Configuration edit variables
  const [editLeverage, setEditLeverage] = useState<number>(1);
  const [editAllocation, setEditAllocation] = useState<number>(200);
  const [editMinVolume, setEditMinVolume] = useState<number>(1000000);
  const [editMarginBuffer, setEditMarginBuffer] = useState<number>(10);
  const [editScanInterval, setEditScanInterval] = useState<number>(60);
  const [editMaxCluster, setEditMaxCluster] = useState<number>(3);
  const [editPreventCluster, setEditPreventCluster] = useState<boolean>(true);
  const [editScanLimit, setEditScanLimit] = useState<number>(120);
  const [editMarketMode, setEditMarketMode] = useState<'crypto' | 'us_stocks'>('us_stocks');
  const [editPaperMode, setEditPaperMode] = useState<boolean>(true);
  const [editLiveUniverseString, setEditLiveUniverseString] = useState<string>('*');
  const [editPaperBalance, setEditPaperBalance] = useState<number>(1000);
  const [editAngelProductType, setEditAngelProductType] = useState<'INTRADAY' | 'DELIVERY'>('INTRADAY');

  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const lastLogMsgRef = useRef<string>('');

  const isWallStreet = state?.marketMode === 'us_stocks';
  const isCrypto = state?.marketMode === 'crypto';

  const cSign = '$';
  const cName = isWallStreet ? 'USD' : 'USDT';

  const formatNumber = (num: number | undefined | null, maxDecimals = 2, minDecimals = 2) => {
    if (num === null || num === undefined || isNaN(num)) return '0.00';
    return num.toLocaleString('en-US', {
      minimumFractionDigits: minDecimals,
      maximumFractionDigits: maxDecimals
    });
  };

  const unrealizedPnLSum = state ? state.positions.reduce((acc, p) => acc + p.unrealizedPnl, 0) : 0;
  const netEquity = state ? state.paperBalance + unrealizedPnLSum : 0;
  const capitalReturnPercent = state && state.paperBalance > 0 ? (unrealizedPnLSum / state.paperBalance) * 100 : 0;
  const showSchwabBalances = Boolean(state?.schwab?.linked && isWallStreet);
  const schwabBalances = state?.schwab?.brokerBalances;
  const displayedNetEquity = showSchwabBalances
    ? (schwabBalances?.liquidationValue || schwabBalances?.equity || state?.schwab?.availableNetMargin || 0)
    : netEquity;
  const displayedCashBase = showSchwabBalances
    ? (schwabBalances?.cashBalance || state?.schwab?.availableCash || 0)
    : (state?.paperBalance || 0);
  const displayedAvailableMargin = showSchwabBalances
    ? (schwabBalances?.buyingPower || schwabBalances?.availableFunds || state?.schwab?.availableNetMargin || 0)
    : (state?.freeMargin || 0);
  const lowMarginWarning = showSchwabBalances
    ? displayedAvailableMargin < (displayedCashBase * 0.2)
    : Boolean(state && state.freeMargin < (state.paperBalance * 0.2));

  // Setup periodic state polling and triggers
  useEffect(() => {
    fetchState();
    const interval = setInterval(() => {
      fetchState();
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  // Auto-restore Schwab link if container state was reset but browser has credentials
  useEffect(() => {
    if (!schwabOAuthLinkAvailable) {
      return;
    }
    if (state && !state.schwab?.linked && !hasAutoRestored) {
      setHasAutoRestored(true);
      localStorage.removeItem('schwab_clientCode');
      localStorage.removeItem('schwab_apiKey');
      localStorage.removeItem('schwab_mpin');
      localStorage.removeItem('schwab_totpSecret');
      localStorage.removeItem('angel_clientCode');
      localStorage.removeItem('angel_apiKey');
      localStorage.removeItem('angel_mpin');
      localStorage.removeItem('angel_totpSecret');
    }
  }, [state, hasAutoRestored]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const schwabStatus = params.get('schwab');
    const schwabError = params.get('schwab_error');

    if (schwabStatus === 'linked') {
      flashMessage('Schwab developer account linked successfully.', 'success');
      fetchState();
    } else if (schwabError) {
      flashMessage(`Schwab link failed: ${schwabError}`, 'error');
    }

    if (schwabStatus || schwabError) {
      params.delete('schwab');
      params.delete('schwab_error');
      const nextQuery = params.toString();
      const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}`;
      window.history.replaceState({}, '', nextUrl);
    }
  }, []);

  // Auto-sync account balance quietly once if Schwab is linked
  useEffect(() => {
    if (state?.schwab?.linked && !hasAutoRefreshed) {
      setHasAutoRefreshed(true);
      fetch('/api/schwab/refresh', { method: 'POST' })
        .then((res) => {
          if (res.ok) {
            fetchState();
          }
        })
        .catch(() => {});
    }
  }, [state?.schwab?.linked, hasAutoRefreshed]);

  // Fetch candle data for selected asset whenever selection updates
  useEffect(() => {
    if (selectedSymbol) {
      loadCandlesForAsset(selectedSymbol);
    }
  }, [selectedSymbol]);

  // Sync edit configurations when state payload is retrieved
  useEffect(() => {
    if (state) {
      setEditLeverage(state.config.leverage);
      setEditAllocation(state.config.allocation);
      setEditMinVolume(state.config.minVolume);
      setEditMarginBuffer(state.marginBufferPercent);
      setEditScanInterval(state.scanIntervalSeconds);
      setEditMaxCluster(state.config.maxClusteredPositions);
      setEditPreventCluster(state.config.preventCorrelationClustering);
      setEditScanLimit(state.config.scanLimit);
      setEditPaperMode(state.config.paperMode ?? true);
      if (state.config.schwabProductType) {
        setEditAngelProductType(state.config.schwabProductType);
      }
      if (state.paperBalance !== undefined) {
        setEditPaperBalance(state.paperBalance);
      }
      if (state.marketMode) {
        setEditMarketMode(state.marketMode);
      }
      if (state.config.liveUniverseString !== undefined) {
        setEditLiveUniverseString(state.config.liveUniverseString);
      }
    }
  }, [state]);

  // Adjust selected symbol if it is not in the active search candidates
  useEffect(() => {
    if (state) {
      const tickers = getSearchTickersList();
      if (tickers.length > 0 && !tickers.some(t => t.symbol === selectedSymbol)) {
        setSelectedSymbol(tickers[0].symbol);
      }
    }
  }, [state?.marketMode, state?.lastNonEmptyRanked]);

  // Scroll terminal logs container to the bottom on new additions if user is near bottom
  useEffect(() => {
    const latestLog = state?.logs && state.logs.length > 0 ? state.logs[0] : '';
    if (latestLog && latestLog !== lastLogMsgRef.current) {
      const container = logsContainerRef.current;
      if (container) {
        // Check if user is near bottom (say, within 60px of the absolute bottom)
        const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= 60;
        if (isNearBottom || lastLogMsgRef.current === '') {
          setTimeout(() => {
            logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
          }, 30);
        }
      }
      lastLogMsgRef.current = latestLog;
    }
  }, [state?.logs]);

  // Utility triggers
  const fetchState = async () => {
    try {
      const res = await fetch('/api/state');
      if (!res.ok) throw new Error('API communication offline');
      const data = await res.json();
      setState(data);
      setOnlineStatus(true);
    } catch (err) {
      setOnlineStatus(false);
    }
  };

  const loadCandlesForAsset = async (symbol: string) => {
    setChartLoading(true);
    try {
      const res = await fetch(`/api/candles?symbol=${symbol}`);
      if (!res.ok) throw new Error('Candles loading failed');
      const data = await res.json();
      setChartData(data);
    } catch (err) {
      console.error(err);
      setChartData(null);
    } finally {
      setChartLoading(false);
    }
  };

  const triggerManualScan = async () => {
    flashMessage('Triggering instant discovery scan...', 'success');
    try {
      await fetch('/api/scan', { method: 'POST' });
      // Instant reload trigger
      setTimeout(fetchState, 1000);
    } catch (err) {
      flashMessage('Failed to trigger scan.', 'error');
    }
  };

  const toggleAutonomousTrading = async () => {
    if (!state) return;
    const target = !state.autonomousTrading;
    flashMessage(`Switching Autonomous Mode to ${target ? 'ACTIVE' : 'PAUSED'}...`, 'success');
    submitConfigChanges({ autonomousTrading: target });
  };

  const togglePaperMode = async () => {
    if (!state) return;
    const target = !state.config.paperMode;

    if (!target && !state.schwab?.linked) {
      flashMessage('Live production mode requires a linked Schwab account first.', 'error');
      setShowAngelModal(true);
      return;
    }

    flashMessage(`Switching Engine to ${target ? 'PAPER SIMULATION' : 'LIVE PRODUCTION'} Mode...`, 'success');
    submitConfigChanges({ paperMode: target });
  };

  const submitConfigChanges = async (updates: any) => {
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update setup.');
      setState(data.state);
      flashMessage('System parameter profiles updated.', 'success');
    } catch (err: any) {
      flashMessage(err.message || 'Error updating rules', 'error');
    }
  };

  const executeOrder = async (side: 'BUY' | 'SELL', symbol: string) => {
    if (!state) return;
    const priceInfo = getPriceForSymbol(symbol);
    if (!priceInfo) {
      flashMessage('Asset Price not captured. Refusing execution.', 'error');
      return;
    }

    const payload = {
      symbol,
      side,
      price: priceInfo,
      margin: tradeMargin,
      leverage: tradeLeverage,
      isManual: true,
      overrideBlock: manualOverrideBox,
    };

    try {
      const res = await fetch('/api/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Execution refused');
      }

      flashMessage(`Success: Submitted ${side} order onto exchange proxy!`, 'success');
      fetchState();
    } catch (err: any) {
      flashMessage(err.message || 'Execution failed', 'error');
    }
  };

  const executePositionClose = async (id: string, symbol: string) => {
    try {
      const res = await fetch('/api/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error('Could not close position.');
      flashMessage(`Position for ${symbol} closed realized!`, 'success');
      fetchState();
    } catch (err: any) {
      flashMessage(err.message || 'Error closing position', 'error');
    }
  };

  const clearRiskCooldown = async (symbol?: string) => {
    try {
      await fetch('/api/clear-cooldown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      });
      flashMessage(symbol ? `Risk lock cleared for ${symbol}` : 'All active cooldowns cleared.', 'success');
      fetchState();
    } catch (err) {
      flashMessage('Communication error clearing locks.', 'error');
    }
  };

  const executeHardReset = async () => {
    try {
      await fetch('/api/reset', { method: 'POST' });
      flashMessage('System console factory reset complete.', 'success');
      setShowResetConfirm(false);
      fetchState();
    } catch (err) {
      flashMessage('Error performing terminal resets.', 'error');
    }
  };

  // Synchronously pre-populate Schwab input fields from saved credentials
  useEffect(() => {
    if (state?.schwab?.linked) {
      setAngelClientCode(state.schwab.clientCode || '');
      setAngelApiKey(state.schwab.apiKey || '');
      setAngelMpin(state.schwab.mpin || '');
      setAngelTotpSecret(state.schwab.totpSecret || '');
    }
  }, [state?.schwab]);

  const linkAngelAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setAngelError('');
    setAngelLoading(true);
    try {
      const res = await fetch('/api/schwab/auth-url');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to initialize Schwab OAuth');
      }
      window.location.href = data.authUrl;
    } catch (err: any) {
      setAngelError(err.message || 'Operation failed');
    } finally {
      setAngelLoading(false);
    }
  };

  const unlinkAngelAccount = async () => {
    setAngelLoading(true);
    setAngelError('');
    try {
      const res = await fetch('/api/schwab/unlink', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to unlink');

      // Purge cached storage credentials
      localStorage.removeItem('schwab_clientCode');
      localStorage.removeItem('schwab_apiKey');
      localStorage.removeItem('schwab_mpin');
      localStorage.removeItem('schwab_totpSecret');

      flashMessage('Schwab account unlinked and credentials removed from browser storage.', 'success');
      setAngelClientCode('');
      setAngelApiKey('');
      setAngelMpin('');
      setAngelTotpSecret('');
      setShowAngelModal(false);
      fetchState();
    } catch (err: any) {
      setAngelError(err.message || 'Unlink failed');
    } finally {
      setAngelLoading(false);
    }
  };

  const refreshAngelBalance = async () => {
    setAngelLoading(true);
    setAngelError('');
    try {
      const res = await fetch('/api/schwab/refresh', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to refresh limits');
      flashMessage(`Balances synced. Live broker limit: ${cSign}${formatNumber(data.schwab.availableNetMargin)}`, 'success');
      fetchState();
    } catch (err: any) {
      flashMessage(`Balance refresh failed: ${err.message}`, 'error');
    } finally {
      setAngelLoading(false);
    }
  };

  const flashMessage = (msg: string, type: 'success' | 'error') => {
    if (type === 'success') {
      setSuccessMessage(msg);
      setTimeout(() => setSuccessMessage(''), 4000);
    } else {
      setErrorMessage(msg);
      setTimeout(() => setErrorMessage(''), 4000);
    }
  };

  const getPriceForSymbol = (symbol: string): number => {
    if (!state) return 0;
    const rankedItem = state.lastNonEmptyRanked.find(p => p.symbol === symbol);
    if (rankedItem) return rankedItem.price;

    const nearItem = state.nearMisses.find(p => p.symbol === symbol);
    if (nearItem) return nearItem.price;

    const deferredItem = state.deferredSignals.find(p => p.symbol === symbol);
    if (deferredItem) return deferredItem.price;

    return 0;
  };

  // Processing Search Candidates Tickers
  const getSearchTickersList = () => {
    if (!state) return [];
    
    // Merge everything available so nothing is invisible
    const pool = new Map<string, { symbol: string; price: number; dir?: string; text: string; score?: number }>();
    
    // 1. Add ranked
    state.lastNonEmptyRanked.forEach(r => {
      pool.set(r.symbol, { symbol: r.symbol, price: r.price, dir: r.direction, text: 'TOP RANKED', score: r.score });
    });

    // 2. Add near misses
    state.nearMisses.forEach(nm => {
      pool.set(nm.symbol, { symbol: nm.symbol, price: nm.price, dir: 'HOLD', text: 'NEAR MISS', score: nm.score });
    });

    // 3. Add deferred
    state.deferredSignals.forEach(d => {
      if (!pool.has(d.symbol)) {
        pool.set(d.symbol, { symbol: d.symbol, price: d.price, dir: 'HOLD', text: 'DEFERRED', score: d.score });
      }
    });

    const list = Array.from(pool.values());
    if (!searchQuery) return list;

    return list.filter(item => item.symbol.toLowerCase().includes(searchQuery.toLowerCase()));
  };

  // Helper calculation for custom SVG candlestick and indicators chart
  const renderSVGTechnicalChart = () => {
    if (chartLoading) {
      return (
        <div className="h-full flex flex-col justify-center items-center text-zinc-500 py-12 bg-[#0d0e12] rounded border border-zinc-900 font-mono text-xs">
          <RefreshCw className="w-6 h-6 animate-spin mb-2 text-indigo-500" />
          PARSING BLOCK KLINE ARRAYS...
        </div>
      );
    }

    if (!chartData || !chartData.close || chartData.close.length === 0) {
      return (
        <div className="h-full flex flex-col justify-center items-center text-zinc-500 py-12 bg-[#0d0e12] rounded border border-zinc-900 font-mono text-xs text-center p-4">
          <AlertTriangle className="w-8 h-8 text-amber-500 mb-2" />
          KLINE HISTORICAL STREAMS UNAVAILABLE FOR {selectedSymbol}
          <p className="mt-1 text-[10px] text-zinc-600">Exchange API limited or initializing. Click trigger manual scan above to sync.</p>
        </div>
      );
    }

    const len = chartData.close.length;
    
    // We render the last 60 candles for visual clarity
    const displaySize = Math.min(60, len);
    const startIdx = len - displaySize;

    const closes = chartData.close.slice(startIdx);
    const opens = chartData.open.slice(startIdx);
    const highs = chartData.high.slice(startIdx);
    const lows = chartData.low.slice(startIdx);
    const volumes = chartData.volume.slice(startIdx);

    // Calculate EMAs locally for indicator lines
    // EMA-12 / EMA-26 to match MACD
    const calculateLocalEMA = (prices: number[], period: number): number[] => {
      const k = 2 / (period + 1);
      const ema: number[] = [];
      let lastVal = prices[0];
      ema.push(lastVal);
      for (let i = 1; i < prices.length; i++) {
        lastVal = prices[i] * k + lastVal * (1 - k);
        ema.push(lastVal);
      }
      return ema;
    };

    const ema50 = calculateLocalEMA(chartData.close, 50).slice(startIdx);
    const ema200 = calculateLocalEMA(chartData.close, 100).slice(startIdx); // 100 for shorter viz representation

    // Calculate MACD locally
    const fastEma = calculateLocalEMA(chartData.close, 12);
    const slowEma = calculateLocalEMA(chartData.close, 26);
    const macdLine: number[] = [];
    for (let i = 0; i < len; i++) {
       macdLine.push(fastEma[i] - slowEma[i]);
    }
    const signalLine = calculateLocalEMA(macdLine, 9);
    const macdHist: number[] = [];
    for (let i = 0; i < len; i++) {
      macdHist.push(macdLine[i] - signalLine[i]);
    }

    const dMacdLine = macdLine.slice(startIdx);
    const dSignalLine = signalLine.slice(startIdx);
    const dMacdHist = macdHist.slice(startIdx);

    // Calculate RSI locally
    const rsiLocal = (prices: number[]): number[] => {
      if (prices.length < 14) return Array(prices.length).fill(50);
      const r: number[] = [];
      const gains: number[] = [];
      const losses: number[] = [];
      for (let i = 1; i < prices.length; i++) {
        const d = prices[i] - prices[i-1];
        gains.push(d > 0 ? d : 0);
        losses.push(d < 0 ? -d : 0);
      }
      let avgG = gains.slice(0, 14).reduce((a, b) => a + b, 0) / 14;
      let avgL = losses.slice(0, 14).reduce((a, b) => a + b, 0) / 14;
      for (let i = 0; i <= 14; i++) r.push(50);
      for (let i = 15; i < prices.length; i++) {
        avgG = (avgG * 13 + gains[i-1]) / 14;
        avgL = (avgL * 13 + losses[i-1]) / 14;
        const rs = avgL === 0 ? 100 : avgG / avgL;
        r.push(100 - (100 / (1 + rs)));
      }
      return r;
    };
    const dRsi = rsiLocal(chartData.close).slice(startIdx);

    // Grid measurements
    const width = 850;
    const mainHeight = 190;
    const volumeHeight = 50;
    const macdHeight = 80;
    const rsiHeight = 80;
    const gap = 12;
    const totalHeight = mainHeight + volumeHeight + macdHeight + rsiHeight + gap * 3;

    // Price scales
    const minPrice = Math.min(...lows) * 0.998;
    const maxPrice = Math.max(...highs) * 1.002;
    const priceDiff = maxPrice - minPrice;

    const getPriceY = (val: number) => {
      return mainHeight - ((val - minPrice) / priceDiff) * mainHeight;
    };

    // Volume scales
    const maxVol = Math.max(...volumes) || 1;
    const getVolY = (val: number) => {
      return (mainHeight + gap + volumeHeight) - (val / maxVol) * volumeHeight;
    };

    // MACD scales
    const extremes = [...dMacdLine, ...dSignalLine, ...dMacdHist];
    const absMaxMacd = Math.max(...extremes.map(v => Math.abs(v))) || 0.0001;
    const getMacdY = (val: number) => {
      const originY = mainHeight + volumeHeight + gap * 2 + macdHeight / 2;
      return originY - (val / absMaxMacd) * (macdHeight / 2);
    };

    // RSI scales
    const getRsiY = (val: number) => {
      const topY = mainHeight + volumeHeight + macdHeight + gap * 3;
      return topY + rsiHeight - (val / 100) * rsiHeight;
    };

    // Horizontal candles index stepping
    const candleWidth = (width - 60) / displaySize;
    const getXIdx = (i: number) => {
      return i * candleWidth + 10;
    };

    // Grab cached S/R for current selections
    const targetSnapshot = state?.lastNonEmptyRanked.find(p => p.symbol === selectedSymbol) ||
                           state?.nearMisses.find(p => p.symbol === selectedSymbol);
    const supportVal = targetSnapshot ? targetSnapshot.support : minPrice * 1.01;
    const resistanceVal = targetSnapshot ? targetSnapshot.resistance : maxPrice * 0.99;

    return (
      <div className="bg-[#090a0f] p-3 rounded-lg border border-zinc-900" id="technical_studio_chart">
        <div className="flex justify-between items-center mb-1 text-[11px] text-zinc-400 font-mono px-1">
          <div className="flex items-center gap-3">
            <span className="font-bold text-zinc-100">{selectedSymbol} <span className="text-zinc-500 font-normal">1H Candlesticks</span></span>
            <span className="text-emerald-500">EMA50: <span className="font-semibold text-emerald-400 font-mono">{ema50[ema50.length - 1]?.toFixed(2)}</span></span>
            <span className="text-indigo-400">EMA200: <span className="font-semibold text-indigo-300 font-mono">{ema200[ema200.length - 1]?.toFixed(2)}</span></span>
          </div>
          <div className="flex gap-2 text-[10px]">
            <span className="text-rose-500">RESIST: {resistanceVal.toFixed(2)}</span>
            <span className="text-teal-400">SUPPORT: {supportVal.toFixed(2)}</span>
          </div>
        </div>

        <svg viewBox={`0 0 ${width} ${totalHeight}`} className="w-full bg-[#06070a] rounded overflow-visible select-none">
          {/* Main Price grid lines */}
          <line x1="10" y1={getPriceY(minPrice)} x2={width - 50} y2={getPriceY(minPrice)} stroke="#121520" strokeDasharray="2,2" />
          <line x1="10" y1={getPriceY((minPrice + maxPrice)/2)} x2={width - 50} y2={getPriceY((minPrice + maxPrice)/2)} stroke="#121520" strokeDasharray="2,2" />
          <line x1="10" y1={getPriceY(maxPrice)} x2={width - 50} y2={getPriceY(maxPrice)} stroke="#121520" strokeDasharray="2,2" />

          {/* S & R lines overlay */}
          {supportVal > 0 && (
            <g>
              <line x1="10" y1={getPriceY(supportVal)} x2={width - 50} y2={getPriceY(supportVal)} stroke="rgba(45, 212, 191, 0.45)" strokeWidth="1.2" strokeDasharray="4,4" />
              <text x={width-48} y={getPriceY(supportVal) + 3} className="text-[9px] fill-teal-400 font-mono">SUP</text>
            </g>
          )}
          {resistanceVal > 0 && (
            <g>
              <line x1="10" y1={getPriceY(resistanceVal)} x2={width - 50} y2={getPriceY(resistanceVal)} stroke="rgba(244, 63, 94, 0.45)" strokeWidth="1.2" strokeDasharray="4,4" />
              <text x={width-48} y={getPriceY(resistanceVal) + 3} className="text-[9px] fill-rose-500 font-mono">RES</text>
            </g>
          )}

          {/* Render EMA lines */}
          {(() => {
            let dEma50 = '';
            let dEma200 = '';
            for (let i = 0; i < displaySize; i++) {
              const cx = getXIdx(i) + candleWidth / 2;
              const cy50 = getPriceY(ema50[i]);
              const cy200 = getPriceY(ema200[i]);
              if (i === 0) {
                dEma50 = `M ${cx} ${cy50}`;
                dEma200 = `M ${cx} ${cy200}`;
              } else {
                dEma50 += ` L ${cx} ${cy50}`;
                dEma200 += ` L ${cx} ${cy200}`;
              }
            }
            return (
              <g>
                <path d={dEma50} fill="none" stroke="#10b981" strokeWidth="1.2" opacity="0.8" />
                <path d={dEma200} fill="none" stroke="#6366f1" strokeWidth="1.2" opacity="0.7" />
              </g>
            );
          })()}

          {/* Candlesticks & Volume graphics */}
          {closes.map((close, i) => {
            const open = opens[i];
            const high = highs[i];
            const low = lows[i];
            const vol = volumes[i];

            const isBullish = close >= open;
            const strokeColor = isBullish ? '#10b981' : '#f43f5e';
            const fillColor = isBullish ? '#10b981' : '#f43f5e';

            const cx = getXIdx(i) + candleWidth / 2;
            const topY = getPriceY(Math.max(open, close));
            const bottomY = getPriceY(Math.min(open, close));
            const bodyH = Math.max(1.5, bottomY - topY);

            const volY = getVolY(vol);
            const volBot = mainHeight + gap + volumeHeight;

            return (
              <g key={i}>
                {/* Candle body wick */}
                <line x1={cx} y1={getPriceY(high)} x2={cx} y2={getPriceY(low)} stroke={strokeColor} strokeWidth="1" />
                {/* Candle body block */}
                <rect
                  x={getXIdx(i) + 1.5}
                  y={topY}
                  width={Math.max(1.5, candleWidth - 3)}
                  height={bodyH}
                  fill={fillColor}
                  stroke={strokeColor}
                  strokeWidth="0.5"
                />
                {/* Volume bar chart */}
                <rect
                  x={getXIdx(i) + 1.5}
                  y={volY}
                  width={Math.max(1.5, candleWidth - 3)}
                  height={Math.max(1, volBot - volY)}
                  fill={isBullish ? 'rgba(16, 185, 129, 0.22)' : 'rgba(244, 63, 94, 0.22)'}
                />
              </g>
            );
          })}

          {/* MACD Pane Grid */}
          <line x1="10" y1={getMacdY(0)} x2={width - 50} y2={getMacdY(0)} stroke="#202435" />
          <line x1="10" y1={getMacdY(absMaxMacd)} x2={width - 50} y2={getMacdY(absMaxMacd)} stroke="#121520" strokeDasharray="1,2" />
          <line x1="10" y1={getMacdY(-absMaxMacd)} x2={width - 50} y2={getMacdY(-absMaxMacd)} stroke="#121520" strokeDasharray="1,2" />
          
          {/* Render MACD Histogram bars & lines */}
          {dMacdHist.map((hist, i) => {
            const isPos = hist >= 0;
            const hColor = isPos ? 'rgba(16, 185, 129, 0.65)' : 'rgba(244, 63, 94, 0.65)';
            const cx = getXIdx(i) + candleWidth / 2;
            const zeroY = getMacdY(0);
            const hY = getMacdY(hist);
            return (
              <rect
                key={i}
                x={getXIdx(i) + 2}
                y={isPos ? hY : zeroY}
                width={Math.max(1, candleWidth - 4)}
                height={Math.max(1, Math.abs(zeroY - hY))}
                fill={hColor}
              />
            );
          })}

          {/* MACD Line & Signal Line drawings */}
          {(() => {
            let dMacd = '';
            let dSignal = '';
            for (let i = 0; i < displaySize; i++) {
              const cx = getXIdx(i) + candleWidth / 2;
              const macdY = getMacdY(dMacdLine[i]);
              const sigY = getMacdY(dSignalLine[i]);
              if (i === 0) {
                dMacd = `M ${cx} ${macdY}`;
                dSignal = `M ${cx} ${sigY}`;
              } else {
                dMacd += ` L ${cx} ${macdY}`;
                dSignal += ` L ${cx} ${sigY}`;
              }
            }
            return (
              <g>
                <path d={dMacd} fill="none" stroke="#3b82f6" strokeWidth="1.2" />
                <path d={dSignal} fill="none" stroke="#f59e0b" strokeWidth="1" />
              </g>
            );
          })()}

          {/* RSI Pane Grid & Oversold/Overbought boundaries */}
          <line x1="10" y1={getRsiY(30)} x2={width - 50} y2={getRsiY(30)} stroke="rgba(45, 212, 191, 0.25)" strokeDasharray="2,2" />
          <line x1="10" y1={getRsiY(70)} x2={width - 50} y2={getRsiY(70)} stroke="rgba(244, 63, 94, 0.25)" strokeDasharray="2,2" />
          <line x1="10" y1={getRsiY(50)} x2={width - 50} y2={getRsiY(50)} stroke="#121520" />
          
          <text x={width-48} y={getRsiY(70) + 3} className="text-[8px] fill-rose-500 opacity-60 font-mono">70 OB</text>
          <text x={width-48} y={getRsiY(30) + 3} className="text-[8px] fill-teal-400 opacity-60 font-mono">30 OS</text>
          <text x={width-48} y={getRsiY(50) + 3} className="text-[8px] fill-zinc-500 opacity-50 font-mono">50 MID</text>

          {/* RSI Path drawing */}
          {(() => {
            let dRsiPath = '';
            for (let i = 0; i < displaySize; i++) {
              const cx = getXIdx(i) + candleWidth / 2;
              const rsiY = getRsiY(dRsi[i]);
              if (i === 0) {
                dRsiPath = `M ${cx} ${rsiY}`;
              } else {
                dRsiPath += ` L ${cx} ${rsiY}`;
              }
            }
            return (
              <path d={dRsiPath} fill="none" stroke="#a855f7" strokeWidth="1.2" />
            );
          })()}

          {/* AXIS Price markers */}
          <text x={width - 48} y={getPriceY(maxPrice) + 8} className="text-[9px] fill-zinc-400 font-mono">{cSign}{formatNumber(maxPrice, 0, 0)}</text>
          <text x={width - 48} y={getPriceY((minPrice+maxPrice)/2)} className="text-[9px] fill-zinc-400 font-mono">{cSign}{formatNumber((minPrice+maxPrice)/2, 0, 0)}</text>
          <text x={width - 48} y={getPriceY(minPrice) - 3} className="text-[9px] fill-zinc-400 font-mono">{cSign}{formatNumber(minPrice, 0, 0)}</text>

          {/* Section labels */}
          <text x="14" y="24" className="text-[9px] font-bold fill-zinc-500 tracking-wider font-mono uppercase">PRICE {cName}</text>
          <text x="14" y={mainHeight + 12} className="text-[9px] font-bold fill-zinc-500 tracking-wider font-mono uppercase">VOLUME</text>
          <text x="14" y={mainHeight + volumeHeight + gap + 14} className="text-[9px] font-bold fill-zinc-500 tracking-wider font-mono uppercase">MACD CONVERGENCE</text>
          <text x="14" y={mainHeight + volumeHeight + macdHeight + gap * 2 + 14} className="text-[9px] font-bold fill-zinc-500 tracking-wider font-mono uppercase">RSI STREAM (14)</text>
        </svg>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#06070a] text-zinc-100 flex flex-col font-sans selection:bg-[#fbbf24] selection:text-black antialiased">
      {/* ERROR / SUCCESS ALERTS */}
      <AnimatePresence>
        {errorMessage && (
          <motion.div
            initial={{ opacity: 0, y: -40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -40 }}
            id="error_bar"
            className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 bg-rose-950 border border-rose-500 text-rose-200 px-4 py-3 rounded shadow-2xl flex items-center gap-2 text-xs font-mono font-medium max-w-lg"
          >
            <ShieldAlert className="w-4 h-4 text-rose-400 flex-shrink-0" />
            {errorMessage}
            <button onClick={() => setErrorMessage('')} className="ml-auto text-rose-400 hover:text-white"><X className="w-3 h-3" /></button>
          </motion.div>
        )}
        {successMessage && (
          <motion.div
            initial={{ opacity: 0, y: -40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -40 }}
            id="success_bar"
            className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 bg-teal-950 border border-teal-500 text-teal-200 px-4 py-3 rounded shadow-2xl flex items-center gap-2 text-xs font-mono font-medium max-w-lg"
          >
            <CheckCircle2 className="w-4 h-4 text-teal-400 flex-shrink-0" />
            {successMessage}
            <button onClick={() => setSuccessMessage('')} className="ml-auto text-teal-400 hover:text-white"><X className="w-3 h-3" /></button>
          </motion.div>
        )}
        {showResetConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            id="reset_confirm_modal_overlay"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4"
          >
            <motion.div
              initial={{ scale: 0.95, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.95, y: 20, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 350 }}
              id="reset_confirm_modal"
              className="bg-[#0b0d13] border border-rose-500/40 rounded-lg p-6 max-w-md w-full shadow-2xl relative overflow-hidden text-left"
            >
              {/* TOP PATTERN DECORATOR */}
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-rose-505 to-amber-500" />
              
              <div className="flex items-start gap-3.5 mt-2">
                <div className="p-2.5 rounded-md bg-rose-500/10 text-rose-400 mt-0.5 border border-rose-500/20">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-zinc-100 font-mono font-bold tracking-tight text-sm uppercase">
                    Confirm Hard Reset Simulation
                  </h3>
                  <p className="text-xs text-zinc-400 font-sans mt-2 leading-relaxed">
                    This action will permanently wipe all active data partitions and execute the following:
                  </p>
                  
                  <ul className="text-[11px] font-mono text-zinc-500 space-y-1 mt-3 bg-zinc-950/60 p-2.5 rounded border border-zinc-900 leading-normal">
                    <li className="flex items-center gap-1.5">
                      <span className="text-rose-500 font-bold">•</span>
                      Restore simulator capital to <span className="text-zinc-300">{cSign}{formatNumber(1000, 2, 2)}</span>
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className="text-rose-500 font-bold">•</span>
                      Release and terminate all active positions
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className="text-rose-500 font-bold">•</span>
                      Purge entire log console database activity feed
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className="text-rose-500 font-bold">•</span>
                      Flush the closed ledger and historic trade archives
                    </li>
                  </ul>
                  
                  <p className="text-[10px] text-rose-400 font-mono mt-3 uppercase tracking-wide font-bold">
                    ⚠️ Caution: This process cannot be undone!
                  </p>
                </div>
              </div>

              {/* ACTION FOOTER */}
              <div className="flex items-center justify-end gap-2.5 mt-6 border-t border-zinc-900 pt-4 font-mono text-xs">
                <button
                  type="button"
                  onClick={() => setShowResetConfirm(false)}
                  className="bg-zinc-900 hover:bg-zinc-805 border border-zinc-800 text-zinc-400 hover:text-white px-4 py-2 rounded transition cursor-pointer"
                >
                  ABORT / CANCEL
                </button>
                <button
                  type="button"
                  onClick={executeHardReset}
                  className="bg-rose-950/90 hover:bg-rose-900 border border-rose-500/60 hover:border-rose-400 text-rose-200 hover:text-white px-4 py-2 rounded font-bold transition shadow-[0_0_15px_rgba(239,68,68,0.15)] flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  YES, RESET SYSTEM
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {showAngelModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            id="angel_modal_overlay"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-md p-4"
          >
            <motion.div
              initial={{ scale: 0.95, y: 15, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.95, y: 15, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 350 }}
              id="angel_modal_box"
              className="bg-[#0b0d13] border border-blue-500/30 rounded-lg p-6 max-w-xl w-full shadow-2xl relative overflow-hidden text-left"
            >
              {/* TOP PATTERN DECORATOR */}
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 to-indigo-500" />
              
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-2">
                  <Unlock className="w-5 h-5 text-blue-400" />
                  <h3 className="text-zinc-100 font-mono font-bold tracking-tight text-sm uppercase">
                    Schwab Broker Connection
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAngelModal(false)}
                  className="text-zinc-500 hover:text-white p-1 rounded-full hover:bg-zinc-900 transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {state?.schwab?.linked ? (
                /* LINKED STATS AND DETAILS SHEET */
                <div className="space-y-4">
                  
                  {/* Segmented Navbar */}
                  <div className="flex border-b border-zinc-900 font-mono text-[10px] font-bold">
                    <button
                      type="button"
                      onClick={() => setAngelTab('holdings')}
                      className={`flex-1 text-center py-2 border-b-2 transition uppercase ${
                        angelTab === 'holdings'
                          ? 'border-blue-500 text-blue-400 bg-blue-950/10'
                          : 'border-transparent text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      💼 Holdings ({state.schwab.holdings?.length || 0})
                    </button>
                    <button
                      type="button"
                      onClick={() => setAngelTab('positions')}
                      className={`flex-1 text-center py-2 border-b-2 transition uppercase ${
                        angelTab === 'positions'
                          ? 'border-blue-500 text-blue-400 bg-blue-950/10'
                          : 'border-transparent text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      ⚡ Open Trades ({state.schwab.livePositions?.length || 0})
                    </button>
                    <button
                      type="button"
                      onClick={() => setAngelTab('settings')}
                      className={`flex-1 text-center py-2 border-b-2 transition uppercase ${
                        angelTab === 'settings'
                          ? 'border-blue-500 text-blue-400 bg-blue-950/10'
                          : 'border-transparent text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      🏦 Ledger/Specs
                    </button>
                  </div>

                  {/* TAB CONTENT: HOLDINGS */}
                  {angelTab === 'holdings' && (() => {
                    const holdings = state.schwab.holdings || [];
                    
                    let totalInvested = 0;
                    let totalCurrent = 0;
                    holdings.forEach((h: any) => {
                      const qty = parseFloat(h.quantity || h.qty || '0');
                      const avgPrice = parseFloat(h.averageprice || h.avgprice || '0');
                      const ltp = parseFloat(h.ltp || h.lastTradedPrice || '0');
                      totalInvested += qty * avgPrice;
                      totalCurrent += qty * ltp;
                    });
                    
                    const gain = totalCurrent - totalInvested;
                    const gainPercent = totalInvested > 0 ? (gain / totalInvested) * 100 : 0;
                    
                    return (
                      <div className="space-y-4 pt-1">
                        {/* Holdings Summary Stats Row */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 font-mono">
                          <div className="bg-zinc-950/40 border border-zinc-900 p-2 rounded">
                            <div className="text-[8.5px] text-zinc-500 uppercase font-bold tracking-wider">Invested</div>
                            <div className="text-xs font-bold text-zinc-200 mt-1">{cSign}{formatNumber(totalInvested)}</div>
                          </div>
                          <div className="bg-zinc-950/40 border border-zinc-900 p-2 rounded">
                            <div className="text-[8.5px] text-zinc-500 uppercase font-bold tracking-wider">Current Val</div>
                            <div className="text-xs font-bold text-zinc-200 mt-1">{cSign}{formatNumber(totalCurrent)}</div>
                          </div>
                          <div className="bg-zinc-950/40 border border-zinc-900 p-2 rounded col-span-2">
                            <div className="text-[8.5px] text-zinc-500 uppercase font-bold tracking-wider">Overall Return</div>
                            <div className={`text-xs font-bold mt-1 ${gain >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {gain >= 0 ? '+' : ''}{cSign}{formatNumber(gain)} ({gain >= 0 ? '+' : ''}{gainPercent.toFixed(2)}%)
                            </div>
                          </div>
                        </div>

                        {/* Holdings Table Listing */}
                        <div className="bg-[#050608] border border-zinc-905 p-3 rounded-md">
                          <div className="text-[9px] text-zinc-500 uppercase font-bold tracking-wider mb-2">Portfolio Breakdown</div>
                          {holdings.length === 0 ? (
                            <div className="text-center py-7 text-zinc-500 font-sans leading-normal text-xs">
                              <p className="font-semibold text-zinc-400">You have no active stock investments or ETFs on Schwab yet.</p>
                              <p className="text-[10px] text-zinc-500 mt-1 font-mono">Place a simulated or live order under the cash-style profile to seed long-term holdings.</p>
                            </div>
                          ) : (
                            <div className="max-h-[200px] overflow-y-auto space-y-1.5 scrollbar-thin">
                              {holdings.map((h: any, i: number) => {
                                const qty = parseFloat(h.quantity || h.qty || '0');
                                const avgPrice = parseFloat(h.averageprice || h.avgprice || '0');
                                const ltp = parseFloat(h.ltp || h.lastTradedPrice || '0');
                                const costVal = qty * avgPrice;
                                const marketVal = qty * ltp;
                                const pnl = marketVal - costVal;
                                const pnlPct = costVal > 0 ? (pnl / costVal) * 100 : 0;
                                
                                return (
                                  <div key={i} className="flex justify-between items-center bg-zinc-950/50 border border-zinc-900 p-2.5 rounded font-mono text-[10px]">
                                    <div>
                                      <div className="font-bold text-zinc-150 uppercase">{h.tradingsymbol || h.symbol || 'Stock'}</div>
                                      <div className="text-[9px] text-zinc-500 mt-0.5">{qty} Shares @ Avg {cSign}{avgPrice.toFixed(2)}</div>
                                    </div>
                                    <div className="text-right">
                                      <div className="font-bold text-zinc-200">{cSign}{marketVal.toFixed(2)}</div>
                                      <div className={`text-[9.5px] font-bold ${pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} ({pnlPct.toFixed(2)}%)
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* TAB CONTENT: ACTIVE POSITIONS */}
                  {angelTab === 'positions' && (() => {
                    const positions = state.schwab.livePositions || [];
                    
                    return (
                      <div className="space-y-4 pt-1">
                        <div className="bg-[#050608] border border-zinc-905 p-3 rounded-md">
                          <div className="text-[9px] text-zinc-500 uppercase font-bold tracking-wider mb-2">Live Day Trade Positions</div>
                          {positions.length === 0 ? (
                            <div className="text-center py-8 text-zinc-500 font-sans text-xs">
                              ● No active open intraday or margin positions on Schwab.
                            </div>
                          ) : (
                            <div className="max-h-[200px] overflow-y-auto space-y-1.5">
                              {positions.map((p: any, i: number) => {
                                const netQty = parseFloat(p.netqty || p.netQty || '0');
                                const avgPrice = parseFloat(p.avgnetprice || p.averageprice || '0');
                                const ltp = parseFloat(p.ltp || '0');
                                const pnl = parseFloat(p.pnl || '0');
                                
                                return (
                                  <div key={i} className="flex justify-between items-center bg-zinc-950/50 border border-zinc-900 p-2.5 rounded font-mono text-[10px]">
                                    <div>
                                      <div className="flex items-center gap-1.5">
                                        <span className="font-bold text-zinc-150 uppercase">{p.tradingsymbol || 'Asset'}</span>
                                        <span className="text-[8px] bg-blue-950 text-blue-400 px-1 border border-blue-500/20 rounded uppercase font-bold">
                                          {p.producttype || 'INTRADAY'}
                                        </span>
                                      </div>
                                      <div className="text-[9px] text-zinc-500 mt-0.5">NET QTY: {netQty} | Entry Price: {cSign}{avgPrice.toFixed(2)}</div>
                                    </div>
                                    <div className="text-right">
                                      <div className="font-bold text-zinc-200">LTP: {cSign}{ltp.toFixed(2)}</div>
                                      <div className={`text-[9.5px] font-bold ${pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {pnl >= 0 ? '+' : ''}{cSign}{pnl.toFixed(2)}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* TAB CONTENT: ACCOUNT SETTINGS / LEDGER */}
                  {angelTab === 'settings' && (
                    <div className="space-y-4 pt-1 font-mono text-[11px]">
                      <div className="bg-blue-950/20 border border-blue-500/20 p-4 rounded-md">
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="text-[9px] font-mono uppercase tracking-wider text-blue-400 font-bold">CLIENT PROFILE ACTIVE</div>
                            <h4 className="text-sm font-bold text-zinc-100 mt-1">{state.schwab.profileName}</h4>
                            <div className="text-[11px] text-zinc-400 font-mono mt-0.5">{state.schwab.email || 'No email bound'}</div>
                            <div className="text-[10px] text-zinc-500 font-mono mt-2 font-semibold">LINKED ON: {state.schwab.linkedAt}</div>
                          </div>
                          <span className="text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-500/40 px-2 py-0.5 rounded font-mono font-bold">
                            ● BROKER CONNECTED
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-zinc-900 font-mono">
                          <div className="bg-zinc-900/40 p-2 rounded-md border border-zinc-900">
                            <div className="text-[9px] text-zinc-500 font-bold">AVAILABLE CASH</div>
                            <div className="text-xs font-bold text-zinc-200 mt-0.5">{cSign}{formatNumber(displayedCashBase)}</div>
                          </div>
                          <div className="bg-zinc-900/40 p-2 rounded-md border border-zinc-900">
                            <div className="text-[9px] text-zinc-500 font-bold">LIQUIDATION VALUE</div>
                            <div className="text-xs font-bold text-blue-400 mt-0.5">{cSign}{formatNumber(displayedNetEquity)}</div>
                          </div>
                        </div>
                      </div>

                      <p className="text-[11px] text-zinc-400 font-sans leading-relaxed">
                        This session is authenticated dynamically using your background authenticator flow. Live trade transactions are routed using the selected account profile: <span className="text-amber-400 font-mono font-bold tracking-wider uppercase">{state.config.schwabProductType || 'INTRADAY'}</span>.
                      </p>

                      <div className="flex items-center gap-2 pt-2 border-t border-zinc-900 justify-end">
                        <button
                          type="button"
                          disabled={angelLoading}
                          onClick={refreshAngelBalance}
                          className="bg-zinc-900 hover:bg-zinc-805 text-zinc-200 border border-zinc-800 hover:border-zinc-700 px-4 py-2 rounded text-xs font-mono font-bold transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${angelLoading ? 'animate-spin' : ''}`} />
                          REFRESH LEDGER MARGINS
                        </button>
                        <button
                          type="button"
                          disabled={angelLoading}
                          onClick={unlinkAngelAccount}
                          className="bg-rose-950/85 hover:bg-rose-900 text-rose-200 border border-rose-500/30 hover:border-rose-400 px-4 py-2 rounded text-xs font-mono font-bold transition cursor-pointer"
                        >
                          DELETE SYSTEM LINK
                        </button>
                      </div>
                    </div>
                  )}

                </div>
              ) : (
                /* SCHWAB DEVELOPER OAUTH LINK */
                <form onSubmit={linkAngelAccount} className="space-y-4 font-mono">
                  {angelError && (
                    <div className="bg-rose-950/60 border border-rose-500/40 p-2.5 rounded text-[11px] text-rose-200 leading-normal border shadow">
                      ❌ Connection failed: {angelError}
                    </div>
                  )}

                  <div className="bg-zinc-950/40 border border-zinc-900/70 rounded p-3 space-y-3">
                    <p className="text-[11px] text-zinc-300 leading-normal font-sans">
                      This app uses the official Schwab developer OAuth flow. No broker password, client code, MPIN, or TOTP secret is entered here.
                    </p>
                    <div className="rounded border border-amber-500/20 bg-amber-950/20 px-3 py-2 text-[10px] text-amber-100 leading-normal font-sans">
                      Schwab developer app registration happens on the developer portal, but the actual OAuth sign-in may redirect to Schwab's secure login host during authorization. Complete that step in Chrome, Edge, or Firefox rather than an embedded browser view.
                    </div>
                    <div className="grid grid-cols-1 gap-2 text-[10px] text-zinc-400 font-sans">
                      <div className="border border-zinc-900 rounded bg-[#050608] px-3 py-2">
                        1. Click the button below to open Schwab authorization.
                      </div>
                      <div className="border border-zinc-900 rounded bg-[#050608] px-3 py-2">
                        2. Sign in on Schwab and approve the developer app.
                      </div>
                      <div className="border border-zinc-900 rounded bg-[#050608] px-3 py-2">
                        3. You will be returned here and the account snapshot will sync automatically.
                      </div>
                    </div>
                    <div className="rounded border border-blue-500/20 bg-blue-950/20 px-3 py-2 text-[10px] text-blue-200 leading-normal font-sans">
                      Required local environment: SCHWAB_CLIENT_ID, SCHWAB_CLIENT_SECRET, and SCHWAB_REDIRECT_URI.
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 border-t border-zinc-900 pt-3 mt-4 text-xs">
                    <button
                      type="button"
                      onClick={() => setShowAngelModal(false)}
                      className="bg-[#0b0d13] hover:bg-zinc-900 text-zinc-450 hover:text-white px-4 py-2 border border-zinc-800 hover:border-zinc-700 rounded transition cursor-pointer"
                    >
                      ABORT
                    </button>
                    <button
                      type="submit"
                      disabled={angelLoading}
                      className="bg-blue-500 hover:bg-blue-600 text-black px-4 py-2 rounded font-bold transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-md"
                    >
                      {angelLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Unlock className="w-3.5 h-3.5" />}
                      {angelLoading ? 'OPENING SCHWAB OAUTH...' : 'AUTHORIZE WITH SCHWAB'}
                    </button>
                  </div>
                </form>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* TOP HEADER STATUS REACTION CARDS */}
      <header className="border-b border-zinc-900 bg-[#090b10] px-4 py-3 flex flex-wrap justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-gradient-to-r from-amber-500 to-yellow-400 shadow-[0_0_10px_#f59e0b] animate-pulse" />
            <h1 className="text-md font-black tracking-tight text-white uppercase flex items-center gap-1 font-mono">
              Tradeedge_WallStreet
              <span className="text-[9px] bg-zinc-800 text-zinc-300 font-normal px-1.5 py-0.5 rounded ml-2">v2.2</span>
            </h1>
          </div>
          <div className="h-4 w-[1px] bg-zinc-800" />
          <div className="flex items-center gap-2 text-[10px] uppercase font-mono tracking-widest text-zinc-400">
            <span className={`w-2 h-2 rounded-full ${onlineStatus ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]' : 'bg-rose-500'}`} />
            {onlineStatus ? 'CONSOLE ONLINE' : 'OFFLINE SYNC DISTURBED'}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Autonomous bot toggles */}
          <button
            onClick={toggleAutonomousTrading}
            className={`px-3 py-1.5 rounded text-[11px] font-mono tracking-wider transition-all flex items-center gap-2 border font-bold ${
              state?.autonomousTrading
                ? 'bg-emerald-950 border-emerald-500 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.15)]'
                : 'bg-zinc-900 border-zinc-700 text-zinc-400'
            }`}
          >
            {state?.autonomousTrading ? <Activity className="w-3.5 h-3.5 animate-spin text-emerald-400" /> : <Pause className="w-3.5 h-3.5" />}
            AUTONOMOUS BOT: {state?.autonomousTrading ? 'ACTIVE' : 'PAUSED'}
          </button>

          {/* Paper / Live Toggle */}
          <button
            onClick={togglePaperMode}
            title={state?.config.paperMode ? 'Current mode: Paper Trading. Click to switch to live mode.' : 'Current mode: Live Trading. Click to switch to paper mode.'}
            className={`px-3 py-1.5 rounded text-[11px] font-mono tracking-wider transition-all flex items-center gap-2 border font-bold ${
              !state?.config.paperMode
                ? 'bg-rose-950 border-rose-500 text-rose-300 shadow-[0_0_15px_rgba(239,68,68,0.25)]'
                : 'bg-teal-950 border-teal-500 text-teal-300 shadow-[0_0_15px_rgba(20,184,166,0.15)]'
            }`}
          >
            {state?.config.paperMode ? (
              <>
                <Zap className="w-3.5 h-3.5 text-teal-400" />
                SWITCH TO LIVE MODE
              </>
            ) : (
              <>
                <Coins className="w-3.5 h-3.5 text-rose-400" />
                SWITCH TO PAPER MODE
              </>
            )}
          </button>

          {/* Action buttons */}
          <button
            onClick={triggerManualScan}
            disabled={state?.scanningInProgress}
            className="bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-500/50 hover:border-indigo-400 text-indigo-200 px-3 py-1.5 rounded text-[11px] font-mono font-bold flex items-center gap-2 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${state?.scanningInProgress ? 'animate-spin text-indigo-400' : ''}`} />
            FORCE SEARCH SCAN
          </button>

          <button
            onClick={() => setShowConfigPanel(!showConfigPanel)}
            className="bg-zinc-900 hover:bg-zinc-805 border border-zinc-800 text-zinc-300 px-3 py-1.5 rounded text-[11px] font-mono flex items-center gap-1.5 transition"
          >
            <Sliders className="w-3.5 h-3.5 text-zinc-400" />
            OPERATOR SETTINGS
          </button>

          <button
            onClick={() => {
              if (state?.schwab?.linked) {
                setShowAngelModal(true);
              } else {
                void linkAngelAccount({ preventDefault() {} } as React.FormEvent);
              }
            }}
            className={`px-3 py-1.5 rounded text-[11px] font-mono font-bold flex items-center gap-1.5 border transition cursor-pointer ${
              state?.schwab?.linked
                ? 'bg-blue-950/80 border-blue-500/80 text-blue-200 hover:text-white hover:border-blue-400 shadow-[0_0_12px_rgba(59,130,246,0.25)]'
                : 'bg-zinc-900 hover:bg-zinc-805 border-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Unlock className={`w-3.5 h-3.5 ${state?.schwab?.linked ? 'text-blue-400' : 'text-zinc-400'}`} />
            {state?.schwab?.linked ? `SCHWAB: ${state.schwab.clientCode}` : 'LINK SCHWAB'}
          </button>

          <button
            onClick={() => setShowResetConfirm(true)}
            className="bg-rose-950/80 hover:bg-rose-900 border border-rose-500/50 hover:border-rose-400 text-rose-200 hover:text-white px-3 py-1.5 rounded text-[11px] font-mono font-bold flex items-center gap-1.5 transition shadow-[0_0_10px_rgba(239,68,68,0.1)]"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            HARD RESET SIMULATION
          </button>
        </div>
      </header>

      {/* OPERATOR SETTINGS PARAMETERS PANEL */}
      <AnimatePresence>
        {showConfigPanel && state && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-b border-zinc-900 bg-[#090b10] px-4 py-4 overflow-hidden"
            id="operator_settings_drawer"
          >
            <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider font-mono mb-1.5">Intraday Margin Multiplier</label>
                <div className="flex items-center gap-2">
                  <input
                    type="range" min="1" max="5" step="1"
                    value={editLeverage}
                    onChange={(e) => setEditLeverage(Number(e.target.value))}
                    className="w-full accent-amber-500"
                  />
                  <span className="text-xs font-mono text-amber-500 font-bold bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800 w-12 text-center">{editLeverage}x</span>
                </div>
                <span className="text-[9px] text-zinc-500 mt-1 block">
                  {isWallStreet ? 'US broker leverage depends on account approval and margin eligibility.' : 'Crypto platforms support higher leverage tiers.'}
                </span>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider font-mono mb-1.5">Primary Trading Capital Base ({cSign})</label>
                <input
                  type="number" step="1000" min="1" max="10000000"
                  value={editPaperBalance}
                  onChange={(e) => setEditPaperBalance(Number(e.target.value))}
                  className="w-full bg-[#050608] border border-zinc-800 rounded px-2.5 py-1 text-xs font-mono text-amber-500 font-bold focus:outline-none focus:border-amber-500"
                />
                <span className="text-[9px] text-zinc-500 mt-1 block font-mono">Set this to match your real Schwab buying-power baseline, for example $11,000.</span>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider font-mono mb-1.5">Automated Sizing (Margin {cSign})</label>
                <input
                  type="number" step="1000" min="50" max="100000"
                  value={editAllocation}
                  onChange={(e) => setEditAllocation(Number(e.target.value))}
                  className="w-full bg-[#050608] border border-zinc-800 rounded px-2.5 py-1 text-xs font-mono text-zinc-200 focus:outline-none focus:border-amber-500"
                />
                <span className="text-[9px] text-zinc-500 mt-1 block">Maximum allocated margin per stock setup.</span>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider font-mono mb-1.5">Min Liquidity Filter (24h Vol {cName})</label>
                <input
                  type="number" step="100000" min="10000"
                  value={editMinVolume}
                  onChange={(e) => setEditMinVolume(Number(e.target.value))}
                  className="w-full bg-[#050608] border border-zinc-800 rounded px-2.5 py-1 text-xs font-mono text-zinc-200 focus:outline-none focus:border-amber-500"
                />
                <span className="text-[9px] text-zinc-500 mt-1 block">Exclude candidates with quote-volume below {cSign}{formatNumber(editMinVolume, 0, 0)}</span>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider font-mono mb-1.5">Margin Capital Buffer (% Saved)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="range" min="0" max="50" step="5"
                    value={editMarginBuffer}
                    onChange={(e) => setEditMarginBuffer(Number(e.target.value))}
                    className="w-full accent-amber-500"
                  />
                  <span className="text-xs font-mono text-indigo-400 font-bold bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800 w-12 text-center">{editMarginBuffer}%</span>
                </div>
                <span className="text-[9px] text-zinc-500 mt-1 block">Saved static capital margin buffer</span>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider font-mono mb-1.5">Scanning Frequency Rate</label>
                <select
                  value={editScanInterval}
                  onChange={(e) => setEditScanInterval(Number(e.target.value))}
                  className="w-full bg-[#050608] border border-zinc-800 rounded px-2.5 py-1 text-xs font-mono text-zinc-200 focus:outline-none focus:border-amber-500"
                >
                  <option value={15}>15 Sec (Fast scan)</option>
                  <option value={30}>30 Sec (High performance)</option>
                  <option value={60}>60 Sec (Continuous standard)</option>
                  <option value={120}>120 Sec (Optimized limit)</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider font-mono mb-1.5">Asset Market Focus</label>
                <select
                  value={editMarketMode}
                  onChange={(e) => setEditMarketMode(e.target.value as 'crypto' | 'us_stocks')}
                  className="w-full bg-[#050608] border border-zinc-805 rounded px-2.5 py-1.5 text-xs font-mono text-amber-500 font-bold focus:outline-none focus:border-amber-500"
                >
                  <option value="us_stocks">🇺🇸 US Stocks (Wall Street)</option>
                  <option value="crypto">🪙 Crypto Futures (Binance USDT)</option>
                </select>
                <span className="text-[9px] text-zinc-500 mt-1 block">Toggle discovery scanner focus between US equities and Binance futures contracts.</span>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider font-mono mb-1.5">Live Tradable Universe List</label>
                <input
                  type="text"
                  value={editLiveUniverseString}
                  onChange={(e) => setEditLiveUniverseString(e.target.value)}
                  placeholder="e.g. AAPL, MSFT, NVDA, BTCUSDT (or * for all)"
                  className="w-full bg-[#050608] border border-zinc-500/20 rounded px-2.5 py-1.2 text-xs font-mono text-zinc-200 focus:outline-none focus:border-amber-500"
                />
                <span className="text-[9px] text-zinc-500 mt-1 block">Comma-separated list of symbols allowed for execution (or * for all).</span>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider font-mono mb-1.5">Execution Mode</label>
                <select
                  value={editPaperMode ? "paper" : "live"}
                  onChange={(e) => setEditPaperMode(e.target.value === "paper")}
                  className="w-full bg-[#050608] border border-zinc-800 rounded px-2.5 py-1.5 text-xs font-mono text-zinc-200 focus:outline-none focus:border-amber-500"
                >
                  <option value="paper">📝 Paper Trading (Simulated {cName})</option>
                  <option value="live">⚡ Live Trading ({isWallStreet ? 'Schwab Gateway' : 'Binance Mainnet API'})</option>
                </select>
                <span className="text-[9px] text-zinc-500 mt-1 block font-mono">Simulate virtual orders or route entries dynamically into the live execution API gateway.</span>
              </div>

              {isWallStreet && (
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider font-mono mb-1.5">Schwab Account Profile</label>
                  <select
                    value={editAngelProductType}
                    onChange={(e) => setEditAngelProductType(e.target.value as 'INTRADAY' | 'DELIVERY')}
                    className="w-full bg-[#050608] border border-zinc-800 rounded px-2.5 py-1.5 text-xs font-mono text-zinc-200 focus:outline-none focus:border-amber-500"
                  >
                    <option value="INTRADAY">⚡ Margin Trading Profile</option>
                    <option value="DELIVERY">💼 Cash / Long Holdings Profile</option>
                  </select>
                  <span className="text-[9px] text-zinc-500 mt-1 block font-mono">Use the cash-style profile to route fills into long-term equity holdings.</span>
                </div>
              )}

              <div>
                <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider font-mono mb-1.5">Cluster Side Limit</label>
                <input
                  type="number" min="1" max="10"
                  value={editMaxCluster}
                  onChange={(e) => setEditMaxCluster(Number(e.target.value))}
                  className="w-full bg-[#050608] border border-zinc-800 rounded px-2.5 py-1 text-xs font-mono text-zinc-200 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider font-mono mb-1.5">Max Scan Depth (Stock Pool)</label>
                <input
                  type="number" min="10" max="150" step="5"
                  value={editScanLimit}
                  onChange={(e) => setEditScanLimit(Number(e.target.value))}
                  className="w-full bg-[#050608] border border-zinc-800 rounded px-2.5 py-1 text-xs font-mono text-zinc-200 focus:outline-none focus:border-amber-500"
                />
                <span className="text-[9px] text-zinc-500 mt-1 block font-mono">Parallel scanner limit (out of the entire stock pool).</span>
              </div>

              <div className="flex items-center pt-5">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={editPreventCluster}
                    onChange={(e) => setEditPreventCluster(e.target.checked)}
                    className="rounded border-zinc-800 text-amber-500 focus:ring-amber-500/20 bg-[#050608] w-4 h-4"
                  />
                  <span className="text-[10px] uppercase font-bold text-zinc-400 font-mono">Side Clustering Control</span>
                </label>
              </div>

              <div className="flex items-end justify-end pt-4">
                <button
                  onClick={() => {
                    submitConfigChanges({
                      leverage: editLeverage,
                      allocation: editAllocation,
                      minVolume: editMinVolume,
                      marginBufferPercent: editMarginBuffer,
                      scanIntervalSeconds: editScanInterval,
                      maxClusteredPositions: editMaxCluster,
                      preventCorrelationClustering: editPreventCluster,
                      scanLimit: editScanLimit,
                      marketMode: editMarketMode,
                      paperMode: editPaperMode,
                      liveUniverseString: editLiveUniverseString,
                      paperBalance: editPaperBalance,
                      schwabProductType: editAngelProductType,
                    });
                    setShowConfigPanel(false);
                  }}
                  className="bg-amber-500 hover:bg-amber-600 text-black px-4 py-1.5 rounded text-xs font-bold font-mono transition w-full md:w-auto"
                >
                  APPLY STRATEGY PROFILE
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* METRIC CARD STATS MATRIX BANNER */}
      {state && (
        <section className="bg-zinc-950 px-4 py-3 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 border-b border-zinc-900">
          {/* NET PORTFOLIO VALUATION / EQUITY */}
          <div className={`p-3 rounded border relative overflow-hidden transition-all duration-300 ${
            unrealizedPnLSum > 0 
              ? 'bg-[#0a0f0d] border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.04)]' 
              : unrealizedPnLSum < 0 
              ? 'bg-[#120a0b] border-rose-500/20' 
              : 'bg-[#0b0c10] border-zinc-900/60'
          }`}>
            <div className="absolute right-2 top-2">
              <Percent className={`w-8 h-8 ${unrealizedPnLSum > 0 ? 'text-emerald-400/10' : 'text-zinc-500/10'}`} />
            </div>
            <div className="text-[9px] uppercase font-mono tracking-wider text-zinc-500 font-bold">
              {showSchwabBalances ? 'Schwab Liquidation Value' : state.config.paperMode ? 'Simulator Net Equity' : 'Live Portfolio Equity'}
            </div>
            <div className={`text-lg font-bold font-mono ${unrealizedPnLSum > 0 ? 'text-emerald-400' : unrealizedPnLSum < 0 ? 'text-rose-400' : 'text-zinc-100'}`}>
              {cSign}{formatNumber(displayedNetEquity, 2, 2)}
            </div>
            <div className="text-[8.5px] font-mono text-zinc-500 mt-0.5">{showSchwabBalances ? 'Exact broker account valuation' : 'Capital + Active P&L'}</div>
          </div>

          {/* ACTIVE UNREALIZED return */}
          <div className={`p-3 rounded border relative overflow-hidden transition-all duration-300 ${
            unrealizedPnLSum > 0 
              ? 'bg-[#0a0f0d] border-[#10b981]/30 shadow-[0_0_15px_rgba(16,185,129,0.06)]' 
              : unrealizedPnLSum < 0 
              ? 'bg-[#120a0b] border-rose-900/40 shadow-[0_0_15px_rgba(239,68,68,0.05)]' 
              : 'bg-[#0b0c10] border-zinc-900/60'
          }`}>
            <div className="absolute right-2 top-2">
              <Zap className={`w-8 h-8 ${unrealizedPnLSum > 0 ? 'text-emerald-400/10 animate-pulse' : 'text-rose-500/10'}`} />
            </div>
            <div className="text-[9px] uppercase font-mono tracking-wider text-zinc-500 font-bold">
              Active Unrealized P&L
            </div>
            <div className={`text-lg font-bold font-mono ${unrealizedPnLSum > 0 ? 'text-emerald-400' : unrealizedPnLSum < 0 ? 'text-rose-400' : 'text-zinc-400'}`}>
              {unrealizedPnLSum > 0 ? '+' : ''}{cSign}{unrealizedPnLSum.toFixed(2)}
            </div>
            <div className="text-[8.5px] font-mono text-zinc-500 mt-0.5">
              {capitalReturnPercent > 0 ? '+' : ''}{capitalReturnPercent.toFixed(2)}% of starting capital
            </div>
          </div>

          {/* SIMULATOR CASH BALANCE */}
          <div className="bg-[#0b0c10] p-3 rounded border border-zinc-900/60 relative overflow-hidden">
            <div className="absolute right-2 top-2 flex items-center gap-1.5 z-10">
              {state?.schwab?.linked && (
                <button
                  type="button"
                  title="Sync balance from registered active account profile"
                  disabled={angelLoading}
                  onClick={refreshAngelBalance}
                  className="bg-blue-950/40 hover:bg-blue-900/60 text-blue-400 p-1.5 rounded border border-blue-500/20 hover:border-blue-500/40 transition cursor-pointer flex items-center justify-center disabled:opacity-50"
                  id="sync_live_balance_btn"
                >
                  <RefreshCw className={`w-3 h-3 ${angelLoading ? 'animate-spin' : ''}`} />
                </button>
              )}
              <Coins className="w-8 h-8 text-amber-500/10" />
            </div>
            <div className="text-[9px] uppercase font-mono tracking-wider text-zinc-500">
              {showSchwabBalances ? 'Schwab Cash Balance' : state.config.paperMode ? 'Simulator Cash Base' : (isWallStreet ? 'Schwab Buying Power' : 'Binance Exchange Margin Wallet')}
            </div>
            <div className="text-lg font-bold font-mono text-zinc-100 flex items-baseline gap-1.5 mt-0.5">
              <span>{cSign}{formatNumber(displayedCashBase, 2, 2)}</span>
              {state?.schwab?.linked && (
                <span className="text-[9px] text-blue-400 font-mono font-medium">
                  (Linked Broker)
                </span>
              )}
            </div>
            <div className="text-[8.5px] font-mono text-zinc-500 mt-1">
              {showSchwabBalances ? `Last synced cash balance from Schwab: ${cSign}${formatNumber(displayedCashBase)}` : state?.schwab?.linked ? `Last synced available cash limit: ${cSign}${formatNumber(state.schwab.availableCash)}` : 'Settled cash (excl active margin)'}
            </div>
          </div>

          {/* FREE MARGIN VOL */}
          <div className={`p-3 rounded border relative overflow-hidden transition-all duration-300 ${
            lowMarginWarning ? 'bg-[#120c0f] border-amber-900/40' : 'bg-[#0b0c10] border-zinc-900/60'
          }`}>
            <div className="absolute right-2 top-2"><Sliders className="w-8 h-8 text-indigo-400/10" /></div>
            <div className="text-[9px] uppercase font-mono tracking-wider text-zinc-500">
              {showSchwabBalances ? 'Schwab Buying Power' : state.config.paperMode ? 'Available Free Margin' : 'Live Available Margin'}
            </div>
            <div className={`text-lg font-bold font-mono ${lowMarginWarning ? 'text-amber-500' : 'text-teal-400'}`}>
              {cSign}{formatNumber(displayedAvailableMargin, 2, 2)}
            </div>
            <div className="text-[8.5px] font-mono text-zinc-500 mt-0.5">{showSchwabBalances ? 'Exact broker buying power snapshot' : 'Cash + P&L - Locked Margin'}</div>
          </div>

          {/* DEPLOYABLE CAPITAL */}
          <div className="bg-[#0b0c10] p-3 rounded border border-zinc-900/60 relative overflow-hidden">
            <div className="absolute right-2 top-2"><Sliders className="w-8 h-8 text-indigo-400/10" /></div>
            <div className="text-[9px] uppercase font-mono tracking-wider text-zinc-500 font-bold">Deployable Capital</div>
            <div className="text-lg font-semibold font-mono text-zinc-200">
              {cSign}{formatNumber(state.deployableCapital, 2, 2)}
            </div>
            <div className="text-[8.5px] font-mono text-zinc-505 mt-0.5">({state.marginBufferPercent}% reserve cushion held)</div>
          </div>

          {/* SYSTEM STATUS LOCKS & SCAN CLOCK */}
          <div className="bg-[#0b0c10] p-3 rounded border border-zinc-900/60 relative overflow-hidden text-zinc-100">
            <div className="text-[9px] uppercase font-mono tracking-wider text-zinc-500 font-bold">Risk Management Status</div>
            <div className="text-xs font-bold font-mono mt-1 flex flex-col gap-0.5">
              <div className="flex items-center justify-between">
                <span className="text-zinc-450">Active Locks:</span>
                <span className={state.perSymbolRiskLocks.length > 0 ? 'text-rose-400' : 'text-zinc-500'}>
                  {state.perSymbolRiskLocks.length} locked
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-450">Last Sweep:</span>
                <span className="text-indigo-305 text-[11px] truncate w-24 text-right justify-end flex">
                  {state.lastScanTime ? state.lastScanTime.split(',')[1] || state.lastScanTime : 'No sweeps yet'}
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-zinc-900/60 pt-1 mt-1 text-[11px]">
                <span className="text-zinc-500">Cumulative Fees:</span>
                <span className="text-amber-500/90 font-bold">
                  {cSign}{formatNumber(state.historicalTrades.reduce((acc, curr) => acc + (curr.totalFee || 0), 0), 2, 2)}
                </span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* MAIN SCREEN TERMINAL LAYOUT split */}
      <div className="flex-grow grid grid-cols-1 lg:grid-cols-12 gap-4 p-4 max-w-[1700px] w-full mx-auto">
        
        {/* SIDEBAR LEFT CANDIDATES AND SEARCH */}
        <section className="lg:col-span-3 flex flex-col gap-3 h-[700px] lg:h-[840px] overflow-hidden bg-[#090b10] border border-zinc-900 rounded-lg p-3">
          <div className="flex flex-col gap-2">
            <div className="text-xs uppercase font-bold tracking-wider font-mono text-zinc-400 pb-1 border-b border-zinc-900/80 flex justify-between items-center">
              <span>Market Universe Discovery</span>
              <span className="text-[10px] text-amber-500 font-bold bg-amber-500/10 px-1.5 py-0.5 rounded">Active</span>
            </div>
            {/* Search query field */}
            <input
              type="text"
              placeholder="Filter Stocks (e.g. RELIANCE)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#050608] border border-zinc-800 rounded px-3 py-1.5 text-xs font-mono text-zinc-200 focus:outline-none focus:border-indigo-500 transition"
              id="market_search_input"
            />
          </div>

          <div className="flex-grow overflow-y-auto pr-1 flex flex-col gap-1.5" id="assets_list">
            {getSearchTickersList().length === 0 ? (
              <div className="text-center text-zinc-600 py-12 text-xs font-mono">No active tickers found.</div>
            ) : (
              getSearchTickersList().map((ticker) => {
                const isSelected = selectedSymbol === ticker.symbol;
                const isBuy = ticker.dir === 'BUY';
                const isSell = ticker.dir === 'SELL';
                return (
                  <button
                    key={ticker.symbol}
                    onClick={() => setSelectedSymbol(ticker.symbol)}
                    className={`w-full text-left p-2.5 rounded transition flex items-center justify-between border ${
                      isSelected
                        ? 'bg-zinc-900 border-zinc-700'
                        : 'bg-zinc-950/40 hover:bg-zinc-900 border-zinc-900 hover:border-zinc-850'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-black font-mono tracking-tight text-white">
                          {state?.marketMode === 'us_stocks' ? ticker.symbol : ticker.symbol.replace('USDT', '')}
                        </span>
                        <span className="text-[9px] text-zinc-500">/{state?.marketMode === 'us_stocks' ? 'USD' : 'USDT'}</span>
                      </div>
                      <div className="text-[9px] font-mono text-zinc-600 flex gap-2">
                        <span>Price: {cSign}{formatNumber(ticker.price, 4, 2)}</span>
                      </div>
                    </div>
                    
                    <div className="text-right">
                      {isBuy && (
                        <span className="text-[9.5px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-500/50 px-2 py-0.5 rounded flex items-center gap-0.5">
                          <TrendingUp className="w-2.5 h-2.5" /> BUY
                        </span>
                      )}
                      {isSell && (
                        <span className="text-[9.5px] font-mono font-bold bg-rose-950 text-rose-300 border border-rose-500/50 px-2 py-0.5 rounded flex items-center gap-0.5">
                          <TrendingDown className="w-2.5 h-2.5" /> SELL
                        </span>
                      )}
                      {ticker.dir === 'HOLD' && (
                        <span className="text-[9.5px] font-mono font-bold bg-zinc-900 text-zinc-500 px-1.5 py-0.5 rounded">
                          HOLD
                        </span>
                      )}
                      <div className="text-[9px] font-mono font-semibold text-zinc-500 mt-1">
                        Score: <span className={isBuy ? 'text-emerald-500' : isSell ? 'text-rose-500' : 'text-zinc-500'}>
                          {ticker.score > 0 ? `+${ticker.score}` : ticker.score}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* MAIN CORES & CHART VIEW CENTRE */}
        <section className="lg:col-span-9 flex flex-col gap-4">

          {/* ASSET EVALUATION WORKBENCH PANEL */}
          <div className="bg-[#090b10] border border-zinc-900 rounded-lg p-4 flex flex-col gap-4">
            
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-900 pb-3" id="asset_selection_details">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-black font-mono text-white tracking-tight">{selectedSymbol} Trading Workbench</h2>
                  {state?.perSymbolRiskLocks.includes(selectedSymbol) && (
                    <span className="text-[10px] font-mono bg-rose-950 border border-rose-800 text-rose-300 px-2 py-0.5 rounded flex items-center gap-1">
                      <ShieldAlert className="w-3.5 h-3.5 text-rose-400" /> ACTIVE RISK LOCK
                    </span>
                  )}
                </div>
                <div className="text-xs text-zinc-400 mt-1 font-mono">
                  Current Tick Close: <span className="text-zinc-100 font-bold">{cSign}{formatNumber(getPriceForSymbol(selectedSymbol), 4, 2)}</span>
                  {(() => {
                    const snap = state?.lastNonEmptyRanked.find(p => p.symbol === selectedSymbol) || 
                                 state?.nearMisses.find(p => p.symbol === selectedSymbol);
                    if (!snap) return null;
                    return (
                      <span className="ml-4 text-zinc-500">
                        RSI: <span className={snap.rsi > 70 ? 'text-rose-400' : snap.rsi < 30 ? 'text-emerald-400' : 'text-indigo-300 font-semibold font-mono'}>{snap.rsi.toFixed(1)}</span>
                        &nbsp;|&nbsp;&nbsp;MACD Hist: <span className={snap.macd.hist > 0 ? 'text-emerald-400' : 'text-rose-400'}>{snap.macd.hist.toFixed(4)}</span>
                      </span>
                    );
                  })()}
                </div>
              </div>

              {/* Action desk order submission */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 bg-[#050608] border border-zinc-800 rounded px-2.5 py-1">
                  <span className="text-[9px] uppercase font-bold text-zinc-500 font-mono">Sizing Quantity (Margin):</span>
                  <input
                    type="number" step="1000" min="500" max="5000000"
                    value={tradeMargin}
                    onChange={(e) => setTradeMargin(Number(e.target.value))}
                    className="w-20 bg-transparent text-xs font-mono text-zinc-100 focus:outline-none text-center"
                  />
                  <span className="text-[10px] text-zinc-500">{cName}</span>
                </div>

                <div className="flex items-center gap-2 bg-[#050608] border border-zinc-800 rounded px-2.5 py-1">
                  <span className="text-[9px] uppercase font-bold text-zinc-500 font-mono">Multiplier:</span>
                  <input
                    type="number" min="1" max="5"
                    value={tradeLeverage}
                    onChange={(e) => setTradeLeverage(Number(e.target.value))}
                    className="w-10 bg-transparent text-xs font-mono text-zinc-100 focus:outline-none text-center"
                  />
                  <span className="text-[10px] text-zinc-500">x</span>
                </div>

                {state?.perSymbolRiskLocks.includes(selectedSymbol) && (
                  <label className="flex items-center gap-1.5 cursor-pointer text-xs font-mono select-none">
                    <input
                      type="checkbox"
                      checked={manualOverrideBox}
                      onChange={(e) => setManualOverrideBox(e.target.checked)}
                      className="rounded border-zinc-800 text-rose-500 bg-[#050608]"
                    />
                    <span className="text-[10px] text-rose-400">Manual Override</span>
                  </label>
                )}

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => executeOrder('BUY', selectedSymbol)}
                    className="bg-emerald-600 hover:bg-emerald-500 text-black px-4 py-1.5 rounded text-xs font-bold font-mono transition flex items-center gap-1 cursor-pointer"
                    id="submit_long_button"
                  >
                    <TrendingUp className="w-4 h-4" /> BUY
                  </button>
                  <button
                    onClick={() => executeOrder('SELL', selectedSymbol)}
                    className="bg-rose-500 hover:bg-rose-400 text-white px-4 py-1.5 rounded text-xs font-bold font-mono transition flex items-center gap-1 cursor-pointer"
                    id="submit_short_button"
                  >
                    <TrendingDown className="w-4 h-4" /> SELL
                  </button>
                </div>
              </div>
            </div>

            {/* SVG CANDLE CHART COMPONENT DRAW */}
            {renderSVGTechnicalChart()}

            {/* Selection strategy diagnostic text logs */}
            {(() => {
              const snap = state?.lastNonEmptyRanked.find(p => p.symbol === selectedSymbol) || 
                           state?.nearMisses.find(p => p.symbol === selectedSymbol);
              if (!snap) return null;
              return (
                <div className="bg-[#050608] border border-zinc-900 rounded p-3 text-[11px] font-mono grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-[10px] font-bold uppercase text-teal-400 tracking-widest mb-1">CONFLUENCE STRENGTH FACTORS</h4>
                    <ul className="list-disc pl-4 space-y-0.5 text-zinc-300">
                      {snap.strengthReasons.length === 0 ? (
                        <li className="text-zinc-650">No strong bullish/bearish indicators identified.</li>
                      ) : (
                        snap.strengthReasons.map((r, i) => <li key={i}>{r}</li>)
                      )}
                    </ul>
                  </div>
                  <div>
                    <h4 className="text-[10px] font-bold uppercase text-amber-500 tracking-widest mb-1">DEFERRALS & REBOUND EXPLANATIONS</h4>
                    <ul className="list-disc pl-4 space-y-0.5 text-zinc-300">
                      {snap.deferReasons.length === 0 ? (
                        <li className="text-zinc-650">No deferral checks triggered. Price aligned perfectly with indicators.</li>
                      ) : (
                        snap.deferReasons.map((r, i) => <li key={i} className="text-amber-500/80">{r}</li>)
                      )}
                    </ul>
                  </div>
                </div>
              );
            })()}

          </div>

          {/* LOWER OPERATOR DIAGNOSTIC TABLES WITH TABS */}
          <div className="bg-[#090b10] border border-zinc-900 rounded-lg p-4 flex flex-col gap-4">
            
            {/* Table tab selections controls */}
            <div className="flex flex-wrap border-b border-zinc-900 gap-1" id="operator_dashboard_tabs_bar">
              {state?.schwab?.linked && (
                <>
                  <button
                    onClick={() => setActiveTab('brokerHoldings')}
                    className={`px-4 py-2 text-xs font-mono uppercase font-bold tracking-wider transition-all flex items-center gap-1.5 ${
                      activeTab === 'brokerHoldings'
                        ? 'border-b-2 border-blue-500 text-blue-400 bg-blue-950/15'
                        : 'text-blue-500/80 hover:text-blue-400'
                    }`}
                  >
                    💼 Broker Portfolio ({ (state.schwab.holdings?.length || 0) + (state.schwab.mutualFunds?.length || 0) })
                  </button>
                  <button
                    onClick={() => setActiveTab('brokerPositions')}
                    className={`px-4 py-2 text-xs font-mono uppercase font-bold tracking-wider transition-all flex items-center gap-1.5 ${
                      activeTab === 'brokerPositions'
                        ? 'border-b-2 border-blue-500 text-blue-400 bg-blue-950/15'
                        : 'text-blue-500/80 hover:text-blue-400'
                    }`}
                  >
                    ⚡ Broker Open Trades ({state.schwab.livePositions?.length || 0})
                  </button>
                </>
              )}
              <button
                onClick={() => setActiveTab('positions')}
                className={`px-4 py-2 text-xs font-mono uppercase font-bold tracking-wider transition ${
                  activeTab === 'positions'
                    ? 'border-b-2 border-amber-500 text-amber-500 bg-zinc-950/40'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Active Positions ({state?.positions.length || 0})
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`px-4 py-2 text-xs font-mono uppercase font-bold tracking-wider transition-all ${
                  activeTab === 'history'
                    ? 'border-b-2 border-amber-500 text-amber-500 bg-zinc-950/40'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Closed Trade ledger ({state?.historicalTrades.length || 0})
              </button>
              <button
                onClick={() => setActiveTab('deferred')}
                className={`px-4 py-2 text-xs font-mono uppercase font-bold tracking-wider transition-all ${
                  activeTab === 'deferred'
                    ? 'border-b-2 border-amber-500 text-amber-500 bg-zinc-950/40'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Scan Pipeline Deferrals ({state?.deferredSignals.length || 0})
              </button>
              <button
                onClick={() => setActiveTab('blocked')}
                className={`px-4 py-2 text-xs font-mono uppercase font-bold tracking-wider transition-all ${
                  activeTab === 'blocked'
                    ? 'border-b-2 border-amber-500 text-amber-500 bg-zinc-950/40'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Pre-Scan Exclusions ({state?.blockedSignals.length || 0})
              </button>
              <button
                onClick={() => setActiveTab('archive')}
                className={`px-4 py-2 text-xs font-mono uppercase font-bold tracking-wider transition-all ${
                  activeTab === 'archive'
                    ? 'border-b-2 border-amber-500 text-amber-500 bg-zinc-950/40'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Prior Scan Archive ({state?.scanArchive.length || 0})
              </button>
              <button
                onClick={() => setActiveTab('liquidationReview')}
                className={`px-4 py-2 text-xs font-mono uppercase font-bold tracking-wider transition-all ${
                  activeTab === 'liquidationReview'
                    ? 'border-b-2 border-amber-500 text-amber-500 bg-zinc-950/40'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Post-Liquidation Review ({state?.postLiquidationQueue?.length || 0})
              </button>
            </div>

            {/* TAB PANES */}
            <div className="min-h-[220px]">

              {/* BROKER PORTFOLIO (HOLDINGS / MUTUAL FUNDS) */}
              {activeTab === 'brokerHoldings' && (() => {
                const holdings = state?.schwab?.holdings || [];
                const mutualFunds = state?.schwab?.mutualFunds || [];
                
                let totalInvestedEquity = 0;
                let totalCurrentEquity = 0;
                holdings.forEach((h: any) => {
                  const qty = parseFloat(h.quantity || h.qty || '0');
                  const avgPrice = parseFloat(h.averageprice || h.avgprice || '0');
                  const ltp = parseFloat(h.ltp || h.lastTradedPrice || '0');
                  totalInvestedEquity += qty * avgPrice;
                  totalCurrentEquity += qty * ltp;
                });

                let totalInvestedMF = 0;
                let totalCurrentMF = 0;
                mutualFunds.forEach((mf: any) => {
                  const qty = parseFloat(mf.quantity || '0');
                  const avgPrice = parseFloat(mf.averageprice || '0');
                  const ltp = parseFloat(mf.ltp || '0');
                  totalInvestedMF += qty * avgPrice;
                  totalCurrentMF += qty * ltp;
                });

                const totalInvested = totalInvestedEquity + totalInvestedMF;
                const totalCurrent = totalCurrentEquity + totalCurrentMF;
                const overallGain = totalCurrent - totalInvested;
                const overallGainPct = totalInvested > 0 ? (overallGain / totalInvested) * 100 : 0;

                // Today's Gain calculation
                let todaysGainSum = 0;
                holdings.forEach((h: any) => {
                  const qty = parseFloat(h.quantity || '0');
                  const ltp = parseFloat(h.ltp || '0');
                  const prevClose = parseFloat(h.close || h.averageprice || '0');
                  todaysGainSum += (ltp - prevClose) * qty;
                });
                mutualFunds.forEach((mf: any) => {
                  const qty = parseFloat(mf.quantity || '0');
                  const ltp = parseFloat(mf.ltp || '0');
                  const prevClose = parseFloat(mf.close || mf.averageprice || '0');
                  todaysGainSum += (ltp - prevClose) * qty;
                });
                const todaysGainPct = totalInvested > 0 ? (todaysGainSum / totalInvested) * 100 : 0;

                const triggerSimulation = async () => {
                  setAngelLoading(true);
                  try {
                    const res = await fetch('/api/schwab/simulate', { method: 'POST' });
                    if (res.ok) {
                      const data = await res.json();
                      setState(prev => {
                        if (!prev) return null;
                        return { ...prev, schwab: data.schwab, paperBalance: data.schwab.availableNetMargin || prev.paperBalance };
                      });
                      flashMessage('Simulation holdings and positions populated in your local sandbox successfully!', 'success');
                    } else {
                      flashMessage('Failed to trigger portfolio simulation.', 'error');
                    }
                  } catch (err) {
                    flashMessage('Simulation endpoint network fault.', 'error');
                  } finally {
                    setAngelLoading(false);
                  }
                };

                return (
                  <div className="space-y-4 pt-2 font-mono">
                    {/* Header Broker Status */}
                    <div className="flex flex-wrap items-center justify-between gap-3 bg-blue-950/10 border border-blue-500/20 p-3 rounded">
                      <div>
                        <div className="text-[10px] text-blue-400 font-bold uppercase tracking-wider">Schwab Trading Console</div>
                        <h4 className="text-sm font-bold text-zinc-100 mt-0.5">Linked Client Code: <span className="text-blue-400">{state?.schwab?.clientCode}</span> ({state?.schwab?.profileName})</h4>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={refreshAngelBalance}
                          disabled={angelLoading}
                          className="bg-zinc-900 border border-zinc-850 hover:border-zinc-700 text-zinc-200 px-3 py-1.5 rounded text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 mr-0.5 ${angelLoading ? 'animate-spin' : ''}`} />
                          SYNC HOLDINGS
                        </button>
                        {(holdings.length === 0 && mutualFunds.length === 0) && (
                          <button
                            type="button"
                            onClick={triggerSimulation}
                            disabled={angelLoading}
                            className="bg-amber-950/80 hover:bg-amber-900 border border-amber-500/30 text-amber-300 px-3 py-1.5 rounded text-xs font-bold transition cursor-pointer"
                          >
                            🧪 RUN SIMULATED PORTFOLIO
                          </button>
                        )}
                      </div>
                    </div>

                    {/* STATS MATRIX */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 bg-zinc-950/20 p-1 rounded-md">
                      <div className="bg-[#050608] border border-zinc-900 p-3 rounded">
                        <div className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider">Invested Amount</div>
                        <div className="text-lg font-black text-white mt-1">{cSign}{formatNumber(totalInvested, 2, 2)}</div>
                        <div className="text-[8.5px] text-zinc-600 mt-0.5 font-normal">Original Cost Basis</div>
                      </div>

                      <div className="bg-[#050608] border border-zinc-900 p-3 rounded">
                        <div className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider">Current Value</div>
                        <div className="text-lg font-black text-zinc-100 mt-1">{cSign}{formatNumber(totalCurrent, 2, 2)}</div>
                        <div className="text-[8.5px] text-zinc-650 mt-0.5 font-normal">Market Valuation (LTP)</div>
                      </div>

                      <div className={`p-3 rounded border ${overallGain >= 0 ? 'bg-[#0a0f0d]/90 border-emerald-500/20' : 'bg-[#120a0b]/90 border-rose-500/20'}`}>
                        <div className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider">Overall Gain</div>
                        <div className={`text-lg font-black mt-1 ${overallGain >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {overallGain >= 0 ? '+' : ''}{cSign}{formatNumber(overallGain, 2, 2)}
                        </div>
                        <div className={`text-[9.5px] font-bold ${overallGain >= 0 ? 'text-emerald-500/80' : 'text-rose-500/80'} mt-0.5`}>
                          {overallGain >= 0 ? '▲' : '▼'} {overallGainPct.toFixed(2)}%
                        </div>
                      </div>

                      <div className={`p-3 rounded border ${todaysGainSum >= 0 ? 'bg-[#0a0f0d]/90 border-emerald-500/20' : 'bg-[#120a0b]/90 border-rose-500/20'}`}>
                        <div className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider">Today's Gain</div>
                        <div className={`text-lg font-black mt-1 ${todaysGainSum >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {todaysGainSum >= 0 ? '+' : ''}{cSign}{formatNumber(todaysGainSum, 2, 2)}
                        </div>
                        <div className={`text-[9.5px] font-bold ${todaysGainSum >= 0 ? 'text-emerald-500/80' : 'text-rose-500/80'} mt-0.5`}>
                          {todaysGainSum >= 0 ? '▲' : '▼'} {todaysGainPct.toFixed(2)}%
                        </div>
                      </div>
                    </div>

                    {/* PORTFOLIO BREAKDOWN LISTS */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      
                      {/* EQUITY */}
                      <div className="bg-[#050608] border border-zinc-900 rounded-md p-3.5">
                        <div className="text-[10px] uppercase font-mono font-bold tracking-wider text-zinc-400 mb-3 border-b border-zinc-900 pb-1.5 flex justify-between items-center">
                          <span>💼 Equity holdings ({holdings.length})</span>
                          <span className="text-[9px] text-zinc-500">NYSE/Nasdaq Assets</span>
                        </div>
                        
                        {holdings.length === 0 ? (
                          <div className="text-center py-10 text-zinc-600 font-sans leading-normal text-xs">
                            <p className="text-zinc-500">You have not invested in equities on Schwab yet.</p>
                            <button
                              type="button" 
                              onClick={triggerSimulation}
                              className="text-amber-500 hover:text-amber-400 hover:underline mt-2 font-mono text-[10px] uppercase font-bold cursor-pointer"
                            >
                              INVEST NOW (SIMULATION)
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                            {holdings.map((h: any, idx: number) => {
                              const qty = parseFloat(h.quantity || '0');
                              const avg = parseFloat(h.averageprice || '0');
                              const ltp = parseFloat(h.ltp || '0');
                              const cost = qty * avg;
                              const value = qty * ltp;
                              const pnl = value - cost;
                              const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
                              return (
                                <div key={idx} className="bg-[#0b0c10] border border-zinc-900/60 p-2.5 rounded transition hover:border-zinc-805 flex justify-between items-center text-[10.5px]">
                                  <div>
                                    <div className="font-bold text-zinc-150 uppercase tracking-wide">{h.tradingsymbol || h.symbol}</div>
                                    <div className="text-[9.5px] text-zinc-550 mt-0.5 font-normal">{qty} Shares @ Avg {cSign}{avg.toFixed(2)}</div>
                                  </div>
                                  <div className="text-right">
                                    <div className="font-bold text-zinc-200">{cSign}{value.toFixed(2)}</div>
                                    <div className={`text-[9.5px] font-bold ${pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'} mt-0.5`}>
                                      {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} ({pnlPct.toFixed(2)}%)
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* MUTUAL FUNDS */}
                      <div className="bg-[#050608] border border-zinc-900 rounded-md p-3.5">
                        <div className="text-[10px] uppercase font-mono font-bold tracking-wider text-zinc-400 mb-3 border-b border-zinc-900 pb-1.5 flex justify-between items-center">
                          <span>📦 ETF holdings ({mutualFunds.length})</span>
                          <span className="text-[9px] text-zinc-500">Broad market funds</span>
                        </div>

                        {mutualFunds.length === 0 ? (
                          <div className="text-center py-10 text-zinc-650 font-sans leading-normal text-xs">
                            <p className="text-zinc-500">You have not invested in ETFs on Schwab yet.</p>
                            <button
                              type="button" 
                              onClick={triggerSimulation}
                              className="text-amber-500 hover:text-amber-400 hover:underline mt-2 font-mono text-[10px] uppercase font-bold cursor-pointer"
                            >
                              INVEST NOW (SIMULATION)
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                            {mutualFunds.map((mf: any, idx: number) => {
                              const qty = parseFloat(mf.quantity || '0');
                              const avg = parseFloat(mf.averageprice || '0');
                              const ltp = parseFloat(mf.ltp || '0');
                              const cost = qty * avg;
                              const value = qty * ltp;
                              const pnl = value - cost;
                              const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
                              return (
                                <div key={idx} className="bg-[#0b0c10] border border-zinc-900/60 p-2.5 rounded transition hover:border-zinc-805 flex justify-between items-center text-[10.5px]">
                                  <div className="w-[60%]">
                                    <div className="font-bold text-zinc-150 truncate block" title={mf.mffname}>{mf.mffname}</div>
                                    <div className="text-[9.5px] text-zinc-550 mt-0.5 font-normal">{qty.toFixed(3)} Units @ Avg {cSign}{avg.toFixed(4)}</div>
                                  </div>
                                  <div className="text-right">
                                    <div className="font-bold text-zinc-200">{cSign}{value.toFixed(2)}</div>
                                    <div className={`text-[9.5px] font-bold ${pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'} mt-0.5`}>
                                      {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} ({pnlPct.toFixed(2)}%)
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                    </div>
                  </div>
                );
              })()}

              {/* BROKER OPEN DAY TRADES */}
              {activeTab === 'brokerPositions' && (() => {
                const positions = state?.schwab?.livePositions || [];
                return (
                  <div className="space-y-4 pt-2 font-mono text-xs">
                    {/* Header */}
                    <div className="bg-blue-950/10 border border-blue-500/20 p-3 rounded flex justify-between items-center">
                      <div>
                        <div className="text-[10px] text-blue-400 font-bold uppercase tracking-wider">Live Broker Positions (Margin / Intraday)</div>
                        <span className="text-[11px] text-zinc-400">Day trades routed to NYSE/Nasdaq market centers</span>
                      </div>
                      <button
                        type="button"
                        onClick={refreshAngelBalance}
                        disabled={angelLoading}
                        className="bg-zinc-900 border border-zinc-850 hover:border-zinc-700 text-zinc-250 px-3 py-1.5 rounded text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 mr-0.5 ${angelLoading ? 'animate-spin' : ''}`} />
                        SYNC POSITIONS
                      </button>
                    </div>

                    <div className="overflow-x-auto">
                      {positions.length === 0 ? (
                        <div className="text-center py-12 text-zinc-500 bg-[#050608] border border-zinc-900 rounded-md">
                          ● There are no active open intraday margin or derivatives positions on Schwab.
                        </div>
                      ) : (
                        <table className="w-full text-left font-mono text-xs text-zinc-300 bg-[#050608] border border-zinc-900 rounded-md overflow-hidden">
                          <thead>
                            <tr className="border-b border-zinc-900 text-zinc-500 text-[10px] uppercase font-bold bg-[#07090d]">
                              <th className="p-3">Trading Symbol</th>
                              <th className="p-3">Product Type</th>
                              <th className="p-3 text-right">Net Quantity</th>
                              <th className="p-3 text-right">Entry Avg Price</th>
                              <th className="p-3 text-right">LTP Mark Price</th>
                              <th className="p-3 text-right">Live Profit / Loss</th>
                            </tr>
                          </thead>
                          <tbody>
                            {positions.map((p: any, idx: number) => {
                              const netQty = parseFloat(p.netqty || p.netQty || '0');
                              const avgPrice = parseFloat(p.avgnetprice || p.averageprice || '0');
                              const ltp = parseFloat(p.ltp || '0');
                              const pnl = parseFloat(p.pnl || '0');
                              return (
                                <tr key={idx} className="border-b border-zinc-950 hover:bg-zinc-900/40 transition">
                                  <td className="p-3 font-bold text-zinc-250 uppercase">{p.tradingsymbol || p.symbol || 'Asset'}</td>
                                  <td className="p-3">
                                    <span className="text-[9px] bg-blue-955 text-blue-400 px-1 py-0.5 border border-blue-500/20 rounded uppercase font-bold">
                                      {p.producttype || 'INTRADAY'}
                                    </span>
                                  </td>
                                  <td className="p-3 text-right font-medium">{netQty}</td>
                                  <td className="p-3 text-right">₹{avgPrice.toFixed(2)}</td>
                                  <td className="p-3 text-right text-zinc-100 font-medium">₹{ltp.toFixed(2)}</td>
                                  <td className="p-3 text-right font-bold">
                                    <span className={pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}>
                                      {pnl >= 0 ? '+' : ''}₹{pnl.toFixed(2)}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* PANES 1: ACTIVE POSITIONS */}
              {activeTab === 'positions' && (
                <div className="overflow-x-auto" id="active_positions_table_container">
                  {(!state || state.positions.length === 0) ? (
                    <div className="text-center py-12 text-zinc-650 font-mono text-xs">
                      No active stock margin trades. See candidate scan triggers or use the trading workbench to place paper orders.
                    </div>
                  ) : (
                    <table className="w-full text-left font-mono text-xs text-zinc-300">
                      <thead>
                        <tr className="border-b border-zinc-900 text-zinc-500 text-[10px] uppercase font-bold uppercase font-mono">
                          <th className="pb-2">ID</th>
                          <th className="pb-2">Asset</th>
                          <th className="pb-2">Leverage</th>
                          <th className="pb-2">Side</th>
                          <th className="pb-2">Entry Price</th>
                          <th className="pb-2">Mark Price</th>
                          <th className="pb-2">Bracket Protective SL / TP</th>
                          <th className="pb-2">Alloc Margin</th>
                          <th className="pb-2 text-right">Contracts size</th>
                          <th className="pb-2 text-right">PNL</th>
                          <th className="pb-2 text-right">EXIT</th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.positions.map((p) => {
                          const isLong = p.side === 'BUY';
                          const isOurs = p.manualOverride;
                          return (
                            <tr key={p.id} className="border-b border-zinc-950 hover:bg-zinc-900/40 transition">
                              <td className="py-2.5 text-zinc-500">{p.id}</td>
                              <td className="py-2.5 font-bold text-white flex items-center gap-1">
                                {state?.marketMode === 'us_stocks' ? p.symbol : p.symbol.replace('USDT', '')}
                                {isOurs && <span className="text-[8px] border border-amber-600/50 text-amber-400 px-1 py-0.5 rounded ml-0.5">MAN</span>}
                              </td>
                              <td className="py-2.5">{p.leverage}x</td>
                              <td className="py-2.5">
                                <span className={`px-1 rounded text-[9px] font-bold ${isLong ? 'bg-emerald-950 text-emerald-300' : 'bg-rose-950 text-rose-300'}`}>
                                  {isLong ? 'BUY' : 'SELL'}
                                </span>
                              </td>
                              <td className="py-2.5">{cSign}{formatNumber(p.entryPrice, 4, 2)}</td>
                              <td className="py-2.5">{cSign}{formatNumber(p.currentPrice, 4, 2)}</td>
                              <td className="py-2.5">
                                <span className="text-[9.5px] text-zinc-400">SL: </span><span className="text-rose-400">{cSign}{p.stopLoss.toFixed(2)}</span>
                                <span className="text-zinc-600 block"></span>
                                <span className="text-[9.5px] text-zinc-400">TP: </span><span className="text-teal-400">{cSign}{p.takeProfit.toFixed(2)}</span>
                              </td>
                              <td className="py-2.5">
                                <div>{cSign}{formatNumber(p.margin, 0, 0)} {cName}</div>
                                {p.entryFee !== undefined && (
                                  <div className="text-[10px] text-zinc-500 font-normal">Entry Fee: {cSign}{p.entryFee.toFixed(2)}</div>
                                )}
                              </td>
                              <td className="py-2.5 text-right font-semibold">{formatNumber(p.size, 4, 0)}</td>
                              <td className="py-2.5 text-right">
                                <span className={`font-bold font-mono text-xs ${p.unrealizedPnl > 0 ? 'text-emerald-500' : p.unrealizedPnl < 0 ? 'text-rose-500' : 'text-zinc-400'}`}>
                                  {p.unrealizedPnl > 0 ? '+' : ''}{cSign}{p.unrealizedPnl.toFixed(2)}
                                  <span className="text-[9.5px] block font-normal">({p.pnlPercent > 0 ? '+' : ''}{p.pnlPercent.toFixed(1)}%)</span>
                                </span>
                              </td>
                              <td className="py-2.5 text-right">
                                <button
                                  onClick={() => executePositionClose(p.id, p.symbol)}
                                  className="bg-rose-950 hover:bg-rose-900 border border-rose-800 text-rose-300 px-2 py-1 rounded text-[10px] uppercase font-bold transition"
                                >
                                  Close
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* PANES 2: CLOSED LEDGER */}
              {activeTab === 'history' && (
                <div className="overflow-x-auto">
                  {(!state || state.historicalTrades.length === 0) ? (
                    <div className="text-center py-12 text-zinc-650 font-mono text-xs">
                      Ledger is empty. No closed trades archived.
                    </div>
                  ) : (
                    <table className="w-full text-left font-mono text-xs text-zinc-300">
                      <thead>
                        <tr className="border-b border-zinc-900 text-zinc-500 text-[10px] uppercase font-bold">
                          <th className="pb-2">Time</th>
                          <th className="pb-2">Asset</th>
                          <th className="pb-2">Side</th>
                          <th className="pb-2">Entry Price</th>
                          <th className="pb-2">Exit Price</th>
                          <th className="pb-2">Margin Lever</th>
                          <th className="pb-2">Brokerage & Taxes</th>
                          <th className="pb-2">Exit Catalyst</th>
                          <th className="pb-2 text-right">Net Profit PNL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.historicalTrades.map((ht) => {
                          const isWin = ht.pnl >= 0;
                          return (
                            <tr key={ht.id} className="border-b border-zinc-950 hover:bg-zinc-900/30 transition">
                              <td className="py-2 text-zinc-500">{ht.timestamp}</td>
                              <td className="py-2 font-bold text-white">{state?.marketMode === 'us_stocks' ? ht.symbol : ht.symbol.replace('USDT', '')}</td>
                              <td className="py-2">
                                <span className={`px-1 rounded text-[9px] font-bold ${ht.side === 'BUY' ? 'bg-emerald-950 text-emerald-300' : 'bg-rose-950 text-rose-300'}`}>
                                  {ht.side === 'BUY' ? 'BUY' : 'SELL'}
                                </span>
                              </td>
                              <td className="py-2">{cSign}{formatNumber(ht.entryPrice, 4, 2)}</td>
                              <td className="py-2">{cSign}{formatNumber(ht.exitPrice, 4, 2)}</td>
                              <td className="py-2">{cSign}{formatNumber(ht.margin, 0, 0)} ({ht.leverage}x)</td>
                              <td className="py-2 text-zinc-400">
                                {ht.totalFee !== undefined ? `${cSign}${formatNumber(ht.totalFee, 2, 2)}` : `${cSign}0.00`}
                                <span className="text-[10px] block text-zinc-650">({ht.entryFee !== undefined ? `E: ${cSign}${formatNumber(ht.entryFee, 0, 0)}` : 'E: 0'} / {ht.exitFee !== undefined ? `X: ${cSign}${formatNumber(ht.exitFee, 0, 0)}` : 'X: 0'})</span>
                              </td>
                              <td className="py-2">
                                <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded font-mono ${
                                  ht.exitReason === 'TAKE_PROFIT' ? 'bg-teal-950/70 border border-teal-500/30 text-teal-400' :
                                  ht.exitReason === 'STOP_LOSS' ? 'bg-rose-950/70 border border-rose-500/30 text-rose-400' :
                                  ht.exitReason === 'LIQUIDATION' ? 'bg-red-950 border border-red-500 text-red-100 font-bold' :
                                  'bg-zinc-900 text-zinc-400'
                                }`}>
                                  {ht.exitReason}
                                </span>
                              </td>
                              <td className={`py-2 text-right font-bold text-xs ${isWin ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {isWin ? '+' : ''}{cSign}{ht.pnl.toFixed(2)}
                                <span className="text-[9.5px] block font-normal">({ht.pnlPercent >= 0 ? '+' : ''}{ht.pnlPercent.toFixed(1)}%)</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* PANES 3: DEFERRALS PIPELINE */}
              {activeTab === 'deferred' && (
                <div className="overflow-x-auto">
                  {(!state || state.deferredSignals.length === 0) ? (
                    <div className="text-center py-12 text-zinc-650 font-mono text-xs">
                      No deferred results generated. Click manual scan to inspect candidate coins.
                    </div>
                  ) : (
                    <table className="w-full text-left font-mono text-xs text-zinc-300">
                      <thead>
                        <tr className="border-b border-zinc-900 text-zinc-500 text-[10px] uppercase font-bold">
                          <th className="pb-2">Asset</th>
                          <th className="pb-2">Mark Price</th>
                          <th className="pb-2">Indicator Score</th>
                          <th className="pb-2">Diagnosis Exclusion Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.deferredSignals.map((d, i) => (
                          <tr key={i} className="border-b border-zinc-950 hover:bg-zinc-900/20 transition">
                            <td className="py-2 text-white font-bold">{state?.marketMode === 'us_stocks' ? d.symbol : d.symbol.replace('USDT', '')}</td>
                            <td className="py-2">{cSign}{formatNumber(d.price, 4, 2)}</td>
                            <td className={`py-2 font-bold ${d.score > 0 ? 'text-emerald-500' : d.score < 0 ? 'text-rose-400' : 'text-zinc-500'}`}>
                              {d.score > 0 ? `+${d.score}` : d.score}
                            </td>
                            <td className="py-2 text-zinc-400 italic text-[11px]">{d.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* PANES 4: EXCLUSIONS */}
              {activeTab === 'blocked' && (
                <div className="overflow-x-auto">
                  {(!state || state.blockedSignals.length === 0) ? (
                    <div className="text-center py-12 text-zinc-650 font-mono text-xs">
                      No candidate coins blocked pre-analysis in the current sweep.
                    </div>
                  ) : (
                    <table className="w-full text-left font-mono text-xs text-zinc-300">
                      <thead>
                        <tr className="border-b border-zinc-900 text-zinc-500 text-[10px] uppercase font-bold">
                          <th className="pb-2">Asset Pair</th>
                          <th className="pb-2">Pre-Screen Exclusivity Core Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.blockedSignals.map((b, i) => (
                          <tr key={i} className="border-b border-zinc-950 hover:bg-zinc-900/20 transition">
                            <td className="py-2 font-bold text-rose-400">{state?.marketMode === 'us_stocks' ? b.symbol : b.symbol}</td>
                            <td className="py-2 text-zinc-400 font-mono">{b.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* PANES 5: COMPLETED SCAN CYCLES */}
              {activeTab === 'archive' && (
                <div className="overflow-x-auto font-mono text-xs text-zinc-300">
                  {(!state || state.scanArchive.length === 0) ? (
                    <div className="text-center py-12 text-zinc-650 text-xs">
                      Scan log archive is blank. Launch scan sequences to persist logs.
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-[400px] overflow-y-auto">
                      {state.scanArchive.map((arch, i) => (
                        <div key={i} className="bg-zinc-950/60 p-3 rounded border border-zinc-900 flex justify-between items-center flex-wrap gap-2 text-[11px]">
                          <div>
                            <span className="text-indigo-400 font-bold">CYCLE #{state.scanArchive.length - i}</span>
                            <span className="text-zinc-500 ml-3">{arch.summary.timestamp}</span>
                            <div className="text-zinc-400 text-[10px] mt-1">
                              Parsed: {arch.summary.analyzedCount}/{arch.summary.totalMarkets} Tick Candidates | 
                              Excluded: {arch.summary.blockedCount} pre-filtered | Deferrals: {arch.summary.deferredCount} holdings
                            </div>
                          </div>
                          
                          <div className="flex gap-2">
                            <span className="bg-emerald-950 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded text-[10px] uppercase font-bold">
                              {arch.summary.buyCount} Buy Setups
                            </span>
                            <span className="bg-rose-950 border border-rose-500/20 text-rose-400 px-2 py-0.5 rounded text-[10px] uppercase font-bold">
                              {arch.summary.sellCount} Sell Setups
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* PANES 6: POST-LIQUIDATION REVIEW QUEUE */}
              {activeTab === 'liquidationReview' && (
                <div className="overflow-x-auto font-mono text-xs text-zinc-300">
                  {(!state || !state.postLiquidationQueue || state.postLiquidationQueue.length === 0) ? (
                    <div className="text-center py-12 text-zinc-650 text-xs">
                      Post-liquidation review queue is currently empty. No active hazard blocks detected.
                    </div>
                  ) : (
                    <div>
                      <div className="mb-4 text-[11px] text-zinc-400 bg-rose-950/20 border border-rose-950/40 p-3 rounded flex justify-between items-center gap-4 flex-wrap">
                        <div>
                          <strong className="text-rose-400 uppercase">Hazard Cooling Engaged:</strong> Liquidated symbols are automatically locked from any automated/autonomous execution to preserve capital. Operator must inspect the asset and manually clear the hazard block or run a manual buy/sell trade to bypass.
                        </div>
                        <button
                          onClick={async () => {
                            try {
                              const res = await fetch('/api/clear-liquidation', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({}),
                              });
                              if (!res.ok) throw new Error('Failed to purge');
                              setSuccessMessage('Successfully dismissed all liquidation review blocks.');
                              fetchState();
                            } catch (err: any) {
                              setErrorMessage(err.message || 'Error purging liquidation list');
                            }
                          }}
                          className="bg-zinc-900 hover:bg-zinc-805 border border-zinc-850 text-zinc-300 hover:text-white px-3 py-1 rounded transition text-[10px] font-bold uppercase font-mono cursor-pointer"
                        >
                          DISMISS ALL BLOCKS
                        </button>
                      </div>

                      <table className="w-full text-left font-mono text-xs text-zinc-300">
                        <thead>
                          <tr className="border-b border-zinc-900 text-zinc-500 text-[10px] uppercase font-bold uppercase font-mono">
                            <th className="py-2">Symbol</th>
                            <th className="py-2">Liquidation Registered At</th>
                            <th className="py-2">Execution Health Status</th>
                            <th className="py-2 text-right">Emergency Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {state.postLiquidationQueue.map((item, idx) => {
                            const isSelected = selectedSymbol === item.symbol;
                            const currentSignal = state.lastNonEmptyRanked.find(r => r.symbol === item.symbol);
                            
                            return (
                              <tr key={idx} className={`border-b border-zinc-900 hover:bg-zinc-950/40 transition-colors ${isSelected ? 'bg-amber-950/10' : ''}`}>
                                <td className="py-2 font-bold text-rose-400">
                                  <button
                                    onClick={() => setSelectedSymbol(item.symbol)}
                                    className="hover:underline font-mono text-left focus:outline-none cursor-pointer"
                                  >
                                    {item.symbol}
                                  </button>
                                </td>
                                <td className="py-2 text-zinc-400">{item.timestamp}</td>
                                <td className="py-2">
                                  {currentSignal ? (
                                    <div className="flex items-center gap-1.5">
                                      <span className={`w-1.5 h-1.5 rounded-full ${currentSignal.direction === 'BUY' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                                      <span className="text-[10px] text-zinc-300 font-bold">
                                        Active Signal: {currentSignal.direction} (Score {currentSignal.score.toFixed(1)})
                                      </span>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1.5">
                                      <span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
                                      <span className="text-[10px] text-zinc-500">No convergent strategy signal</span>
                                    </div>
                                  )}
                                </td>
                                <td className="py-2 text-right">
                                  <div className="flex items-center justify-end gap-2">
                                    <button
                                      onClick={() => {
                                        setSelectedSymbol(item.symbol);
                                        window.scrollTo({ top: 300, behavior: 'smooth' });
                                      }}
                                      className="bg-indigo-950/60 hover:bg-indigo-900/60 border border-indigo-500/20 text-indigo-400 px-2.5 py-1 rounded transition text-[10px] uppercase font-mono cursor-pointer"
                                    >
                                      INSPECT CHARTS
                                    </button>
                                    <button
                                      onClick={async () => {
                                        try {
                                          const res = await fetch('/api/clear-liquidation', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ symbol: item.symbol }),
                                          });
                                          if (!res.ok) throw new Error('Failed to dismiss');
                                          setSuccessMessage(`Successfully cleared block for ${item.symbol}`);
                                          fetchState();
                                        } catch (err: any) {
                                          setErrorMessage(err.message || 'Error dismissing lock');
                                        }
                                      }}
                                      className="bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white px-2.5 py-1 rounded transition text-[10px] cursor-pointer"
                                    >
                                      DISMISS HAZARD
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

            </div>

          </div>

          {/* TELEMETRY STREAM RX LOGGER CONSOLE BOX */}
          <div className="bg-[#040507] border border-zinc-900 rounded-lg p-3 font-mono flex flex-col gap-2 relative">
            <div className="flex justify-between items-center text-[10px] uppercase font-bold tracking-widest text-zinc-500 border-b border-zinc-900 pb-2">
              <span className="flex items-center gap-1.5"><Terminal className="w-3.5 h-3.5 text-zinc-400 animate-pulse" /> Live Telemetry Operator Stream Logs</span>
              <span className="text-zinc-600 font-normal">FIFO console buffer (active)</span>
            </div>

            <div ref={logsContainerRef} className="h-44 overflow-y-auto font-mono text-[10px] text-zinc-400 scrollbar-thin flex flex-col gap-0.5 select-text">
              {state?.logs && [...state.logs].reverse().map((log, i) => {
                let color = 'text-zinc-400';
                if (log.includes('[Scanner]')) color = 'text-indigo-300';
                if (log.includes('Opened')) color = 'text-emerald-400 font-semibold';
                if (log.includes('Pnl') || log.includes('PNL')) color = 'text-teal-400';
                if (log.includes('CRITICAL') || log.includes('LIQUIDATION')) color = 'text-rose-500 font-bold';
                
                return (
                  <div key={i} className={`${color} leading-relaxed`}>
                    {log}
                  </div>
                );
              })}
              <div ref={logsEndRef} />
            </div>
          </div>

        </section>

      </div>

      {/* FOOTER */}
      <footer className="border-t border-zinc-950 bg-[#06070a] text-center p-3 text-zinc-600 text-[10px] font-mono tracking-wider mt-auto">
        Tradeedge_WallStreet Operational Console Core Operating Intelligence • Licensed and configured under system prompts.
      </footer>
    </div>
  );
}
