import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Treemap, ResponsiveContainer, Tooltip } from "recharts";
import { useNavigate } from "react-router-dom";

import { fetchHeatmapIV, fetchHeatmapOI } from "../api/fnoApi";

type Mode = "oi" | "iv" | "volume" | "pcr";

export function HeatmapPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("oi");

  const oiQuery = useQuery({ queryKey: ["fno-heatmap-oi"], queryFn: fetchHeatmapOI, staleTime: 60_000, refetchInterval: 60_000 });
  const ivQuery = useQuery({ queryKey: ["fno-heatmap-iv"], queryFn: fetchHeatmapIV, staleTime: 60_000, refetchInterval: 60_000 });

  const data = useMemo(() => {
    if (mode === "iv") {
      return (ivQuery.data ?? []).map((r) => ({
        name: r.symbol,
        size: Math.max(Math.abs(Number(r.atm_iv || 0)), 0.01),
        value: Number(r.atm_iv || 0),
        color: Number(r.iv_rank || 0) >= 50 ? "#ff4d4f" : "#00c176",
      }));
    }
    return (oiQuery.data ?? []).map((r) => {
      const oi = Number(r.ce_oi_total || 0) + Number(r.pe_oi_total || 0);
      const pcr = Number(r.pcr_oi || 0);
      const proxyVolume = oi;
      const selectedValue = mode === "pcr" ? pcr : mode === "volume" ? proxyVolume : oi;
      return {
        name: r.symbol,
        size: Math.max(Math.abs(selectedValue), 0.01),
        value: selectedValue,
        color: mode === "pcr" ? (pcr >= 1 ? "#00c176" : "#ff4d4f") : Number(r.pe_oi_total || 0) >= Number(r.ce_oi_total || 0) ? "#00c176" : "#ff4d4f",
      };
    });
  }, [mode, ivQuery.data, oiQuery.data]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded border border-terminal-border bg-terminal-panel px-3 py-2 text-xs">
        <span className="uppercase text-terminal-muted">Mode</span>
        {(["oi", "iv", "volume", "pcr"] as const).map((m) => (
          <button key={m} className={`rounded border px-2 py-1 ${mode === m ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`} onClick={() => setMode(m)}>
            {m.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="h-[560px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <Treemap
              data={data}
              dataKey="size"
              stroke="#0c0f14"
              fill="#ff9f1a"
              content={({ root, depth, x, y, width, height, index, payload, colors, rank, name }) => {
                if (!payload || width < 32 || height < 24) return <g />;
                const p = payload as { name: string; value: number; color: string };
                return (
                  <g onClick={() => navigate(`/fno?symbol=${encodeURIComponent(p.name)}`)} style={{ cursor: "pointer" }}>
                    <rect x={x} y={y} width={width} height={height} style={{ fill: p.color, fillOpacity: 0.75, stroke: "#0c0f14", strokeWidth: 1 }} />
                    <text x={x + 6} y={y + 16} fill="#05070b" fontSize={11} fontWeight={700}>{p.name}</text>
                    <text x={x + 6} y={y + 30} fill="#05070b" fontSize={10}>{Number(p.value).toFixed(2)}</text>
                  </g>
                );
              }}
            >
              <Tooltip contentStyle={{ border: "1px solid #2a2f3a", background: "#0c0f14", color: "#d8dde7" }} />
            </Treemap>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
