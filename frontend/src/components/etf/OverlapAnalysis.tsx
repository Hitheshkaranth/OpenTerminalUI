import { useEffect, useState } from "react";
import { TerminalTable, type TerminalTableColumn } from "../terminal/TerminalTable";
import { formatPercent } from "../../lib/format";

interface CommonHolding {
  symbol: string;
  name: string;
  weight: number;
}

interface OverlapData {
  tickers: string[];
  overlap_pct: number;
  common_holdings: CommonHolding[];
}

interface Props {
  tickers: string[];
}

export function OverlapAnalysis({ tickers }: Props) {
  const [data, setData] = useState<OverlapData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (tickers.length < 2) return;

    const fetchOverlap = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/etf/overlap?tickers=${tickers.join(",")}`);
        if (!response.ok) throw new Error("Failed to fetch overlap analysis");
        const json = await response.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setLoading(false);
      }
    };

    fetchOverlap();
  }, [tickers]);

  const columns: TerminalTableColumn<CommonHolding>[] = [
    {
      key: "symbol",
      label: "Symbol",
      sortable: true,
      render: (h) => <span className="font-medium text-terminal-accent">{h.symbol}</span>,
    },
    {
      key: "name",
      label: "Name",
      sortable: true,
      render: (h) => <span className="truncate text-terminal-text">{h.name}</span>,
    },
    {
      key: "weight",
      label: "Overlap Weight (%)",
      align: "right",
      sortable: true,
      render: (h) => <span className="text-terminal-pos">{formatPercent(h.weight)}</span>,
    },
  ];

  if (tickers.length < 2) return <div className="p-4 text-center text-terminal-muted">Select at least two ETFs for overlap analysis</div>;
  if (loading) return <div className="p-4 text-center text-terminal-muted">Loading overlap analysis...</div>;
  if (error) return <div className="p-4 text-center text-terminal-neg">{error}</div>;
  if (!data) return null;

  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-1">
      <div className="mb-2 px-3 py-2 flex justify-between items-center">
        <div className="text-xs font-semibold uppercase tracking-wider text-terminal-muted">
          Overlap: {data.tickers.join(" vs ")}
        </div>
        <div className="text-sm font-bold text-terminal-accent">
          {formatPercent(data.overlap_pct)} Overlap
        </div>
      </div>
      <TerminalTable
        columns={columns}
        rows={data.common_holdings}
        rowKey={(h) => h.symbol}
        emptyText="No common holdings found"
        density="compact"
      />
    </div>
  );
}
