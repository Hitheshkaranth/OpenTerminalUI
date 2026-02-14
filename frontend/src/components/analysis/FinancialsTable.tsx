import { useMemo } from "react";

import type { FinancialSection } from "../../types";
import { useDisplayCurrency } from "../../hooks/useDisplayCurrency";

type Props = {
  title: string;
  rows: FinancialSection;
  period?: "annual" | "quarterly";
};

function numericValue(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  return null;
}

function toFiscalYear(date: Date): number {
  const month = date.getUTCMonth() + 1;
  const year = date.getUTCFullYear();
  return month >= 4 ? year + 1 : year;
}

function toFiscalQuarter(date: Date): 1 | 2 | 3 | 4 {
  const month = date.getUTCMonth() + 1;
  if (month >= 4 && month <= 6) return 1;
  if (month >= 7 && month <= 9) return 2;
  if (month >= 10 && month <= 12) return 3;
  return 4;
}

function fiscalLabel(raw: string, period: "annual" | "quarterly"): string {
  const date = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return raw;
  const fy = String(toFiscalYear(date)).slice(-2);
  if (period === "annual") return `FY${fy}`;
  return `FY${fy} Q${toFiscalQuarter(date)}`;
}

export function FinancialsTable({ title, rows, period = "annual" }: Props) {
  const { financialUnit, formatFinancialCompact } = useDisplayCurrency();

  const columns = useMemo(() => {
    if (rows.length === 0) {
      return [] as string[];
    }
    return Object.keys(rows[0]).filter((k) => k !== "metric");
  }, [rows]);

  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-3">
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      <div className="mb-2 text-[11px] text-terminal-muted">Values shown in {financialUnit}</div>
      {rows.length === 0 && <div className="mb-2 text-xs text-terminal-muted">No financial data available for this period.</div>}
      <div className="overflow-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="border-b border-terminal-border text-terminal-muted">
              <th className="px-2 py-1 text-left">Metric</th>
              {columns.map((col) => (
                <th key={col} className="px-2 py-1 text-right">
                  {fiscalLabel(col, period)}
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
                      {numeric !== null ? formatFinancialCompact(numeric) : "-"}
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
