import { api } from "./base";

export interface MethodItem {
  id: string;
  label: string;
}

export async function fetchStatlabMethods(): Promise<{ forecast_methods: MethodItem[] }> {
  const { data } = await api.get("/statlab/methods");
  return data;
}

export interface ForecastResult {
  ticker: string;
  method: string;
  history: { date: string; value: number }[];
  forecast: { date: string; mean: number; lower: number; upper: number }[];
  model: { aic: number; order: string };
  metrics: { rmse_in_sample: number };
}

export async function postForecast(body: {
  ticker: string;
  method: string;
  horizon: number;
  lookback_days?: number;
}): Promise<ForecastResult> {
  const { data } = await api.post("/statlab/forecast", body);
  return data;
}

export interface CointResult {
  ticker_a: string;
  ticker_b: string;
  coint_pvalue: number;
  is_cointegrated: boolean;
  hedge_ratio: number;
  half_life: number;
  current_z: number;
  correlation: number;
  signal: string;
  series: { date: string; spread: number; zscore: number }[];
}

export async function postCointegration(body: {
  ticker_a: string;
  ticker_b: string;
  lookback_days?: number;
  entry_z?: number;
  exit_z?: number;
}): Promise<CointResult> {
  const { data } = await api.post("/statlab/cointegration", body);
  return data;
}

export interface StationarityResult {
  ticker: string;
  hurst: number;
  interpretation: string;
  adf: { stat: number; pvalue: number; is_stationary: boolean };
  kpss: { stat: number; pvalue: number; is_stationary: boolean };
  returns_adf: { stat: number; pvalue: number; is_stationary: boolean };
}

export async function postStationarity(body: {
  ticker: string;
  lookback_days?: number;
}): Promise<StationarityResult> {
  const { data } = await api.post("/statlab/stationarity", body);
  return data;
}

export interface DecompositionResult {
  ticker: string;
  period: number;
  series: {
    date: string;
    observed: number;
    trend: number;
    seasonal: number;
    resid: number;
  }[];
}

export async function postDecomposition(body: {
  ticker: string;
  period: number;
  lookback_days?: number;
}): Promise<DecompositionResult> {
  const { data } = await api.post("/statlab/decomposition", body);
  return data;
}
