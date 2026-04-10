import { useEffect, useState } from "react";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { TerminalTable } from "../components/terminal/TerminalTable";
import { TerminalBadge } from "../components/terminal/TerminalBadge";
import { api } from "../api/client";

interface DataIssue {
  level: "critical" | "warning" | "info";
  type: string;
  message: string;
}

interface BackfillTask {
  task: string;
  status: string;
  progress: number;
}

export function DataQualityDashboard() {
  const [health, setHealth] = useState<{ status: string; timestamp: string; metrics: any; issues: DataIssue[] } | null>(null);
  const [backfill, setBackfill] = useState<BackfillTask[]>([]);
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [h, b] = await Promise.all([
        api.get("/api/admin/data-quality/health"),
        api.get("/api/admin/data-quality/backfill-status")
      ]);
      setHealth(h.data);
      setBackfill(b.data);
    } catch (e) {
      console.error("Failed to load data quality info", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  if (!health) return <div className="p-4">Loading...</div>;

  return (
    <div className="space-y-3 p-4">
      <div className="grid gap-3 lg:grid-cols-4">
        <TerminalPanel title="System Status">
          <div className="mt-4 flex items-center gap-2">
            <TerminalBadge variant={health.status === "healthy" ? "success" : "warn"}>
              {health.status.toUpperCase()}
            </TerminalBadge>
            <span className="text-[10px] text-terminal-muted">{new Date(health.timestamp).toLocaleTimeString()}</span>
          </div>
        </TerminalPanel>
        <TerminalPanel title="Stale Symbols">
          <div className="text-2xl font-bold mt-2">{health.metrics.stale_symbols}</div>
        </TerminalPanel>
        <TerminalPanel title="Missing Bars (24h)">
          <div className="text-2xl font-bold mt-2 text-terminal-neg">{health.metrics.missing_bars_24h}</div>
        </TerminalPanel>
        <TerminalPanel title="Outliers">
          <div className="text-2xl font-bold mt-2 text-terminal-warn">{health.metrics.outliers_detected}</div>
        </TerminalPanel>
      </div>

      <TerminalPanel title="Active Issues" subtitle="Critical and warning level data events">
        <TerminalTable
          rows={health.issues}
          rowKey={(r, i) => r.type + i}
          columns={[
            { key: "level", label: "Level", render: (r) => (
              <TerminalBadge variant={r.level === "critical" ? "danger" : r.level === "warning" ? "warn" : "info"}>
                {r.level.toUpperCase()}
              </TerminalBadge>
            )},
            { key: "type", label: "Type", render: (r) => r.type },
            { key: "message", label: "Message", render: (r) => r.message },
          ]}
        />
      </TerminalPanel>

      <TerminalPanel title="Backfill Progress">
        <TerminalTable
          rows={backfill}
          rowKey={(r) => r.task}
          columns={[
            { key: "task", label: "Task", render: (r) => r.task },
            { key: "status", label: "Status", render: (r) => (
              <TerminalBadge variant={r.status === "completed" ? "success" : "accent"}>
                {r.status.toUpperCase()}
              </TerminalBadge>
            )},
            { key: "progress", label: "Progress", align: "right", render: (r) => (
              <div className="w-24 bg-terminal-bg border border-terminal-border h-2 rounded-full overflow-hidden">
                <div className="bg-terminal-accent h-full" style={{ width: `${r.progress}%` }} />
              </div>
            )},
          ]}
        />
      </TerminalPanel>
    </div>
  );
}
