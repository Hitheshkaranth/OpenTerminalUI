import { TerminalPanel } from "../../../components/terminal/TerminalPanel";
import { DataGrid } from "../../../components/common/DataGrid";
import { InlineBar } from "./InlineBar";
import { ScoreBadge } from "./ScoreBadge";
import { SparklineCell } from "./SparklineCell";
import { useScreenerContext } from "./ScreenerContext";

function toNum(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function ResultsTable() {
  const { result, selectedRow, setSelectedRow } = useScreenerContext();
  const rows = result?.results || [];
  const selectedIndex = selectedRow ? rows.indexOf(selectedRow) : -1;

  return (
    <TerminalPanel title="Results" subtitle={`Rows: ${rows.length}`}>
      <DataGrid
        preset="screener"
        rows={rows}
        rowKey={(row, idx) => `${String(row.ticker || "row")}-${idx}`}
        selectedIndex={selectedIndex >= 0 ? selectedIndex : undefined}
        onRowSelect={(idx) => setSelectedRow(rows[idx] || null)}
        onRowOpen={(idx) => setSelectedRow(rows[idx] || null)}
        className="max-h-[52vh] xl:max-h-[56vh]"
        columns={[
          {
            key: "company",
            header: "Company",
            sortable: true,
            sortValue: (row) => String(row.company || row.company_name || row.ticker || ""),
            renderCell: (row) => String(row.company || row.company_name || row.ticker || "-"),
          },
          {
            key: "sector",
            header: "Sector",
            sortable: true,
            sortValue: (row) => String(row.sector || ""),
            renderCell: (row) => <span className="text-terminal-muted">{String(row.sector || "-")}</span>,
          },
          {
            key: "mcap",
            header: "MCap",
            align: "right",
            sortable: true,
            sortValue: (row) => toNum(row.market_cap),
            renderCell: (row) => toNum(row.market_cap).toLocaleString("en-IN", { maximumFractionDigits: 0 }),
          },
          {
            key: "pe",
            header: "PE",
            align: "right",
            sortable: true,
            sortValue: (row) => toNum(row.pe),
            renderCell: (row) => toNum(row.pe).toFixed(2),
          },
          {
            key: "roe",
            header: "ROE",
            align: "right",
            sortable: true,
            sortValue: (row) => toNum(row.roe),
            renderCell: (row) => toNum(row.roe).toFixed(2),
          },
          {
            key: "roce",
            header: "ROCE",
            align: "right",
            sortable: true,
            sortValue: (row) => toNum(row.roce),
            renderCell: (row) => (
              <div className="flex items-center justify-end gap-2">
                <InlineBar value={toNum(row.roce)} />
                <span>{toNum(row.roce).toFixed(1)}</span>
              </div>
            ),
          },
          {
            key: "spark",
            header: "1Y",
            renderCell: (row) => <SparklineCell values={Array.isArray(row.sparkline_price_1y) ? (row.sparkline_price_1y as number[]) : []} />,
          },
          {
            key: "score",
            header: "Score",
            renderCell: (row) => {
              const scores = (row.scores as Record<string, unknown>) || {};
              const raw = scores.quality_score as { value?: number } | undefined;
              return <ScoreBadge value={raw?.value ?? 0} max={100} label="Q" />;
            },
          },
        ]}
      />
    </TerminalPanel>
  );
}
