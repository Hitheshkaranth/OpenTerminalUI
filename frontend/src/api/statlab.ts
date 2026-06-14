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

export interface RegressionResult {
  ticker: string; benchmark_ticker: string; asset: string; benchmark: string;
  alpha_daily: number; alpha_annual: number; beta: number; r_squared: number; correlation: number;
  tracking_error: number; information_ratio: number;
  alpha_tstat: number; alpha_pvalue: number; beta_tstat: number; beta_pvalue: number;
  n_obs: number; rolling_window: number;
  rolling_beta: { date: string; beta: number }[];
  scatter: { x: number; y: number }[];
  fit_line: { x: number; y: number }[];
  interpretation: string;
}
export async function postRegression(body: { ticker: string; benchmark: string; rolling_window?: number; lookback_days?: number }): Promise<RegressionResult> {
  const { data } = await api.post("/statlab/regression", body); return data;
}

export interface AutocorrResult {
  ticker: string; use_returns: boolean; n_obs: number; conf_band: number;
  acf:  { lag: number; value: number; significant: boolean }[];
  pacf: { lag: number; value: number; significant: boolean }[];
  ljung_box: { lag: number; stat: number; pvalue: number; has_autocorr: boolean }[];
  interpretation: string;
}
export async function postAutocorrelation(body: { ticker: string; nlags?: number; use_returns?: boolean; lookback_days?: number }): Promise<AutocorrResult> {
  const { data } = await api.post("/statlab/autocorrelation", body); return data;
}

export interface CausalityDir { best_lag: number; min_pvalue: number; significant: boolean; curve: { lag: number; pvalue: number }[]; }
export interface CausalityResult {
  ticker_a: string; ticker_b: string; name_a: string; name_b: string;
  max_lag: number; n_obs: number; a_to_b: CausalityDir; b_to_a: CausalityDir; lead: string; interpretation: string;
}
export async function postCausality(body: { ticker_a: string; ticker_b: string; max_lag?: number; lookback_days?: number }): Promise<CausalityResult> {
  const { data } = await api.post("/statlab/causality", body); return data;
}

export interface RegimeBucket { label: string; ann_vol_pct: number; mean: number; vol: number; share: number; }
export interface RegimeResult {
  ticker: string; k_regimes: number; n_obs: number; current_regime: string; current_high_vol_prob: number;
  high_vol_regime: RegimeBucket; low_vol_regime: RegimeBucket;
  series: { date: string; high_vol_prob: number }[]; interpretation: string;
}
export async function postRegimes(body: { ticker: string; lookback_days?: number }): Promise<RegimeResult> {
  const { data } = await api.post("/statlab/regimes", body); return data;
}
