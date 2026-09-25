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
  status: "healthy" | "stale" | "offline" | "unconfigured";
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

const PROVIDER_STATUS_MAP: Record<string, ProviderHealthItem["status"]> = {
  ok: "healthy",
  healthy: "healthy",
  degraded: "stale",
  stale: "stale",
  down: "offline",
  offline: "offline",
  unconfigured: "unconfigured",
};

type ProvidersStatusPayload = {
  providers?: Array<{ id?: string; name?: string; status?: string; last_success_at?: string | null }>;
};

type OpsDataQualityPayload = {
  symbols?: Array<{ health_status?: string; bars_received_today?: number; bars_expected_today?: number }>;
};

export async function fetchDataQualityHealth(): Promise<DataQualityHealth> {
  // /healthz is mounted at the app root, not under the /api prefix. It only reports
  // service liveness, so provider rows come from /providers/status and feed metrics
  // from /ops/data-quality (both optional -- missing sources render as "-", not 0).
  const root = String(api.defaults.baseURL || "/api").replace(/\/api\/?$/, "") || "/";
  const [health, providers, ops] = await Promise.allSettled([
    api.get<DataQualityHealth>("/healthz", { baseURL: root }),
    api.get<ProvidersStatusPayload>("/providers/status"),
    api.get<OpsDataQualityPayload>("/ops/data-quality"),
  ]);
  if (health.status === "rejected") throw health.reason;
  const data: DataQualityHealth = { ...health.value.data };

  if (providers.status === "fulfilled" && Array.isArray(providers.value.data?.providers)) {
    data.provider_health = Object.fromEntries(
      providers.value.data.providers.map((p) => [
        String(p.name || p.id || "unknown"),
        { status: String(p.status || "unknown"), last_update: p.last_success_at || undefined },
      ]),
    );
  }

  if (ops.status === "fulfilled" && Array.isArray(ops.value.data?.symbols)) {
    const symbols = ops.value.data.symbols;
    data.metrics = {
      ...data.metrics,
      stale_symbols: symbols.filter((s) => s.health_status === "stale").length,
      missing_bars_24h: symbols.reduce(
        (sum, s) => sum + Math.max(0, Number(s.bars_expected_today || 0) - Number(s.bars_received_today || 0)),
        0,
      ),
    };
  }
  return data;
}

export function parseProviderHealth(health?: Record<string, { status: string; last_update?: string; latency_ms?: number }>): ProviderHealthItem[] {
  if (!health) return [];
  return Object.entries(health).map(([name, info]) => ({
    name,
    status: PROVIDER_STATUS_MAP[String(info.status || "").toLowerCase()] || "offline",
    last_update: info.last_update,
    latency_ms: info.latency_ms,
  }));
}
