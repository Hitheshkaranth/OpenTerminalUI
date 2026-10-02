import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  bestCells,
  parsePeerKpis,
  usePeerKpiComparison,
  type Citation,
  type PeerKpiCell,
  type PeerKpiRow,
} from "../../api/peerKpis";
import { CitationHint } from "../business/citations";
import { TerminalBadge } from "../terminal/TerminalBadge";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalInput } from "../terminal/TerminalInput";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { TerminalTooltip } from "../terminal/TerminalTooltip";

export type PeerKpiComparisonProps = { symbol: string; market?: string };

const ROW_LABEL = "min-w-[14rem] max-w-[22rem] shrink-0 border-r border-terminal-border px-2.5 py-1.5 text-left";
const COLUMN_HEAD = "min-w-[6rem] border-r border-terminal-border px-2.5 py-1.5 text-center uppercase tracking-wider ot-type-table-header text-[10px] text-terminal-accent";
const COLUMN = "min-w-[6rem] border-r border-terminal-border px-2.5 py-1.5 text-right";

function directionTitle(higherIsBetter: boolean | null): string {
  return higherIsBetter === true
    ? "Higher is better"
    : higherIsBetter === false
      ? "Lower is better"
      : "No directional preference";
}

function directionText(higherIsBetter: boolean | null): string {
  return higherIsBetter === true
    ? "text-terminal-pos"
    : higherIsBetter === false
      ? "text-terminal-neg"
      : "text-terminal-muted";
}

function directionGlyph(higherIsBetter: boolean | null): string {
  return higherIsBetter === true ? "▲" : higherIsBetter === false ? "▼" : "—";
}

function resolveColumns(symbol: string, peers: string[], rows: PeerKpiRow[]): string[] {
  const present = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row.values)) present.add(key);
  }
  return [symbol, ...peers].filter((peer) => present.has(peer));
}

function buildBestMap(rows: PeerKpiRow[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const row of rows) {
    if (Object.keys(row.values).length < 2) continue;
    map.set(row.key, bestCells(row.values, row.higher_is_better));
  }
  return map;
}

function KpiCell({ value, unit, period, citation, best }: {
  value: number | null | undefined;
  unit: string | null | undefined;
  period: string | null | undefined;
  citation: Citation | null | undefined;
  best: boolean;
}) {
  if (value == null || !Number.isFinite(value)) {
    return <span className="text-terminal-muted">—</span>;
  }
  const text = Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (best) {
    return (
      <span
        data-best="true"
        className="rounded border border-terminal-pos/60 bg-terminal-pos/10 px-1 ot-type-data text-[11px] text-terminal-pos"
        title="Best in set"
      >
        {text}{unit ? <span className="opacity-70"> {unit}</span> : null}
      </span>
    );
  }
  return (
    <span className="ot-type-data text-[11px] text-terminal-text">
      {text}{unit ? <span className="text-terminal-muted"> {unit}</span> : null}
    </span>
  );
}

function Cell({ row, symbol, best }: { row: PeerKpiRow; symbol: string; best: boolean }) {
  const cell: PeerKpiCell | undefined = row.values[symbol];
  if (!cell) {
    return <td className={COLUMN}><span className="text-terminal-muted">—</span></td>;
  }
  return (
    <td className={COLUMN}>
      <div className="flex min-w-0 items-center justify-end gap-0.5">
        <KpiCell value={cell.value} unit={cell.unit} period={cell.period} citation={cell.citation ?? undefined} best={best} />
        {cell.citation ? <CitationHint citation={cell.citation} /> : null}
      </div>
    </td>
  );
}

