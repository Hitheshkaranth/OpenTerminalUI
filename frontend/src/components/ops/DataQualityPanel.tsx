import { useMemo, useState } from "react";

import { TerminalBadge } from "../terminal/TerminalBadge";
import { TerminalPanel } from "../terminal/TerminalPanel";
import type { OpsDataQualityReport, OpsDataQualitySymbolRow } from "../../api/client";

type Props = {
  report: OpsDataQualityReport | null;
  loading?: boolean;
};

type SortKey =
  | "symbol"
  | "health_status"
  | "average_latency_ms"
  | "ticks_per_minute"
  | "bars_received_today"
  | "bars_expected_today";

function statusVariant(status: string): "success" | "danger" | "warn" | "neutral" {
  if (status === "healthy") return "success";
  if (status === "stale" || status === "disconnected") return "danger";
  if (status === "degraded") return "warn";
  return "neutral";
}

function Sparkline({ values }: { values: number[] }) {
  const points = useMemo(() => {
    const series = Array.isArray(values) && values.length ? values.slice(-30) : [0];
    const max = Math.max(1, ...series);
    return series
      .map((v, i) => {
        const x = (i / Math.max(1, series.length - 1)) * 100;
        const y = 20 - (Math.max(0, v) / max) * 18;
        return `${x},${y}`;
      })
      .join(" ");
  }, [values]);
  return (
    <svg viewBox="0 0 100 20" className="h-5 w-24">
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={points} />
    </svg>
  );
}

export function DataQualityPanel({ report, loading = false }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("health_status");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const rows = useMemo(() => {
    const input = Array.isArray(report?.symbols) ? [...report.symbols] : [];
    input.sort((a, b) => {
      const av = a[sortKey] as any;
      const bv = b[sortKey] as any;
      if (typeof av === "number" && typeof bv === "number") return sortDir === "asc" ? av - bv : bv - av;
      return sortDir === "asc" ? String(av ?? "").localeCompare(String(bv ?? "")) : String(bv ?? "").localeCompare(String(av ?? ""));
    });
    return input;
  }, [report?.symbols, sortDir, sortKey]);

  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(key === "symbol" ? "asc" : "desc");
  };

  return (
    <TerminalPanel title="DATA QUALITY MONITOR">
      <div className="space-y-2 p-1 text-[10px]">
        <div className="flex flex-wrap items-center gap-2 text-terminal-muted">
          <span>Symbols: {rows.length}</span>
          <span>Updated: {report?.timestamp ? new Date(report.timestamp).toLocaleTimeString() : "-"}</span>
          <span>Primary: {String((report?.us_stream as any)?.primary_provider ?? "-")}</span>
        </div>
        <div className="max-h-72 overflow-auto rounded border border-terminal-border/40">
          <table className="w-full table-fixed text-left">
            <thead className="sticky top-0 bg-terminal-panel">
              <tr className="border-b border-terminal-border/30 text-terminal-muted">
                {[
                  ["symbol", "SYMBOL"],
                  ["health_status", "STATUS"],
                  ["ticks_per_minute", "TPM"],
                  ["average_latency_ms", "LAT(ms)"],
                  ["bars_received_today", "BARS"],
                ].map(([k, label]) => (
                  <th key={k} className="px-2 py-1">
                    <button type="button" onClick={() => onSort(k as SortKey)} className="hover:text-terminal-text">
                      {label}
                    </button>
                  </th>
                ))}
                <th className="px-2 py-1">LAST UPDATE</th>
                <th className="px-2 py-1">PROVIDER</th>
                <th className="px-2 py-1">TICK RATE</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && (
                <tr><td className="px-2 py-2 text-terminal-muted" colSpan={9}>Loading data quality metrics...</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td className="px-2 py-2 text-terminal-dim" colSpan={9}>No monitored symbols yet. Subscribe to US quotes to populate.</td></tr>
              )}
              {rows.map((row) => {
                const typed = row as OpsDataQualitySymbolRow;
                return (
                  <tr key={typed.symbol} className="border-b border-terminal-border/10">
                    <td className="px-2 py-1 font-semibold text-terminal-accent">{typed.symbol}</td>
                    <td className="px-2 py-1">
                      <TerminalBadge variant={statusVariant(String(typed.health_status))} size="sm">
                        {String(typed.health_status).toUpperCase()}
                      </TerminalBadge>
                    </td>
                    <td className="px-2 py-1 tabular-nums">{typed.ticks_per_minute ?? 0}</td>
                    <td className="px-2 py-1 tabular-nums">{Number(typed.average_latency_ms ?? 0).toFixed(1)}</td>
                    <td className="px-2 py-1 tabular-nums">
                      {typed.bars_received_today}/{typed.bars_expected_today}
                    </td>
                    <td className="px-2 py-1">{typed.last_tick_time ? new Date(typed.last_tick_time).toLocaleTimeString() : "-"}</td>
                    <td className="px-2 py-1 uppercase">{typed.provider_source || "-"}</td>
                    <td className="px-2 py-1 text-terminal-accent">
                      <Sparkline values={typed.tick_rate_history || []} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </TerminalPanel>
  );
}
