import { api } from "./base";

export interface MethodItem { id: string; label: string; }
export interface OptimizerMethods {
  objectives: MethodItem[];
  risk_measures: MethodItem[];
  models: MethodItem[];
  covariance_methods: MethodItem[];
}

export interface OptimizeRequest {
  tickers: string[]; start?: string | null; end?: string | null;
  model: string; objective: string; risk_measure: string;
  cov_method: string;
  confidence: number; risk_free_rate: number; risk_aversion: number;
  min_weight: number; max_weight: number; target_return?: number | null;
  views?: { assets: string[]; weights: number[]; value: number }[] | null;
}
export interface RiskMetrics {
  expected_return: number; volatility: number; sharpe: number; sortino: number;
  downside_deviation: number; mad: number; var: number; cvar: number; evar: number;
  max_drawdown: number; avg_drawdown: number; ulcer_index: number; cdar: number; edar: number;
  calmar: number; skew: number; kurtosis: number;
}
export interface FrontierPoint { risk: number; return: number; sharpe: number; }
export interface AssetMetric { symbol: string; annual_return: number; annual_vol: number; weight: number; }
export interface ClusterGroup { id: number; symbols: string[]; }
export interface ClusterInfo { leaf_order: string[]; groups: ClusterGroup[]; linkage: number[][]; }
export interface OptimizeResult {
  weights: Record<string, number>; metrics: RiskMetrics; risk_contributions: Record<string, number>;
  asset_metrics: AssetMetric[]; frontier: FrontierPoint[]; selected_point: { risk: number; return: number };
  model: string; objective: string; risk_measure: string;
  clusters?: ClusterInfo;
}
export async function fetchOptimizerMethods(): Promise<OptimizerMethods> {
  const { data } = await api.get<OptimizerMethods>("/portfolio-optimizer/methods"); return data;
}
export async function runOptimize(req: OptimizeRequest): Promise<OptimizeResult> {
  const { data } = await api.post<OptimizeResult>("/portfolio-optimizer/optimize", req); return data;
}
