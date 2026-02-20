import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "/api",
  timeout: 60000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("ot-access-token");
  if (token) {
    config.headers = config.headers || {};
    (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }
  return config;
});

export type ExperimentCreate = {
  name: string;
  description?: string;
  tags?: string[];
  model_key: string;
  params_json?: Record<string, unknown>;
  universe_json?: Record<string, unknown>;
  benchmark_symbol?: string;
  start_date: string;
  end_date: string;
  cost_model_json?: Record<string, unknown>;
};

export type ExperimentSummary = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  model_key: string;
  benchmark_symbol?: string | null;
  start_date: string;
  end_date: string;
  created_at: string;
};

export type ExperimentDetail = ExperimentSummary & {
  params_json: Record<string, unknown>;
  universe_json: Record<string, unknown>;
  cost_model_json: Record<string, unknown>;
  runs: Array<{
    id: string;
    status: "queued" | "running" | "succeeded" | "failed";
    started_at: string;
    finished_at?: string | null;
    error?: string | null;
  }>;
};

export type ModelRunStatus = {
  run_id: string;
  experiment_id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  started_at?: string;
  finished_at?: string | null;
  error?: string | null;
};

export type ModelRunReport = {
  run_id: string;
  experiment_id?: string;
  status: "queued" | "running" | "succeeded" | "failed";
  metrics: Record<string, number>;
  series: {
    equity_curve: Array<{ date: string; value: number }>;
    benchmark_curve: Array<{ date: string; value: number }>;
    drawdown: Array<{ date: string; value: number }>;
    underwater: Array<{ date: string; value: number }>;
    rolling_sharpe_30: number[];
    rolling_sharpe_90: number[];
    monthly_returns: Array<{ year: number; month: number; return_pct: number }>;
    returns_histogram: { bins: number[]; counts: number[] };
    trades?: Array<{ date: string; action: string; quantity: number; price: number }>;
  };
  error?: string | null;
};

export type ModelCompareResponse = {
  runs: ModelRunReport[];
  summary: Array<{
    run_id: string;
    status: string;
    total_return: number;
    sharpe: number;
    sortino: number;
    max_drawdown: number;
    calmar: number;
    vol_annual: number;
    turnover: number;
    pareto: boolean;
  }>;
};

export async function createModelExperiment(payload: ExperimentCreate): Promise<ExperimentSummary> {
  const { data } = await api.post<ExperimentSummary>("/model-lab/experiments", payload);
  return data;
}

export async function listModelExperiments(params?: {
  tag?: string;
  model?: string;
  start_date?: string;
  end_date?: string;
}): Promise<ExperimentSummary[]> {
  const { data } = await api.get<{ items: ExperimentSummary[] }>("/model-lab/experiments", { params });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function getModelExperiment(experimentId: string): Promise<ExperimentDetail> {
  const { data } = await api.get<ExperimentDetail>(`/model-lab/experiments/${encodeURIComponent(experimentId)}`);
  return data;
}

export async function runModelExperiment(experimentId: string, forceRefresh = false): Promise<{ run_id: string; status: string }> {
  const { data } = await api.post<{ run_id: string; status: string }>(`/model-lab/experiments/${encodeURIComponent(experimentId)}/run`, { force_refresh: forceRefresh });
  return data;
}

export async function getModelRunStatus(runId: string): Promise<ModelRunStatus> {
  const { data } = await api.get<ModelRunStatus>(`/model-lab/runs/${encodeURIComponent(runId)}`);
  return data;
}

export async function getModelRunReport(runId: string, forceRefresh = false): Promise<ModelRunReport> {
  const { data } = await api.get<ModelRunReport>(`/model-lab/runs/${encodeURIComponent(runId)}/report`, {
    params: { force_refresh: forceRefresh },
  });
  return data;
}

export async function compareModelRuns(runIds: string[]): Promise<ModelCompareResponse> {
  const { data } = await api.post<ModelCompareResponse>("/model-lab/compare", { run_ids: runIds.slice(0, 6) });
  return data;
}

export async function runModelWalkForward(experimentId: string, payload: { train_window_days: number; test_window_days: number }): Promise<Record<string, unknown>> {
  const { data } = await api.post<Record<string, unknown>>(`/model-lab/experiments/${encodeURIComponent(experimentId)}/walk-forward`, payload);
  return data;
}

export async function runModelParamSweep(experimentId: string, payload: { grid: Record<string, Array<number | string | boolean>>; max_combinations: number }): Promise<Record<string, unknown>> {
  const { data } = await api.post<Record<string, unknown>>(`/model-lab/experiments/${encodeURIComponent(experimentId)}/param-sweep`, payload);
  return data;
}
