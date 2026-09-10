export type Trade = {
  date: string;
  price: number;
  quantity: number;
  action: string;
  symbol?: string;
  pnl?: number;
};

export type EquityCurvePoint = {
  date: string;
  equity: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  cash?: number;
  position?: number;
};

export type BacktestResult = {
  asset: string;
  sharpe: number;
  total_return: number;
  max_drawdown: number;
  total_trades: number;
  pnl_amount: number;
  initial_cash: number;
  ending_cash: number;
  final_equity: number;
  equity_curve: EquityCurvePoint[];
  trades: Trade[];
  [key: string]: unknown;
};

export type BacktestJobResult = {
  run_id?: string;
  job_id?: string;
  status: string;
  error?: string | null;
  result?: BacktestResult;
  [key: string]: unknown;
};

export type BacktestJobStatus = {
  status: string;
  run_id?: string;
  job_id?: string;
  message?: string;
  [key: string]: unknown;
};

export type BacktestJobSubmitPayload = {
  symbol: string;
  asset: string;
  market: string;
  start: string;
  end: string;
  timeframe: string;
  strategy: string;
  context?: Record<string, unknown>;
  config?: Record<string, unknown>;
};

export type BacktestPayload = {
  symbol: string;
  market: string;
  start: string;
  end: string;
  strategy: string;
  context?: Record<string, unknown>;
  [key: string]: unknown;
};

export type BacktestResponse = {
  status: string;
  run_id?: string;
  result?: BacktestResult;
  error?: string;
  [key: string]: unknown;
};

export type InsightData = {
  insight: string;
  [key: string]: unknown;
};

export type BacktestAnalytics = {
  monthly_returns: Array<{ year: number; month: number; return_pct: number }>;
  drawdown_series: Array<{ date: string; drawdown_pct: number; equity: number; peak: number }>;
  rolling_metrics: Array<{ date: string; rolling_sharpe: number; rolling_volatility: number; rolling_return: number }>;
  return_distribution: {
    bins: number[];
    counts: number[];
    stats: Record<string, number>;
  };
  trade_analytics: {
    scatter: Array<{
      entry_date: string;
      exit_date: string;
      pnl: number;
      return_pct: number;
      holding_days: number;
    }>;
    streaks: {
      max_win_streak: number;
      max_loss_streak: number;
      current_streak: number;
      current_streak_type: string;
    };
    summary: Record<string, number>;
  };
  [key: string]: unknown;
};

export type WalkForwardWindow = {
  window: string;
  train_start: string;
  train_end: string;
  test_start: string;
  test_end: string;
  sharpe: number;
  total_return: number;
  max_drawdown: number;
};

export type SensitivityRow = {
  id: string;
  data: Array<{ x: string; y: number }>;
};