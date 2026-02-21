import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "/api",
  timeout: 30000,
});

let accessTokenGetter: (() => string | null) | null = null;
export function setAccessTokenGetter(getter: (() => string | null) | null): void {
  accessTokenGetter = getter;
}

api.interceptors.request.use((config) => {
  const token = accessTokenGetter ? accessTokenGetter() : null;
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Cockpit
export async function fetchCockpitSummary() {
  const { data } = await api.get("/cockpit/summary");
  return data;
}

// Portfolio Backtests
export async function createPortfolioBacktestJob(payload: any) {
  const { data } = await api.post("/portfolio-backtests/jobs", payload);
  return data;
}

export async function fetchPortfolioBacktestJobStatus(jobId: string) {
  const { data } = await api.get(`/portfolio-backtests/jobs/${jobId}`);
  return data;
}

export async function fetchPortfolioBacktestResult(jobId: string) {
  const { data } = await api.get(`/portfolio-backtests/jobs/${jobId}/result`);
  return data;
}

// Risk Engine
export async function fetchRiskSummary() {
  const { data } = await api.get("/risk/summary");
  return data;
}

export async function fetchRiskExposures() {
  const { data } = await api.get("/risk/exposures");
  return data;
}

export async function fetchRiskCorrelation() {
  const { data } = await api.get("/risk/correlation");
  return data;
}

// Experiments Registry
export async function createExperiment(payload: any) {
  const { data } = await api.post("/experiments", payload);
  return data;
}

export async function listExperiments() {
  const { data } = await api.get("/experiments");
  return data;
}

export async function fetchExperiment(id: number) {
  const { data } = await api.get(`/experiments/${id}`);
  return data;
}

export async function compareExperiments(ids: number[]) {
  const { data } = await api.post("/experiments/compare", { experiment_ids: ids });
  return data;
}

export async function promoteExperimentToPaper(id: number) {
  const { data } = await api.post(`/experiments/${id}/promote-to-paper`);
  return data;
}

// Data Quality
export async function runDataQualityScan(datasetId: string) {
  const { data } = await api.post("/data-quality/run", { dataset_id: datasetId });
  return data;
}

export async function fetchDataQualityDashboard() {
  const { data } = await api.get("/data-quality/dashboard");
  return data;
}

// TCA
export async function fetchPaperTca(window: string = "1d") {
  const { data } = await api.get("/paper/tca", { params: { window } });
  return data;
}
