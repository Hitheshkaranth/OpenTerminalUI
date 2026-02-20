import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "/api",
  timeout: 120000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("ot-access-token");
  if (token) {
    config.headers = config.headers || {};
    (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }
  return config;
});

export type WeightingMethod = "EQUAL" | "VOL_TARGET" | "RISK_PARITY";
export type RebalanceFrequency = "DAILY" | "WEEKLY" | "MONTHLY";

export type PortfolioDefinition = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  benchmark_symbol?: string | null;
  start_date: string;
  end_date: string;
  rebalance_frequency: RebalanceFrequency;
  weighting_method: WeightingMethod;
  created_at: string;
};

export type StrategyBlend = {
  id: string;
  name: string;
  strategies_json: Array<{ model_key: string; params_json?: Record<string, unknown>; weight: number }>;
  blend_method: "WEIGHTED_SUM_RETURNS" | "WEIGHTED_SUM_SIGNALS";
  created_at?: string;
};

export type PortfolioRunStatus = {
  run_id: string;
  portfolio_id: string;
  blend_id?: string | null;
  status: "queued" | "running" | "succeeded" | "failed";
  started_at?: string;
  finished_at?: string | null;
  error?: string | null;
};

export type PortfolioReport = {
  run_id: string;
  portfolio_id: string;
  blend_id?: string | null;
  status: string;
  metrics: Record<string, number>;
  series: {
    portfolio_equity: Array<{ date: string; value: number }>;
    benchmark_equity: Array<{ date: string; value: number }>;
    drawdown: Array<{ date: string; value: number }>;
    underwater: Array<{ date: string; value: number }>;
    exposure: Array<{ date: string; value: number }>;
    leverage: Array<{ date: string; value: number }>;
    returns: Array<{ date: string; return: number }>;
    weights_over_time: Array<{ date: string; weights: Record<string, number> }>;
    turnover_series: Array<{ date: string; turnover: number }>;
    contribution_series: Array<Record<string, number | string>>;
    rolling_sharpe_30: Array<{ date: string; value: number }>;
    rolling_sharpe_90: Array<{ date: string; value: number }>;
    rolling_volatility: Array<{ date: string; value: number }>;
    monthly_returns: Array<{ year: number; month: number; return_pct: number }>;
  };
  tables: {
    top_contributors: Array<{ asset: string; contribution: number }>;
    top_detractors: Array<{ asset: string; contribution: number }>;
    worst_drawdowns: Array<{ date: string; drawdown: number }>;
    rebalance_log: Array<{ date: string; turnover: number }>;
    latest_weights: Array<{ asset: string; weight: number }>;
  };
  matrices: {
    correlation: { labels: string[]; values: number[][]; cluster_order?: number[] };
    labels: string[];
    cluster_order: number[];
  };
};

export async function createPortfolioDefinition(payload: {
  name: string;
  description?: string;
  tags?: string[];
  universe_json: Record<string, unknown>;
  benchmark_symbol?: string;
  start_date: string;
  end_date: string;
  rebalance_frequency: RebalanceFrequency;
  weighting_method: WeightingMethod;
  constraints_json?: Record<string, unknown>;
}): Promise<PortfolioDefinition> {
  const { data } = await api.post<PortfolioDefinition>("/portfolio-lab/portfolios", payload);
  return data;
}

export async function listPortfolioDefinitions(params?: { tag?: string; weighting_method?: WeightingMethod }): Promise<PortfolioDefinition[]> {
  const { data } = await api.get<{ items: PortfolioDefinition[] }>("/portfolio-lab/portfolios", { params });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function getPortfolioDefinition(id: string): Promise<PortfolioDefinition & {
  universe_json: Record<string, unknown>;
  constraints_json: Record<string, unknown>;
  runs: PortfolioRunStatus[];
}> {
  const { data } = await api.get<PortfolioDefinition & { universe_json: Record<string, unknown>; constraints_json: Record<string, unknown>; runs: PortfolioRunStatus[] }>(`/portfolio-lab/portfolios/${encodeURIComponent(id)}`);
  return data;
}

export async function createStrategyBlend(payload: {
  name: string;
  strategies_json: StrategyBlend["strategies_json"];
  blend_method: StrategyBlend["blend_method"];
}): Promise<StrategyBlend> {
  const { data } = await api.post<StrategyBlend>("/portfolio-lab/blends", payload);
  return data;
}

export async function listStrategyBlends(): Promise<StrategyBlend[]> {
  const { data } = await api.get<{ items: StrategyBlend[] }>("/portfolio-lab/blends");
  return Array.isArray(data?.items) ? data.items : [];
}

export async function runPortfolioDefinition(portfolioId: string, payload?: { blend_id?: string; force_refresh?: boolean }): Promise<PortfolioRunStatus> {
  const { data } = await api.post<PortfolioRunStatus>(`/portfolio-lab/portfolios/${encodeURIComponent(portfolioId)}/run`, payload || {});
  return data;
}

export async function getPortfolioRunStatus(runId: string): Promise<PortfolioRunStatus> {
  const { data } = await api.get<PortfolioRunStatus>(`/portfolio-lab/runs/${encodeURIComponent(runId)}`);
  return data;
}

export async function getPortfolioRunReport(runId: string, forceRefresh = false): Promise<PortfolioReport> {
  const { data } = await api.get<PortfolioReport>(`/portfolio-lab/runs/${encodeURIComponent(runId)}/report`, { params: { force_refresh: forceRefresh } });
  return data;
}
