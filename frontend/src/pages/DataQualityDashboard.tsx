import { useQuery } from "@tanstack/react-query";

import { fetchDataQualityHealth, parseProviderHealth } from "../api/dataQuality";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { TerminalTable } from "../components/terminal/TerminalTable";
import { TerminalBadge } from "../components/terminal/TerminalBadge";
import { TerminalButton } from "../components/terminal/TerminalButton";

import type { DataQualityDetail, ProviderHealthItem } from "../api/dataQuality";

const STATUS_DOT: Record<string, string> = {
  healthy: "bg-terminal-pos",
  stale: "bg-terminal-warn",
  offline: "bg-terminal-neg",
};

function statusVariant(status: string): "success" | "warn" | "danger" {
  if (status === "healthy") return "success";
  if (status === "stale") return "warn";
  return "danger";
}

function formatLatency(ms?: number): string {
  if (ms == null) return "-";
  if (ms < 100) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDateTime(iso?: string): string {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function truncateMessage(msg: string, maxLen = 120): string {
  if (!msg) return "-";
  return msg.length > maxLen ? `${msg.slice(0, maxLen)}...` : msg;
}

function parseHealthResponse(raw: Record<string, unknown> | undefined): DataQualityDetail[] {
  const items: DataQualityDetail[] = [];
  if (!raw) return items;
  const keys = Object.keys(raw);
  for (const key of keys) {
    const val = raw[key] as Record<string, unknown>;
    if (val && typeof val === "object") {
      items.push({
        provider: key,
        status: String(val.status || "unknown"),
        last_update: String(val.last_update || "-"),
        latency_ms: Number(val.latency_ms) || 0,
        cache_hit_rate: typeof val.cache_hit_rate === "number" ? val.cache_hit_rate : undefined,
        errors_last_hour: typeof val.errors_last_hour === "number" ? val.errors_last_hour : undefined,
      });
    }
  }
  return items;
}

export function DataQualityDashboard() {
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["data-quality-health"],
    queryFn: fetchDataQualityHealth,
    staleTime: 5_000,
    refetchInterval: 30_000,
  });

  const providerHealth: ProviderHealthItem[] = data ? parseProviderHealth(data.provider_health) : [];
  const metrics = data?.metrics || {};
  const issues = data?.issues || [];
  const backfill = data?.backfill || [];
  const globalStatus = data?.status || "unknown";

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-terminal-accent">Data Quality Dashboard</div>
          <div className="text-[11px] text-terminal-muted">
            Provider health & data quality metrics
            {isFetching && <span className="text-terminal-warn"> · Refreshing...</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <TerminalBadge variant={statusVariant(globalStatus)} dot>
            {globalStatus.toUpperCase()}
          </TerminalBadge>
          <TerminalButton variant="ghost" size="sm" onClick={() => refetch()} loading={isFetching}>
            Refresh
          </TerminalButton>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <TerminalPanel title="Stale Symbols">
          <div className="text-2xl font-bold mt-1">{metrics.stale_symbols ?? 0}</div>
        </TerminalPanel>
        <TerminalPanel title="Missing Bars (24h)">
          <div className="text-2xl font-bold mt-1 text-terminal-neg">{metrics.missing_bars_24h ?? 0}</div>
        </TerminalPanel>
        <TerminalPanel title="Outliers">
          <div className="text-2xl font-bold mt-1 text-terminal-warn">{metrics.outliers_detected ?? 0}</div>
        </TerminalPanel>
        <TerminalPanel title="Cache Hit Rate">
          <div className="text-2xl font-bold mt-1 text-terminal-pos">
            {metrics.cache_hit_rate != null ? `${(metrics.cache_hit_rate * 100).toFixed(1)}%` : "-"}
          </div>
        </TerminalPanel>
      </div>

      <TerminalPanel title="Provider Health" subtitle={`${providerHealth.length} providers`}>
        <TerminalTable
          rows={providerHealth}
          rowKey={(r) => r.name}
          columns={[
            {
              key: "name",
              label: "Provider",
              render: (r) => <span className="font-mono text-terminal-accent">{r.name}</span>,
            },
            {
              key: "status",
              label: "Status",
              render: (r) => (
                <span className="inline-flex items-center gap-1.5">
                  <span className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT[r.status] || "bg-terminal-border"}`} />
                  <TerminalBadge variant={statusVariant(r.status)}>
                    {r.status.toUpperCase()}
                  </TerminalBadge>
                </span>
              ),
            },
            {
              key: "last_update",
              label: "Last Update",
              render: (r) => formatDateTime(r.last_update),
            },
            {
              key: "latency_ms",
              label: "Latency",
              align: "right",
              render: (r) => <span className="font-mono">{formatLatency(r.latency_ms)}</span>,
            },
          ]}
        />
      </TerminalPanel>

      {issues.length > 0 && (
        <TerminalPanel title="Active Issues" subtitle={`${issues.length} critical/warning events`}>
          <TerminalTable
            rows={issues}
            rowKey={(r, i) => `${r.type}-${i}`}
            columns={[
              {
                key: "level",
                label: "Level",
                render: (r) => (
                  <TerminalBadge variant={r.level === "critical" ? "danger" : r.level === "warning" ? "warn" : "info"}>
                    {r.level.toUpperCase()}
                  </TerminalBadge>
                ),
              },
              {
                key: "type",
                label: "Type",
                render: (r) => <span className="font-mono">{r.type}</span>,
              },
              {
                key: "message",
                label: "Message",
                render: (r) => <span className="text-[11px]">{truncateMessage(r.message)}</span>,
              },
            ]}
          />
        </TerminalPanel>
      )}

      {backfill.length > 0 && (
        <TerminalPanel title="Backfill Progress">
          <TerminalTable
            rows={backfill}
            rowKey={(r) => r.task}
            columns={[
              { key: "task", label: "Task", render: (r) => <span className="font-mono">{r.task}</span> },
              {
                key: "status",
                label: "Status",
                render: (r) => (
                  <TerminalBadge variant={r.status === "completed" ? "success" : "accent"}>
                    {r.status.toUpperCase()}
                  </TerminalBadge>
                ),
              },
              {
                key: "progress",
                label: "Progress",
                align: "right",
                render: (r) => (
                  <div className="flex items-center gap-2">
                    <div className="w-20 bg-terminal-bg border border-terminal-border h-2 rounded-full overflow-hidden">
                      <div className="bg-terminal-accent h-full transition-all" style={{ width: `${Math.min(r.progress, 100)}%` }} />
                    </div>
                    <span className="font-mono text-[10px] text-terminal-muted">{Math.round(r.progress)}%</span>
                  </div>
                ),
              },
            ]}
          />
        </TerminalPanel>
      )}
    </div>
  );
}