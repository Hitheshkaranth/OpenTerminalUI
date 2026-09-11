import { api } from "./base";

export interface DataQualityHealth {
  status: string;
  timestamp?: string;
  metrics?: {
    stale_symbols?: number;
    missing_bars_24h?: number;
    outliers_detected?: number;
    cache_hit_rate?: number;
    cache_size?: number;
  };
  issues?: Array<{
    level: "critical" | "warning" | "info";
    type: string;
    message: string;
  }>;
  backfill?: Array<{
    task: string;
    status: string;
    progress: number;
  }>;
  provider_health?: Record<string, { status: string; last_update?: string; latency_ms?: number }>;
}

export interface ProviderHealthItem {
  name: string;
  status: "healthy" | "stale" | "offline";
  last_update?: string;
  latency_ms?: number;
}

export interface DataQualityDetail {
  provider: string;
  status: string;
  last_update: string;
  latency_ms: number;
  cache_hit_rate?: number;
  errors_last_hour?: number;
}

export interface DataQualityListResponse {
  items: DataQualityDetail[];
  total: number;
}

export async function fetchDataQualityHealth(): Promise<DataQualityHealth> {
  const { data } = await api.get<DataQualityHealth>("/healthz");
  return data;
}

export function parseProviderHealth(health?: Record<string, { status: string; last_update?: string; latency_ms?: number }>): ProviderHealthItem[] {
  if (!health) return [];
  return Object.entries(health).map(([name, info]) => {
    const status = info.status === "healthy" ? "healthy" : info.status === "stale" ? "stale" : "offline";
    return {
      name,
      status,
      last_update: info.last_update,
      latency_ms: info.latency_ms,
    };
  });
}