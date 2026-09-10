import { api } from "./base";
import type {
  BacktestPayload,
  BacktestResponse,
  BacktestJobSubmitPayload,
  BacktestJobStatus,
  BacktestJobResult,
  InsightData,
} from "./types";

export async function explainBacktest(
  runId: string,
  context?: Record<string, unknown>,
): Promise<InsightData> {
  const { data } = await api.post<InsightData>(`/v1/ai/explain-backtest/${encodeURIComponent(runId)}`, context);
  return data;
}

export async function fetchRiskInsights(
  runId: string,
  context?: Record<string, unknown>,
): Promise<InsightData> {
  const { data } = await api.post<InsightData>(`/v1/ai/risk-insights/${encodeURIComponent(runId)}`, context);
  return data;
}

export async function runBacktest(payload: BacktestPayload): Promise<BacktestResponse> {
  const { data } = await api.post<BacktestResponse>("/v1/backtest/run", payload);
  return data;
}

export async function submitBacktestJob(payload: BacktestJobSubmitPayload): Promise<BacktestJobStatus> {
  const { data } = await api.post<BacktestJobStatus>("/v1/backtest/jobs", payload);
  return data;
}

export async function fetchBacktestJobStatus(runId: string): Promise<BacktestJobStatus> {
  const { data } = await api.get<BacktestJobStatus>(`/v1/backtest/jobs/${encodeURIComponent(runId)}`);
  return data;
}

export async function fetchBacktestJobResult(runId: string): Promise<BacktestJobResult> {
  const { data } = await api.get<BacktestJobResult>(`/v1/backtest/jobs/${encodeURIComponent(runId)}/result`);
  return data;
}

export async function submitBacktestV1(payload: BacktestJobSubmitPayload): Promise<BacktestJobStatus> {
  const { data } = await api.post<BacktestJobStatus>("/v1/backtest/v1/jobs", payload);
  return data;
}

export async function fetchBacktestV1Status(runId: string): Promise<BacktestJobStatus> {
  const { data } = await api.get<BacktestJobStatus>(`/v1/backtest/v1/jobs/${encodeURIComponent(runId)}`);
  return data;
}

export async function fetchBacktestV1Result(runId: string): Promise<BacktestJobResult> {
  const { data } = await api.get<BacktestJobResult>(`/v1/backtest/v1/jobs/${encodeURIComponent(runId)}/result`);
  return data;
}

export async function fetchBacktestV1Presets(): Promise<Array<Record<string, unknown>>> {
  const { data } = await api.get<{ items: Array<Record<string, unknown>> }>("/v1/backtest/presets");
  return Array.isArray(data?.items) ? data.items : [];
}

export async function deployBacktestToPaper(payload: {
  name: string;
  initial_capital: number;
  symbol: string;
  market: string;
  strategy: string;
  context?: Record<string, unknown>;
}): Promise<{ portfolio_id: string; status: string }> {
  const { data } = await api.post<{ portfolio_id: string; status: string }>("/paper/deploy-strategy", payload);
  return data;
}
