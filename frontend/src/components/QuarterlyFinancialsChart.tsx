import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useQuarterlyEarningsFinancials } from "../hooks/useStocks";

function toCr(value: number): number {
  return value / 1e7;
}

function fmtCr(value: number): string {
  if (!Number.isFinite(value)) return "-";
  return `? ${value.toFixed(2)} Cr`;
}

export function QuarterlyFinancialsChart({ symbol }: { symbol: string }) {
  const [mode, setMode] = useState<"both" | "revenue" | "net" | "eps">("both");
  const { data = [], isLoading } = useQuarterlyEarningsFinancials(symbol, 12);

  const rows = useMemo(
    () =>
      data.map((r) => ({
        ...r,
        revenueCr: toCr(Number(r.revenue || 0)),
        netCr: toCr(Number(r.net_profit || 0)),
      })),
    [data],
  );

  if (isLoading) return <div className="text-xs text-terminal-muted">Loading quarterly financials...</div>;
  if (!rows.length) return <div className="text-xs text-terminal-muted">No quarterly financials available.</div>;

  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-terminal-accent">Quarterly Financials</div>
        <div className="flex gap-1 text-xs">
          <button className={`rounded border px-2 py-1 ${mode === "revenue" ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`} onClick={() => setMode("revenue")}>Revenue</button>
          <button className={`rounded border px-2 py-1 ${mode === "net" ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`} onClick={() => setMode("net")}>Net Profit</button>
          <button className={`rounded border px-2 py-1 ${mode === "both" ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`} onClick={() => setMode("both")}>Both</button>
          <button className={`rounded border px-2 py-1 ${mode === "eps" ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`} onClick={() => setMode("eps")}>EPS</button>
        </div>
      </div>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#2a2f3a" />
            <XAxis dataKey="quarter" tick={{ fill: "#8e98a8", fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "#8e98a8", fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ border: "1px solid #2a2f3a", background: "#0c0f14", color: "#d8dde7" }}
              formatter={(value: number | string | undefined, name: string | undefined) => {
                if (name === "Revenue" || name === "Net Profit") return [fmtCr(Number(value ?? 0)), name];
                if (name === "EPS") return [Number(value ?? 0).toFixed(2), "EPS"];
                return [String(value ?? "-"), name ?? "Value"];
              }}
            />
            {(mode === "both" || mode === "revenue") && (
              <Bar dataKey="revenueCr" name="Revenue" fill="#16a34a">
                <LabelList dataKey="revenue_yoy_pct" position="top" formatter={(v: unknown) => (typeof v === "number" ? `${v.toFixed(1)}% YoY` : "")} />
              </Bar>
            )}
            {(mode === "both" || mode === "net") && (
              <Bar dataKey="netCr" name="Net Profit" fill="#0891b2">
                <LabelList dataKey="net_profit_yoy_pct" position="top" formatter={(v: unknown) => (typeof v === "number" ? `${v.toFixed(1)}% YoY` : "")} />
              </Bar>
            )}
            {mode === "eps" && (
              <Bar dataKey="eps" name="EPS" fill="#2563eb">
                <LabelList dataKey="eps_yoy_pct" position="top" formatter={(v: unknown) => (typeof v === "number" ? `${v.toFixed(1)}% YoY` : "")} />
              </Bar>
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
