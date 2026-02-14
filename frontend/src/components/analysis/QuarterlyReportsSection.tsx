import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";

import { getQuarterlyReports } from "../../providers/reportsProvider";
import type { QuarterlyReport } from "../../types/financialReports";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { TerminalTable } from "../terminal/TerminalTable";

type Props = {
  symbol: string;
  market: string;
  limit?: number;
};

function openLink(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function primaryLink(report: QuarterlyReport): string | null {
  return report.links.find((link) => link.type === "PDF")?.url ?? report.links[0]?.url ?? null;
}

export function QuarterlyReportsSection({ symbol, market, limit = 8 }: Props) {
  const [selected, setSelected] = useState(0);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["quarterly-reports", market, symbol, limit],
    queryFn: () => getQuarterlyReports({ symbol, market, limit }),
    enabled: Boolean(symbol),
    staleTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const rows = useMemo(() => data ?? [], [data]);

  useEffect(() => {
    setSelected(0);
  }, [market, symbol]);

  useEffect(() => {
    if (selected >= rows.length) setSelected(Math.max(0, rows.length - 1));
  }, [rows.length, selected]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((prev) => Math.min(prev + 1, Math.max(0, rows.length - 1)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((prev) => Math.max(prev - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const link = primaryLink(rows[selected]);
      if (link) openLink(link);
      return;
    }
    if (event.key === "r" || event.key === "R") {
      event.preventDefault();
      void refetch();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setSelected(0);
    }
  };

  return (
    <TerminalPanel
      title="Quarterly Reports"
      subtitle="Up/Down select | Enter opens PDF | R refresh"
      actions={<TerminalButton onClick={() => void refetch()}>Refresh</TerminalButton>}
      className="focus-within:border-terminal-accent"
      bodyClassName="p-0"
    >
      <div tabIndex={0} onKeyDown={onKeyDown} className="outline-none">
        {isLoading && <div className="py-4 px-2 text-xs text-terminal-muted">Loading quarterly reports...</div>}
        {isError && <div className="py-4 px-2 text-xs text-terminal-neg">Failed to load quarterly reports</div>}
        {!isLoading && !isError && (
          <TerminalTable
            rows={rows}
            rowKey={(row) => row.id}
            selectedIndex={selected}
            onRowSelect={setSelected}
            emptyText="No quarterly reports available"
            columns={[
              { key: "q", label: "Quarter", render: (row) => row.quarterLabel },
              { key: "period", label: "Period End", render: (row) => row.periodEndDate },
              { key: "pub", label: "Published", render: (row) => row.filingDate },
              { key: "type", label: "Type", render: (row) => row.reportType },
              {
                key: "links",
                label: "Links",
                render: (row) => (
                  <div className="flex items-center gap-1">
                    {row.links.map((link) => (
                      <TerminalButton key={`${row.id}-${link.type}`} onClick={() => openLink(link.url)} className="px-1 py-0">
                        {link.type}
                      </TerminalButton>
                    ))}
                  </div>
                ),
              },
            ]}
          />
        )}
      </div>
    </TerminalPanel>
  );
}
