import { api } from "./base";

export interface PairTestResult {
  symbol1: string;
  symbol2: string;
  period: string;
  period_start: string;
  period_end: string;
  alpha: number;
  beta: number;
  adf_stat: number;
  adf_pvalue: number;
  coint_pvalue: number;
  half_life: number;
  zscore_current: number;
  resid_mean: number;
  resid_std: number;
  cointegrated: boolean;
  verdict: string;
}

export interface PairSpreadPoint {
  date: string;
  price1: number;
  price2: number;
  hedged: number;
  spread: number;
  zscore: number | null;
}

export interface PairSpreadResult {
  symbol1: string;
  symbol2: string;
  beta: number;
  entry_z: number;
  exit_z: number;
  points: PairSpreadPoint[];
}

export interface PairEquityPoint {
  date: string;
  equity: number | null;
  position: number;
  zscore: number | null;
}

export interface PairSignalsResult {
  symbol1: string;
  symbol2: string;
  beta: number;
  entry_z: number;
  exit_z: number;
  equity: PairEquityPoint[];
  stats: {
    trades: number;
    win_rate: number;
    sharpe: number;
    max_drawdown: number;
    total_return: number;
  };
}

export interface PairScanItem {
  symbol1: string;
  symbol2: string;
  beta: number;
  coint_pvalue: number;
  adf_pvalue: number;
  half_life: number;
  zscore_current: number;
  cointegrated: boolean;
}

export interface PairScanResult {
  period: string;
  results: PairScanItem[];
}

export async function fetchPairTest(payload: {
  symbol1: string;
  symbol2: string;
  period?: string;
}): Promise<PairTestResult> {
  const { data } = await api.post<PairTestResult>("/pairs/test", payload);
  return data;
}

export async function fetchPairSpread(payload: {
  symbol1: string;
  symbol2: string;
  period?: string;
  zwindow?: number;
  entry_z?: number;
  exit_z?: number;
}): Promise<PairSpreadResult> {
  const { data } = await api.post<PairSpreadResult>("/pairs/spread", payload);
  return data;
}

export async function fetchPairSignals(payload: {
  symbol1: string;
  symbol2: string;
  period?: string;
  zwindow?: number;
  entry_z?: number;
  exit_z?: number;
}): Promise<PairSignalsResult> {
  const { data } = await api.post<PairSignalsResult>("/pairs/signals", payload);
  return data;
}

export async function fetchPairScan(payload: {
  symbols: string[];
  period?: string;
}): Promise<PairScanResult> {
  const { data } = await api.post<PairScanResult>("/pairs/scan", payload);
  return data;
}
