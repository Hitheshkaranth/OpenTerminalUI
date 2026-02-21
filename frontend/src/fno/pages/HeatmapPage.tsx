import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { fetchHeatmapIV, fetchHeatmapOI } from "../api/fnoApi";

type Mode = "oi" | "iv" | "volume" | "pcr";

type HeatCell = {
  name: string;
  size: number;
  value: number;
  color: string;
  extra: string;
};

const getPcrColor = (pcr: number) => {
  if (pcr >= 1.5) return "#00e676";
  if (pcr >= 1.0) return "#00c176";
  if (pcr >= 0.7) return "#ff8a80";
  return "#ff1744";
};

const getIvColor = (rank: number) => {
  if (rank >= 75) return "#ff1744";
  if (rank >= 50) return "#ff8a80";
  if (rank >= 25) return "#00c176";
  return "#00e676";
};

const getOiColor = (pe: number, ce: number) => {
  const ratio = (pe + 1) / (ce + 1);
  if (ratio >= 1.5) return "#00e676";
  if (ratio >= 1.0) return "#00c176";
  if (ratio >= 0.7) return "#ff8a80";
  return "#ff1744";
};

/** Simple CSS-grid treemap approximation — avoids Recharts Treemap internals crash */
function HeatGrid({ cells, onCellClick }: { cells: HeatCell[]; onCellClick: (name: string) => void }) {
  if (!cells.length) return null;
  const maxSize = Math.max(...cells.map((c) => c.size), 1);
  return (
    <div className="flex flex-wrap gap-1 h-full w-full overflow-hidden p-1">
      {cells.map((cell) => {
        const pctOfMax = cell.size / maxSize;
        // Minimum 60px, scale up to ~300px based on relative size
        const side = Math.max(60, Math.round(60 + pctOfMax * 240));
        return (
          <div
            key={cell.name}
            className="flex flex-col items-start justify-start rounded cursor-pointer overflow-hidden flex-shrink-0 select-none transition-opacity hover:opacity-80"
            style={{
              background: cell.color,
              width: `${side}px`,
              height: `${Math.round(side * 0.65)}px`,
              padding: "6px 8px",
              minWidth: 60,
              minHeight: 40,
            }}
            title={`${cell.name}\n${cell.extra}`}
            onClick={() => onCellClick(cell.name)}
          >
            <span className="font-bold text-[#05070b] leading-tight" style={{ fontSize: Math.max(10, Math.min(14, side / 7)) }}>
              {cell.name}
            </span>
            <span className="text-[#05070b] opacity-80 leading-tight" style={{ fontSize: Math.max(9, Math.min(12, side / 8)) }}>
              {Number(cell.value).toFixed(2)}
            </span>
            {side > 100 && (
              <span className="text-[#05070b] opacity-60 mt-0.5 leading-tight" style={{ fontSize: 9 }}>
                {cell.extra}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function HeatmapPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("oi");

  const oiQuery = useQuery({ queryKey: ["fno-heatmap-oi"], queryFn: fetchHeatmapOI, staleTime: 60_000, refetchInterval: 60_000 });
  const ivQuery = useQuery({ queryKey: ["fno-heatmap-iv"], queryFn: fetchHeatmapIV, staleTime: 60_000, refetchInterval: 60_000 });

  const data = useMemo((): HeatCell[] => {
    if (mode === "iv") {
      return (ivQuery.data ?? []).map((r) => ({
        name: r.symbol,
        size: Math.max(Math.abs(Number(r.atm_iv || 0)), 0.01),
        value: Number(r.atm_iv || 0),
        color: getIvColor(Number(r.iv_rank || 0)),
        extra: `IV Rank: ${Number(r.iv_rank || 0).toFixed(1)}`,
      }));
    }
    return (oiQuery.data ?? []).map((r) => {
      const peOpts = Number(r.pe_oi_total || 0);
      const ceOpts = Number(r.ce_oi_total || 0);
      const oi = ceOpts + peOpts;
      const pcr = Number(r.pcr_oi || 0);
      const proxyVolume = oi;
      const selectedValue = mode === "pcr" ? pcr : mode === "volume" ? proxyVolume : oi;
      return {
        name: r.symbol,
        size: Math.max(Math.abs(selectedValue), 0.01),
        value: selectedValue,
        color: mode === "pcr" ? getPcrColor(pcr) : getOiColor(peOpts, ceOpts),
        extra: `PCR: ${pcr.toFixed(2)} | CE: ${ceOpts.toLocaleString()} | PE: ${peOpts.toLocaleString()}`,
      };
    });
  }, [mode, ivQuery.data, oiQuery.data]);

  const isLoading = (mode === "iv" ? ivQuery : oiQuery).isLoading;
  const isError = (mode === "iv" ? ivQuery : oiQuery).isError;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded border border-terminal-border bg-terminal-panel px-3 py-2 text-xs">
        <span className="uppercase text-terminal-muted">Mode</span>
        {(["oi", "iv", "volume", "pcr"] as const).map((m) => (
          <button
            key={m}
            className={`rounded border px-2 py-1 ${mode === m ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`}
            onClick={() => setMode(m)}
          >
            {m.toUpperCase()}
          </button>
        ))}
        <span className="ml-auto text-terminal-muted">Click a tile to view option chain</span>
      </div>

      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="h-[560px] w-full">
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-terminal-muted text-sm animate-pulse">
              Loading heatmap data…
            </div>
          ) : isError ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-terminal-neg text-sm">
              <span className="text-2xl">⚠</span>
              <span>Failed to load heatmap data.</span>
              <span className="text-xs text-terminal-muted">Ensure the F&amp;O data feed is connected (Kite API key required).</span>
            </div>
          ) : data.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-terminal-muted text-sm">
              <span className="text-3xl">📊</span>
              <span>No heatmap data available.</span>
              <span className="text-xs">Connect a live Kite API key to stream F&amp;O open interest data.</span>
            </div>
          ) : (
            <HeatGrid cells={data} onCellClick={(name) => navigate(`/fno?symbol=${encodeURIComponent(name)}`)} />
          )}
        </div>
      </div>
    </div>
  );
}
