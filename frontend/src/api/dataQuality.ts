import { api } from "./base";
import type { OpsDataQualitySymbolRow } from "./types";

export interface DataQualityHealth {
  status: string;
  timestamp?: string;
  symbols?: OpsDataQualitySymbolRow[];
  unavailable_sources?: string[];
  coverage?: { monitored: number; known_sessions: number; closed: number; unknown: number };
  metrics?: {
    stale_symbols?: number;
    missing_bars_24h?: number;
    missing_bars_session?: number;
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
  status: "healthy" | "stale" | "offline" | "unconfigured" | "unknown";
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
  unknown: "unknown",
};

type ProvidersStatusPayload = {
  error?: string;
  providers?: Array<{ id?: string; name?: string; status?: string; last_success_at?: string | null }>;
};

type OpsDataQualityPayload = {
  timestamp?: string;
  symbols?: OpsDataQualitySymbolRow[];
};

export async function fetchDataQualityHealth(): Promise<DataQualityHealth> {
  // Process liveness cannot establish data health. Use the actual provider and
  // monitoring APIs, both served by the existing /api development proxy.
  const [providers, ops] = await Promise.allSettled([
    api.get<ProvidersStatusPayload>("/providers/status"),
    api.get<OpsDataQualityPayload>("/ops/data-quality"),
  ]);
  const providersValid = providers.status === "fulfilled" && !providers.value.data?.error && Array.isArray(providers.value.data?.providers);
  const opsValid = ops.status === "fulfilled" && Array.isArray(ops.value.data?.symbols);
  if (!providersValid && !opsValid) throw new Error("Provider and feed monitoring are unavailable. Retry to check data health.");
  const data: DataQualityHealth = { status: "unknown", unavailable_sources: [], issues: [] };
  if (!providersValid) data.unavailable_sources!.push("Provider status");
  if (!opsValid) data.unavailable_sources!.push("Feed monitoring");

  if (providersValid && providers.status === "fulfilled") {
    data.provider_health = Object.fromEntries(
      providers.value.data.providers!.map((p) => [
        String(p.name || p.id || "unknown"),
        { status: String(p.status || "unknown"), last_update: p.last_success_at || undefined },
      ]),
    );
  }

  if (opsValid && ops.status === "fulfilled") {
    const symbols = ops.value.data.symbols!;
    data.symbols = symbols;
    data.timestamp = ops.value.data.timestamp;
    const known = symbols.filter((s) => typeof s.bars_expected_today === "number" && Number.isFinite(s.bars_expected_today));
    data.coverage = {
      monitored: symbols.length,
      known_sessions: known.length,
      closed: symbols.filter((s) => s.session_state === "closed").length,
      unknown: symbols.filter((s) => !s.session_state || s.session_state === "unknown").length,
    };
    data.metrics = {
      stale_symbols: symbols.filter((s) => s.health_status === "stale").length,
      // This is session-to-date coverage, not a rolling 24-hour gap measure.
      missing_bars_session: known.length ? known.reduce(
        (sum, s) => sum + Math.max(0, Number(s.bars_expected_today) - Number(s.bars_received_today || 0)),
        0,
      ) : undefined,
    };
    const attention = symbols.some((s) => ["stale", "disconnected", "degraded"].includes(s.health_status));
    data.status = !symbols.length ? "no_data" : attention ? "degraded"
      : symbols.every((s) => s.health_status === "closed") ? "closed"
      : symbols.every((s) => ["healthy", "closed"].includes(s.health_status)) ? "healthy" : "unknown";
  }
  if (Object.values(data.provider_health || {}).some((provider) => ["down", "offline", "degraded", "stale"].includes(provider.status))) data.status = "degraded";
  if (data.unavailable_sources!.length) {
    data.status = "partial";
    data.issues!.push({ level: "warning", type: "coverage_unavailable", message: `${data.unavailable_sources!.join(" and ")} could not be loaded. Missing measurements are not treated as zero.` });
  }
  return data;
}

export function parseProviderHealth(health?: Record<string, { status: string; last_update?: string; latency_ms?: number }>): ProviderHealthItem[] {
  if (!health) return [];
  return Object.entries(health).map(([name, info]) => ({
    name,
    status: PROVIDER_STATUS_MAP[String(info.status || "").toLowerCase()] || "unknown",
    last_update: info.last_update,
    latency_ms: info.latency_ms,
  }));
}
