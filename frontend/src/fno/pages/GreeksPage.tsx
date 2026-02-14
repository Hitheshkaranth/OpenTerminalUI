import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { fetchGreeks } from "../api/fnoApi";
import { GreeksHeatmap } from "../components/GreeksHeatmap";
import { useFnoContext } from "../FnoLayout";

export function GreeksPage() {
  const { symbol, expiry } = useFnoContext();
  const [side, setSide] = useState<"CE" | "PE">("CE");

  const query = useQuery({
    queryKey: ["fno-greeks", symbol, expiry],
    queryFn: () => fetchGreeks(symbol, expiry || undefined, 30),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const chartData = useMemo(() => {
    const rows = query.data?.strikes ?? [];
    const spot = Number(query.data?.spot_price || 0);
    return rows.map((row) => {
      const leg = side === "CE" ? row.ce : row.pe;
      const g = leg?.greeks;
      const oi = Number(leg?.oi || 0);
      const delta = Number(g?.delta || 0);
      const gamma = Number(g?.gamma || 0);
      const deltaExp = delta * oi * spot * 0.01;
      const gex = gamma * oi * spot * spot * 0.01;
      return {
        strike: Number(row.strike_price),
        deltaExp,
        gex,
      };
    });
  }, [query.data?.strikes, query.data?.spot_price, side]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded border border-terminal-border bg-terminal-panel px-3 py-2 text-xs">
        <span className="uppercase text-terminal-muted">Leg</span>
        {(["CE", "PE"] as const).map((item) => (
          <button
            key={item}
            className={`rounded border px-2 py-1 ${side === item ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`}
            onClick={() => setSide(item)}
          >
            {item}
          </button>
        ))}
      </div>

      {query.isLoading && <div className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs text-terminal-muted">Loading greeks...</div>}
      {query.isError && <div className="rounded border border-terminal-neg bg-terminal-neg/10 p-3 text-xs text-terminal-neg">Failed to load greeks</div>}

      {!query.isLoading && !query.isError && (
        <>
          <GreeksHeatmap rows={query.data?.strikes ?? []} side={side} />

          <div className="rounded border border-terminal-border bg-terminal-panel p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-terminal-accent">Delta Exposure</h3>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#2a2f3a" />
                  <XAxis dataKey="strike" tick={{ fill: "#8e98a8", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#8e98a8", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ border: "1px solid #2a2f3a", background: "#0c0f14", color: "#d8dde7" }} />
                  <Bar dataKey="deltaExp" fill="#ff9f1a" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded border border-terminal-border bg-terminal-panel p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-terminal-accent">Gamma Exposure (GEX)</h3>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#2a2f3a" />
                  <XAxis dataKey="strike" tick={{ fill: "#8e98a8", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#8e98a8", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ border: "1px solid #2a2f3a", background: "#0c0f14", color: "#d8dde7" }} />
                  <Bar dataKey="gex" fill="#00c176" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
