import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { fetchLatestResults } from "../../api/resultsTracker";
import type { ResultsRow } from "../../api/resultsTracker";
import { colorClassFor, formatPct, scorecardLabel, scorecardVariant } from "./helpers";
import { TerminalBadge } from "../terminal/TerminalBadge";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { TerminalTabs } from "../terminal/TerminalTabs";

type Props = {
  market: string;
  onOpen: (symbol: string) => void;
  selectedSymbol?: string | null;
};

function LoadingState() {
  return (
    <div className="flex h-28 items-center justify-center rounded-sm border border-terminal-border bg-terminal-bg">
      <div className="text-xs text-terminal-muted">Loading results…</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-28 items-center justify-center rounded-sm border border-terminal-border bg-terminal-bg">
      <div className="text-center">
        <div className="text-sm text-terminal-muted">No results reported in the last 14 days</div>
      </div>
    </div>
  );
}

export function ResultsLatest({ market, onOpen }: Props) {
  const navigate = useNavigate();
  const [term, setTerm] = useState("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["results-latest", market, 30],
    queryFn: () => fetchLatestResults(market, 30),
    staleTime: 30 * 60 * 1000,
  });

  const items = useMemo(() => data?.items ?? [], [data?.items]);
  const warnings = useMemo(() => data?.warnings ?? [], [data?.warnings]);

  const filtered = useMemo(() => {
    if (!term.trim()) return items;
    const q = term.trim().toUpperCase();
    return items.filter(
      (r: ResultsRow) =>
        r.symbol.toUpperCase().includes(q) ||
        (r.name ?? "").toUpperCase().includes(q),
    );
  }, [items, term]);

  useEffect(() => {
    setTerm("");
  }, [market]);

  return (
    <TerminalPanel title="Latest quarterly results" subtitle="Symbols that reported in the last 14 days" className="w-full">
      <div className="space-y-3">
        <div className="relative w-56 sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-terminal-muted" aria-hidden="true" />
          <input
            className="h-8 w-full rounded-sm border border-terminal-border bg-terminal-bg pl-8 pr-7 font-sans text-xs text-terminal-text outline-none transition-colors placeholder:text-terminal-muted focus:border-terminal-accent"
            value={term}
            onChange={(e) => setTerm(e.target.value.toUpperCase())}
            placeholder="Filter by symbol…"
            aria-label="Filter results by symbol"
          />
        </div>

        {isLoading ? (
          <LoadingState />
        ) : isError || !items.length ? (
          <EmptyState />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-terminal-border text-[10px] uppercase text-terminal-muted">
                  <th className="px-3 py-1.5 text-left font-medium">Symbol</th>
                  <th className="px-3 py-1.5 text-left font-medium">Company</th>
                  <th className="px-3 py-1.5 text-left font-medium">Period</th>
                  <th className="px-3 py-1.5 text-right font-medium">Rev YoY</th>
                  <th className="px-3 py-1.5 text-right font-medium">Profit YoY</th>
                  <th className="hidden px-3 py-1.5 text-right font-medium text-terminal-muted sm:table-cell">Surprise %</th>
                  <th className="px-3 py-1.5 text-right font-medium text-terminal-muted">Score</th>
                  <th className="px-3 py-1.5 text-right font-medium text-terminal-muted" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((row: ResultsRow, idx: number) => (
                  <Row
                    key={row.symbol}
                    row={row}
                    index={idx}
                    onOpen={() => onOpen(row.symbol)}
                    onSecurity={() => navigate(`/equity/security/${encodeURIComponent(row.symbol)}?tab=financials`)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {warnings.length > 0 ? (
          <div className="rounded-sm border border-terminal-border/60 bg-terminal-bg/60 px-3 py-2 text-[11px] text-terminal-muted">
            {warnings.join(" · ")}
          </div>
        ) : null}
      </div>
    </TerminalPanel>
  );
}

function Row({ row, index, onOpen, onSecurity }: { row: ResultsRow; index: number; onOpen: () => void; onSecurity: () => void }) {
  const variant = scorecardVariant(row.scorecard);
  return (
    <tr
      className={`border-b border-terminal-border/40 ${
        index % 2 === 0 ? "bg-terminal-bg" : "bg-terminal-bg/40"
      }`}
    >
      <td className="px-3 py-1.5 font-sans font-semibold text-terminal-text">
        <button type="button" onClick={onSecurity} className="hover:underline">
          {row.symbol}
        </button>
      </td>
      <td className="px-3 py-1.5 font-sans text-terminal-muted">{row.name ?? "—"}</td>
      <td className="px-3 py-1.5 font-sans text-terminal-muted">{row.period || "—"}</td>
      <td className={`px-3 py-1.5 text-right font-sans font-semibold ${colorClassFor(row.revenue_yoy_pct)}`}>
        {formatPct(row.revenue_yoy_pct)}
      </td>
      <td className={`px-3 py-1.5 text-right font-sans font-semibold ${colorClassFor(row.profit_yoy_pct)}`}>
        {formatPct(row.profit_yoy_pct)}
      </td>
      <td className={`hidden px-3 py-1.5 text-right font-sans font-semibold sm:table-cell ${colorClassFor(row.eps_surprise_pct)}`}>
        {formatPct(row.eps_surprise_pct)}
      </td>
      <td className="px-3 py-1.5 text-right">
        <TerminalBadge
          variant={scorecardVariant(row.scorecard)}
          dot
          className="font-sans text-[10px]"
        >
          {scorecardLabel(row.scorecard)}
        </TerminalBadge>
      </td>
      <td className="px-3 py-1.5 text-right">
        <button
          type="button"
          onClick={onOpen}
          className="rounded-sm border border-terminal-border px-2 py-0.5 font-sans text-[10px] text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
        >
          View ▾
        </button>
      </td>
    </tr>
  );
}