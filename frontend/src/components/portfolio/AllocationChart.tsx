import { useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

type AllocationSlice = {
  sector: string;
  value: number;
  pct: number;
  pnl?: number;
  pnlPct?: number | null;
};

type Props = {
  data: AllocationSlice[];
};

const BASE_HUES = [210, 285, 28, 175, 252, 46, 325, 192, 112, 8];

function fmtMoney(value: number): string {
  return value.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function hslToHex(h: number, s: number, l: number): string {
  const sNorm = s / 100;
  const lNorm = l / 100;
  const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = lNorm - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function mixHue(base: number, target: number, ratio: number): number {
  return (base * (1 - ratio) + target * ratio + 360) % 360;
}

function toneBySectorPnl(index: number, pnlPct: number | null | undefined) {
  const baseHue = BASE_HUES[index % BASE_HUES.length];
  const hasSignal = pnlPct != null && Number.isFinite(pnlPct);
  const strength = hasSignal ? clamp(Math.abs(Number(pnlPct)) / 20, 0, 1) : 0;
  const signalHue = hasSignal ? (Number(pnlPct) >= 0 ? 145 : 8) : baseHue;
  const hue = mixHue(baseHue, signalHue, 0.35 * strength);
  const sat = 58 + strength * 16;
  const outline = !hasSignal ? "#8e98a8" : Number(pnlPct) >= 0 ? "#00c176" : "#ff4d4f";
  return {
    top: hslToHex(hue, sat + 8, 63),
    mid: hslToHex(hue, sat, 50),
    bottom: hslToHex(hue, sat - 6, 34),
    outline,
  };
}

export function AllocationChart({ data }: Props) {
  const [activeIdx, setActiveIdx] = useState(0);

  const tones = useMemo(() => data.map((row, idx) => toneBySectorPnl(idx, row.pnlPct)), [data]);
  const active = data[activeIdx] ?? null;

  if (!data.length) {
    return <div className="text-xs text-terminal-muted">No sector allocation data available.</div>;
  }

  return (
    <div className="space-y-2">
      <div
        className="h-56 w-full"
        style={{
          transform: "perspective(900px) rotateX(22deg)",
          transformOrigin: "50% 58%",
          filter: "drop-shadow(0 10px 10px rgba(0,0,0,0.35))",
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <defs>
              {data.map((row, idx) => (
                <linearGradient key={`grad-${row.sector}`} id={`sector-grad-${idx}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={tones[idx].top} />
                  <stop offset="55%" stopColor={tones[idx].mid} />
                  <stop offset="100%" stopColor={tones[idx].bottom} />
                </linearGradient>
              ))}
            </defs>
            <Pie
              data={data}
              dataKey="value"
              nameKey="sector"
              cx="50%"
              cy="58%"
              outerRadius={82}
              innerRadius={44}
              stroke="#0c0f14"
              strokeWidth={0}
            >
              {data.map((row, idx) => (
                <Cell key={`depth-${row.sector}`} fill={tones[idx].bottom} fillOpacity={0.55} />
              ))}
            </Pie>
            <Pie
              data={data}
              dataKey="value"
              nameKey="sector"
              cx="50%"
              cy="50%"
              outerRadius={80}
              innerRadius={42}
              stroke="#0c0f14"
              strokeWidth={1.2}
              onMouseEnter={(_, idx) => setActiveIdx(idx)}
              onMouseLeave={() => setActiveIdx(0)}
            >
              {data.map((row, idx) => (
                <Cell
                  key={row.sector}
                  fill={`url(#sector-grad-${idx})`}
                  stroke={idx === activeIdx ? tones[idx].outline : "#0c0f14"}
                  strokeWidth={idx === activeIdx ? 2 : 1}
                />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ border: "1px solid #2a2f3a", background: "#0c0f14", color: "#d8dde7" }}
              formatter={(value: number | string | undefined, name: string | undefined, item) => {
                const payload = (item?.payload ?? {}) as AllocationSlice;
                if (name === "value") {
                  const pnlText =
                    payload.pnlPct == null ? "NA" : `${payload.pnlPct >= 0 ? "+" : ""}${payload.pnlPct.toFixed(2)}%`;
                  return [`${fmtMoney(Number(value ?? 0))} | P&L ${pnlText}`, payload.sector || "Sector"];
                }
                return [`${fmtMoney(Number(value ?? 0))}`, name ?? "Sector"];
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      {active && (
        <div className="rounded border border-terminal-border/50 bg-terminal-bg px-2 py-1 text-[11px]">
          <span className="text-terminal-muted">Focus:</span>{" "}
          <span className="text-terminal-text">{active.sector}</span>{" "}
          <span className={active.pnlPct != null && active.pnlPct >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>
            ({active.pnlPct == null ? "NA" : `${active.pnlPct >= 0 ? "+" : ""}${active.pnlPct.toFixed(2)}%`})
          </span>
        </div>
      )}
      <div className="max-h-40 overflow-auto rounded border border-terminal-border/50 bg-terminal-bg p-2 text-[11px]">
        {data.map((row, idx) => (
          <div key={row.sector} className="flex items-center justify-between py-0.5">
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: `linear-gradient(180deg, ${tones[idx].top} 0%, ${tones[idx].bottom} 100%)` }}
              />
              <span
                className={`${
                  idx === activeIdx ? "font-semibold" : ""
                }`}
                style={{ color: idx === activeIdx ? tones[idx].top : undefined }}
              >
                {row.sector}
              </span>
            </div>
            <div className={idx === activeIdx ? "font-semibold" : "text-terminal-muted"}>
              {row.pct.toFixed(1)}% | {fmtMoney(row.value)} |{" "}
              <span className={row.pnlPct != null && row.pnlPct >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>
                {row.pnlPct == null ? "NA" : `${row.pnlPct >= 0 ? "+" : ""}${row.pnlPct.toFixed(2)}%`}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