function KpiMatrix({ rows, columns, bestMap }: {
  rows: PeerKpiRow[];
  columns: string[];
  bestMap: Map<string, Set<string>>;
}) {
  if (!rows.length) {
    return (
      <div className="rounded-sm border border-dashed border-terminal-border bg-terminal-panel px-2.5 py-6 text-center text-terminal-muted text-[10px]">
        No KPI coverage for these peers yet.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse">
        <thead>
          <tr>
            <th className={ROW_LABEL + " text-left uppercase tracking-wider ot-type-table-header text-[10px] text-terminal-muted"}>Metric</th>
            {columns.map((symbol) => (
              <th key={symbol} className={COLUMN_HEAD}>{symbol}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-terminal-border/40">
          {rows.map((row) => (
            <tr key={row.key} className="hover:bg-terminal-bg/60">
              <td className={ROW_LABEL}>
                <div className="flex items-center gap-1">
                  <span className="truncate ot-type-label text-[11px] text-terminal-text">{row.label || row.key}</span>
                  <TerminalTooltip content={directionTitle(row.higher_is_better)}>
                    <span className={`shrink-0 text-[9px] ${directionText(row.higher_is_better)}`}>{directionGlyph(row.higher_is_better)}</span>
                  </TerminalTooltip>
                </div>
              </td>
              {columns.map((symbol) => (
                <Cell key={`${row.key}:${symbol}`} row={row} symbol={symbol} best={bestMap.get(row.key)?.has(symbol) ?? false} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HasWarnings({ warnings }: { warnings: string[] }) {
  if (!warnings?.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5" role="alert">
      {warnings.map((warning, idx) => (
        <span
          key={idx}
          className="rounded-sm border border-terminal-warn bg-terminal-warn/10 px-2 py-0.5 ot-type-ui text-[10px] text-terminal-warn"
        >
          {warning}
        </span>
      ))}
    </div>
  );
}

export function PeerKpiComparison({ symbol, market }: PeerKpiComparisonProps) {
  const [peersInput, setPeersInput] = useState("");
  const [peersArg, setPeersArg] = useState<string[] | undefined>(undefined);

  useEffect(() => {
    const tokens = parsePeerKpis(peersInput);
    const handle = window.setTimeout(() => setPeersArg(tokens.length ? tokens : undefined), 200);
    return () => window.clearTimeout(handle);
  }, [peersInput]);

  const { data, isLoading, isError, error, refetch } = usePeerKpiComparison(symbol, market, peersArg);

  const table = data ?? null;
  const columns = useMemo(() => (table ? resolveColumns(table.symbol, table.peers, table.rows) : []), [table]);
  const kpiBestMap = useMemo(() => buildBestMap(table?.rows ?? []), [table]);
  const finBestMap = useMemo(() => buildBestMap(table?.financial_rows ?? []), [table]);

  if (isLoading && !table) {
    return (
      <TerminalPanel title="Peer KPI comparison" subtitle="Loading…">
        <div className="px-2.5 py-6 text-terminal-muted text-[11px]">Comparing operational KPIs…</div>
      </TerminalPanel>
    );
  }

  if (isError || !table) {
    return (
      <TerminalPanel title="Peer KPI comparison" subtitle="Error">
        <div className="flex flex-col items-start gap-3 px-2.5 py-6">
          <div className="rounded-sm border border-terminal-neg bg-terminal-neg/10 px-3 py-2 ot-type-ui text-[11px] text-terminal-neg">
            {error instanceof Error ? error.message : "Failed to load peer KPI comparison."}
          </div>
          <TerminalButton size="sm" onClick={() => refetch()}>Retry</TerminalButton>
        </div>
      </TerminalPanel>
    );
  }

  if (!table.rows.length && !table.financial_rows.length) {
    return (
      <TerminalPanel title="Peer KPI comparison" subtitle="Not compared yet">
        <div className="flex flex-col gap-3 px-2.5 py-6">
          <HasWarnings warnings={table.warnings} />
          <div className="rounded-sm border border-dashed border-terminal-border bg-terminal-panel px-3 py-6 text-center text-terminal-muted text-[11px]">
            No operational KPI coverage across these peers. Run the Filings Extract so KPIs can be compared.
          </div>
        </div>
      </TerminalPanel>
    );
  }

  return (
    <TerminalPanel title="Peer KPI comparison" subtitle="Operational + financial comparison">
      <div className="flex flex-col gap-4">
        <HasWarnings warnings={table.warnings} />

        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-[18rem] flex-1">
            <TerminalInput
              as="input"
              size="sm"
              tone="data"
              placeholder="Peers: RELIANCE, INFY, WIPRO (blank = suggested)"
              value={peersInput}
              onChange={(event) => setPeersInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.preventDefault();
              }}
              aria-label="Peer symbols for comparison"
            />
          </div>
          {table.peers.length ? (
            <span className="shrink-0 rounded-sm border border-terminal-border bg-terminal-bg px-2 py-0.5 ot-type-label text-[10px] text-terminal-muted">
              {table.peers.length} peers
            </span>
          ) : null}
        </div>

        {table.peers.length ? (
          <div className="ot-type-ui text-[10px] text-terminal-muted">Comparing against {table.symbol} → {table.peers.join(", ")}</div>
        ) : null}

        {table.missing.length ? (
          <div className="flex flex-col gap-2 rounded-sm border border-terminal-border bg-terminal-panel px-2.5 py-2.5">
            <div className="flex items-center justify-between">
              <h4 className="ot-type-label text-[11px] uppercase tracking-wide text-terminal-muted">Missing coverage</h4>
              <span className="ot-type-ui text-[10px] text-terminal-muted">No extracted KPIs — run Extract in the Hub</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {table.missing.map((missing) => (
                <Link
                  key={missing}
                  to={`/equity/security/${missing}?tab=filings`}
                  className="inline-flex items-center gap-1 rounded-sm border border-terminal-border bg-terminal-bg px-2 py-0.5 ot-type-label text-[10px] text-terminal-accent hover:border-terminal-accent hover:text-terminal-accent"
                >
                  {missing}
                </Link>
              ))}
            </div>
          </div>
        ) : null}

        <section className="flex flex-col gap-2">
          <h4 className="ot-type-label text-[11px] uppercase tracking-wide text-terminal-muted">Operational KPIs</h4>
          <KpiMatrix rows={table.rows} columns={columns} bestMap={kpiBestMap} />
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h4 className="ot-type-label text-[11px] uppercase tracking-wide text-terminal-muted">Financial comparison</h4>
            {table.financial_rows.length ? (
              <TerminalBadge size="sm" variant="info">{table.financial_rows.length} metrics</TerminalBadge>
            ) : null}
          </div>
          <KpiMatrix rows={table.financial_rows} columns={columns} bestMap={finBestMap} />
        </section>
      </div>
    </TerminalPanel>
  );
}