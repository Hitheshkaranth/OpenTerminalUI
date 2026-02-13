import { useMemo } from "react";

import type { FinancialSection } from "../../types";
import { formatInr } from "../../utils/formatters";

type Props = {
  title: string;
  rows: FinancialSection;
};

function numericValue(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  return null;
}

export function FinancialsTable({ title, rows }: Props) {
  const columns = useMemo(() => {
    if (rows.length === 0) {
      return [] as string[];
    }
    return Object.keys(rows[0]).filter((k) => k !== "metric");
  }, [rows]);

  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-3">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {rows.length === 0 && <div className="mb-2 text-xs text-terminal-muted">No financial data available for this period.</div>}
      <div className="overflow-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="border-b border-terminal-border text-terminal-muted">
              <th className="px-2 py-1 text-left">Metric</th>
              {columns.map((col) => (
                <th key={col} className="px-2 py-1 text-right">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={String(row.metric)} className="border-b border-terminal-border/60">
                <td className="px-2 py-1 text-left">{row.metric as string}</td>
                {columns.map((col) => {
                  const val = row[col];
                  const numeric = numericValue(val);
                  return (
                    <td key={col} className="px-2 py-1 text-right">
                      {numeric !== null ? formatInr(numeric) : "-"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
