import { useState, useMemo, useContext } from "react";

import { useProvidersStatus } from "../../api/providers";
import { testProvider, useProviderKeys } from "../../api/providerKeys";
import { AuthContextRef } from "../../contexts/AuthContext";
import { TerminalBadge } from "../terminal/TerminalBadge";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalTable } from "../terminal/TerminalTable";
import { formatDistanceToNow } from "date-fns";
import { ProviderKeyForm } from "./ProviderKeyForm";

export function DataProvidersPanel() {
  const { data, isLoading, error, refetch } = useProvidersStatus();
  const authCtx = useContext(AuthContextRef);
  const isAdmin = String(authCtx?.user?.role ?? "").toLowerCase() === "admin";
  const keysQuery = useProviderKeys(isAdmin);
  const [testResults, setTestResults] = useState<Record<string, { status: string; last_error: string | null; loading: boolean }>>({});
  const [openProvider, setOpenProvider] = useState<string | null>(null);

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
    {
      key: "keys",
      label: "Keys",
      align: "right",
      render: (row) => {
        if (!isAdmin) {
          return <span className="text-[10px] text-terminal-muted">Sign in as admin to manage keys</span>;
        }
        if (row.env_keys.length === 0) {
          return <span className="text-terminal-muted">—</span>;
        }
        return (
          <TerminalButton
            size="sm"
            variant="default"
            onClick={() => setOpenProvider(openProvider === row.id ? null : row.id)}
          >
            Set keys
          </TerminalButton>
        );
      },
    },
    {
      key: "test",
      label: "Test",
      align: "right",
      render: (row) => {
        if (!isAdmin) {
          return <span className="text-[10px] text-terminal-muted">—</span>;
        }
        const result = testResults[row.id];
        const isLoadingTest = result?.loading ?? false;

        const handleTest = async () => {
          setTestResults((prev) => ({
            ...prev,
            [row.id]: { ...prev[row.id], loading: true },
          }));
          try {
            const res = await testProvider(row.id);
            setTestResults((prev) => ({
              ...prev,
              [row.id]: { status: res.status, last_error: res.last_error, loading: false },
            }));
          } catch {
            setTestResults((prev) => ({
              ...prev,
              [row.id]: { status: "down", last_error: "Test failed", loading: false },
            }));
          }
        };

        const statusBadge = result ? (
          result.status === "ok" ? (
            <TerminalBadge variant="live" dot>OK</TerminalBadge>
          ) : result.status === "degraded" ? (
            <TerminalBadge variant="warn" dot>DEGRADED</TerminalBadge>
          ) : result.status === "unconfigured" ? (
            <TerminalBadge variant="neutral" dot>NOT CONFIGURED</TerminalBadge>
          ) : (
            <TerminalBadge variant="danger" dot>DOWN</TerminalBadge>
          )
        ) : null;

        return (
          <div className="flex items-center justify-end gap-1">
            {statusBadge}
            {result?.last_error && (
              <span className="text-[10px] text-terminal-neg">{result.last_error}</span>
            )}
            <TerminalButton
              size="sm"
              variant="default"
              loading={isLoadingTest}
              onClick={handleTest}
            >
              Test
            </TerminalButton>
          </div>
        );
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
      {isAdmin && openProvider && (
        <div className="mt-2">
          {(() => {
            const providerData = data.providers.find((p) => p.id === openProvider);
            if (!providerData) return null;
            // All key rows for this provider (Kite has three); the form matches by name.
            const rows = (keysQuery.data?.keys ?? []).filter((k) => k.provider === providerData.id);
            return (
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-terminal-muted">{providerData.name}</span>
                  <TerminalButton size="sm" variant="ghost" onClick={() => setOpenProvider(null)}>
                    Close
                  </TerminalButton>
                </div>
                <ProviderKeyForm
                  providerId={providerData.id}
                  envKeys={providerData.env_keys}
                  rows={rows}
                  onSaved={() => {
                    // Keep the form open so the "applied live / restart required" line is readable.
                    void keysQuery.refetch();
                    void refetch();
                  }}
                />
              </div>
            );
          })()}
        </div>
      )}
      {!isAdmin && (
        <div className="mt-2 text-[11px] text-terminal-muted">
          Sign in as admin to manage keys
        </div>
      )}
    </div>
  );
}