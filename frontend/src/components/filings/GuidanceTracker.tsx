// OWNER: agent H (swarm fi_v1). Placeholder wired into SecurityHub; replace the body, keep the export + props.
import { useEffect, useState } from "react";
import { ClipboardList } from "lucide-react";

import { fetchKnowledge, buildKnowledge, type GuidanceItem, type Knowledge } from "../../api/filingsRag";
import { DenseTable } from "../terminal/DenseTable";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalBadge } from "../terminal/TerminalBadge";
import { GuidedEmptyState } from "../dashboard/GuidedEmptyState";
import { statusLabel, statusVariant } from "./presentation";

type Props = {
  symbol: string;
  market?: string;
};

type GuidanceRow = {
  metric: string;
  statement: string;
  target: string;
  period: string;
  status: GuidanceItem["status"];
  sourceText: string;
};

function guidanceRows(guidance: GuidanceItem[]): GuidanceRow[] {
  return (guidance || []).map((item) => ({
    metric: item.metric || "—",
    statement: item.statement || "—",
    target: item.target || "—",
    period: item.period || "—",
    status: item.status || "unknown",
    sourceText: `${item.said_in?.title || "document"} · p.${item.citation?.page_start ?? "?"}`,
  }));
}

export function GuidanceTracker({ symbol }: Props) {
  const [knowledge, setKnowledge] = useState<Knowledge | null>(null);
  const [building, setBuilding] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!symbol) return;
    let active = true;
    setLoading(true);
    setError(null);
    fetchKnowledge(symbol)
      .then((payload) => {
        if (active) setKnowledge(payload);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Knowledge unavailable");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [symbol]);

  const rebuild = async () => {
    if (!symbol) return;
    setBuilding(true);
    setError(null);
    try {
      const next = await buildKnowledge(symbol, true);
      setKnowledge(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Build failed");
    } finally {
      setBuilding(false);
    }
  };

  const rows = guidanceRows(knowledge?.guidance ?? []);
  const hasAny = rows.length > 0;

  return (
    <TerminalPanel
      title="Guidance Tracker"
      subtitle="Management forward-looking statements"
      actions={
        hasAny ? null : (
          <TerminalButton size="sm" loading={building} onClick={rebuild}>
            Build Guidance
          </TerminalButton>
        )
      }
    >
      {error ? (
        <div className="rounded-sm border border-terminal-border bg-terminal-bg px-3 py-3 text-xs text-terminal-muted">
          {loading ? "Loading guidance…" : "Guidance feed unavailable."}
        </div>
      ) : !rows.length ? (
        <GuidedEmptyState
          title="No guidance tracked yet"
          message="Management guidance (targets, cadence, forward statements) is not built for this symbol. Build the knowledge base to track raised / lowered / missed guidance over time."
          icon={<ClipboardList size={16} />}
          actions={[{ label: "Build Guidance", onClick: rebuild }]}
        />
      ) : (
        <div className="overflow-hidden rounded-sm border border-terminal-border">
          <DenseTable
            id={`guidance-${symbol}`}
            rows={rows}
            columns={[
              {
                key: "metric",
                title: "Metric",
                type: "text",
                frozen: true,
                width: 150,
                getValue: (r) => r.metric,
                render: (r) => <span className="min-w-0 truncate">{r.metric || "—"}</span>,
              },
              {
                key: "statement",
                title: "Statement",
                type: "text",
                width: 240,
                getValue: (r) => r.statement,
                render: (r) => <span className="min-w-0 truncate" title={r.statement}>{r.statement || "—"}</span>,
              },
              {
                key: "target",
                title: "Target",
                type: "text",
                width: 140,
                getValue: (r) => r.target,
                render: (r) => <span className="min-w-0 truncate">{r.target || "—"}</span>,
              },
              {
                key: "period",
                title: "Period",
                type: "text",
                width: 100,
                getValue: (r) => r.period,
                render: (r) => <span className="min-w-0 truncate">{r.period || "—"}</span>,
              },
              {
                key: "status",
                title: "Status",
                type: "text",
                width: 110,
                getValue: (r) => r.status,
                render: (r) => (
                  <TerminalBadge variant={statusVariant(r.status)} dot>
                    {statusLabel(r.status)}
                  </TerminalBadge>
                ),
              },
              {
                key: "source",
                title: "Source",
                type: "text",
                width: 180,
                getValue: (r) => r.sourceText,
                render: (r) => <span className="min-w-0 truncate">{r.sourceText || "—"}</span>,
              },
            ]}
            rowKey={(row, idx) => `${row.metric}-${idx}`}
            height={320}
          />
        </div>
      )}
    </TerminalPanel>
  );
}