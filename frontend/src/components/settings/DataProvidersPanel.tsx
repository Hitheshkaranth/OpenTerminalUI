import { useMemo } from "react";

import { useProvidersStatus } from "../../api/providers";
import { TerminalBadge } from "../terminal/TerminalBadge";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalTable } from "../terminal/TerminalTable";
import { formatDistanceToNow } from "date-fns";

export function DataProvidersPanel() {
  const { data, isLoading, error, refetch } = useProvidersStatus();

  if (isLoading) {
    return <div className="text-xs text-terminal-muted">Checking providers…</div>;
  }

  if (error) {
    return <div className="text-xs text-terminal-neg">Could not reach /api/providers/status</div>;
  }

  if (!data) {
    return null;
  }

  const overallBadge = data.overall === "ok" ? (
    <TerminalBadge variant="live" dot>OK</TerminalBadge>
  ) : data.overall === "degraded" ? (
    <TerminalBadge variant="warn" dot>DEGRADED</TerminalBadge>
  ) : (
    <TerminalBadge variant="danger" dot>DOWN</TerminalBadge>
  );

  const checkedAtDate = data.checked_at ? new Date(data.checked_at) : null;
  const checkedRelative = checkedAtDate && !isNaN(checkedAtDate.getTime())
    ? formatDistanceToNow(checkedAtDate)
    : "";

  const columns: Array<import("../../components/terminal/TerminalTable").TerminalTableColumn<import("../../api/providers").ProviderStatus>> = [
    {
      key: "provider",
      label: "Provider",
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-terminal-text">{row.name}</span>
          {row.markets.length > 0 && (
            <div className="flex flex-wrap gap-0.5">
              {row.markets.map((m) => (
                <span key={m} className="rounded-sm border border-terminal-border px-1 py-0.5 text-[9px] text-terminal-muted">
                  {m}
                </span>
              ))}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (row) => {
        const badge = row.status === "ok" ? (
          <TerminalBadge variant="live" dot>OK</TerminalBadge>
        ) : row.status === "degraded" ? (
          <TerminalBadge variant="warn" dot>DEGRADED</TerminalBadge>
        ) : row.status === "down" ? (
          <TerminalBadge variant="danger" dot>DOWN</TerminalBadge>
        ) : (
          <TerminalBadge variant="neutral" dot>NOT CONFIGURED</TerminalBadge>
        );
        return badge;
      },
    },
    {
      key: "last_success",
      label: "Last success",
      align: "right",
      render: (row) => {
        if (!row.last_success_at) return <span className="text-terminal-muted">—</span>;
        const date = new Date(row.last_success_at);
        if (isNaN(date.getTime())) return <span className="text-terminal-muted">—</span>;
        return <span className="text-terminal-text">{formatDistanceToNow(date)}</span>;
      },
    },
    {
      key: "unlocks",
      label: "Unlocks",
      render: (row) => {
        if (!row.unlocks.length) return <span className="text-terminal-muted">—</span>;
        return <span className="text-terminal-text">{row.unlocks.join(", ")}</span>;
      },
    },
    {
      key: "setup",
      label: "Setup",
      render: (row) => {
        if (row.configured && row.last_error) {
          const truncated = row.last_error.length > 80
            ? row.last_error.slice(0, 80)
            : row.last_error;
          return (
            <span className="font-mono text-xs text-terminal-muted" title={row.last_error}>
              {truncated}
            </span>
          );
        }
        if (!row.configured && row.env_keys.length > 0) {
          return (
            <span className="font-mono text-[11px] text-terminal-muted">
              Set {row.env_keys.join(", ")} in .env, then restart
            </span>
          );
        }
        return <span className="text-terminal-muted">—</span>;
      },
    },
  ];

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-terminal-muted">Overall:</span>
          {overallBadge}
          {checkedRelative && (
            <span className="text-[11px] text-terminal-muted">Checked {checkedRelative}</span>
          )}
        </div>
        <TerminalButton size="sm" variant="default" onClick={() => void refetch()}>
          Refresh
        </TerminalButton>
      </div>
      <TerminalTable<import("../../api/providers").ProviderStatus>
        columns={columns}
        rows={data.providers}
        rowKey={(row) => row.id}
        emptyText="No providers configured"
        density="compact"
      />
    </div>
  );
}