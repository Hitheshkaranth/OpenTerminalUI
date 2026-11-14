import { api } from "./base";
import type {
  ChartDrawingRecord,
  VolumeProfileResponse,
  TapeRecentResponse,
  TapeSummaryResponse,
} from "./types";

export async function listChartDrawings(
  symbol: string,
  opts?: { timeframe?: string; workspaceId?: string },
): Promise<ChartDrawingRecord[]> {
  const { data } = await api.get<{ items: ChartDrawingRecord[] }>(`/chart-drawings/${encodeURIComponent(symbol)}`, {
    params: {
      timeframe: opts?.timeframe,
      workspace_id: opts?.workspaceId,
    },
  });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function createChartDrawing(symbol: string, payload: { tool_type: string; coordinates: Record<string, unknown>; style?: Record<string, unknown> }): Promise<{ id: string }> {
  const { data } = await api.post<{ id: string }>(`/chart-drawings/${encodeURIComponent(symbol)}`, payload);
  return data;
}

export async function updateChartDrawing(symbol: string, drawingId: string, payload: { coordinates?: Record<string, unknown>; style?: Record<string, unknown> }): Promise<void> {
  await api.put(`/chart-drawings/${encodeURIComponent(symbol)}/${encodeURIComponent(drawingId)}`, payload);
}

export async function deleteChartDrawing(symbol: string, drawingId: string): Promise<void> {
  await api.delete(`/chart-drawings/${encodeURIComponent(symbol)}/${encodeURIComponent(drawingId)}`);
}

export async function listChartTemplates(): Promise<Array<{ id: string; name: string; layout_config: Record<string, unknown> }>> {
  const { data } = await api.get<{ items: Array<{ id: string; name: string; layout_config: Record<string, unknown> }> }>("/chart-templates");
  return Array.isArray(data?.items) ? data.items : [];
}

export async function createChartTemplate(payload: { name: string; layout_config: Record<string, unknown> }): Promise<{ id: string; name: string }> {
  const { data } = await api.post<{ id: string; name: string }>("/chart-templates", payload);
  return data;
}

export async function fetchVolumeProfile(
  symbol: string,
  opts?: { period?: string; bins?: number; market?: string; mode?: "fixed" | "session" | "visible"; lookbackBars?: number },
): Promise<VolumeProfileResponse> {
  const { data } = await api.get<VolumeProfileResponse>(`/charts/volume-profile/${encodeURIComponent(symbol)}`, {
    params: {
      period: opts?.period ?? "20d",
      bins: opts?.bins ?? 50,
      market: opts?.market ?? "NSE",
      mode: opts?.mode ?? "fixed",
      lookback_bars: opts?.lookbackBars ?? 300,
    },
  });
  return data;
}

export async function fetchTapeRecent(symbol: string, limit = 500): Promise<TapeRecentResponse> {
  const { data } = await api.get<TapeRecentResponse>(`/tape/${encodeURIComponent(symbol)}/recent`, {
    params: { limit },
  });
  return {
    source: data?.source,
    simulated: data?.simulated,
    trades: Array.isArray(data?.trades) ? data.trades : [],
  };
}

export async function fetchTapeSummary(symbol: string, limit = 500): Promise<TapeSummaryResponse> {
  const { data } = await api.get<TapeSummaryResponse>(`/tape/${encodeURIComponent(symbol)}/summary`, {
    params: { limit },
  });
  return data;
}
