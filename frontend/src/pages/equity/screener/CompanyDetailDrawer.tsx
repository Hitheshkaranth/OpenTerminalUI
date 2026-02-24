import { TerminalBadge } from "../../../components/terminal/TerminalBadge";
import { TerminalButton } from "../../../components/terminal/TerminalButton";
import { TerminalPanel } from "../../../components/terminal/TerminalPanel";
import { SparklineCell } from "./SparklineCell";
import { useScreenerContext } from "./ScreenerContext";

function formatNum(value: unknown) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "--";
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export function CompanyDetailDrawer() {
  const { selectedRow, setSelectedRow } = useScreenerContext();
  if (!selectedRow) {
    return (
      <TerminalPanel title="Company Detail" subtitle="Select a row" className="h-full">
        <div className="text-xs text-terminal-muted">Choose a result row to inspect scores, chart, and snapshot metrics.</div>
      </TerminalPanel>
    );
  }

  const scoreEntries = Object.entries((selectedRow.scores as Record<string, unknown>) || {});

  return (
    <TerminalPanel
      title={String(selectedRow.company || selectedRow.ticker || "Company")}
      subtitle={String(selectedRow.ticker || "-")}
      className="h-full"
      bodyClassName="space-y-2 overflow-auto max-h-[72vh]"
      actions={<TerminalButton variant="default" onClick={() => setSelectedRow(null)}>Close</TerminalButton>}
    >
      <div className="grid grid-cols-2 gap-2 rounded-sm border border-terminal-border bg-terminal-bg p-2 text-xs">
        <div>
          <div className="text-terminal-muted">Sector</div>
          <div>{String(selectedRow.sector || "-")}</div>
        </div>
        <div>
          <div className="text-terminal-muted">Market Cap</div>
          <div>{formatNum(selectedRow.market_cap)}</div>
        </div>
        <div>
          <div className="text-terminal-muted">PE</div>
          <div>{formatNum(selectedRow.pe)}</div>
        </div>
        <div>
          <div className="text-terminal-muted">ROE</div>
          <div>{formatNum(selectedRow.roe)}</div>
        </div>
      </div>

      <div className="rounded-sm border border-terminal-border bg-terminal-bg p-2">
        <div className="mb-1 text-[11px] uppercase tracking-wide text-terminal-muted">Price Trend</div>
        <SparklineCell values={Array.isArray(selectedRow.sparkline_price_1y) ? (selectedRow.sparkline_price_1y as number[]) : []} width={240} height={60} />
      </div>

      <div className="rounded-sm border border-terminal-border bg-terminal-bg p-2">
        <div className="mb-1 text-[11px] uppercase tracking-wide text-terminal-muted">Model Scores</div>
        <div className="space-y-1 text-xs">
          {scoreEntries.map(([name, payload]) => (
            <div key={name} className="flex items-center justify-between border-b border-terminal-border/40 pb-1 last:border-b-0">
              <span>{name}</span>
              <TerminalBadge variant="neutral">{typeof payload === "object" && payload && "value" in payload ? String((payload as { value: unknown }).value) : "--"}</TerminalBadge>
            </div>
          ))}
        </div>
      </div>
    </TerminalPanel>
  );
}
