import { useMemo, useRef, useEffect, useState } from "react";
import * as d3 from "d3-hierarchy";
import { reviewInstrument } from "./reviewInstrument";
import { useNavigate } from "react-router-dom";
import { TerminalTooltip } from "../terminal/TerminalTooltip";

type HeatmapData = {
  ticker: string;
  name?: string;
  changePct: number | null;
  value: number; // Market cap or weight
  price: number | null;
  market?: string;
};

type Props = {
  data: HeatmapData[];
  width: number;
  height: number;
  sizeBy: "marketCap" | "equal";
};

export function HeatmapView({ data, width, height, sizeBy }: Props) {
  const navigate = useNavigate();
  const svgRef = useRef<SVGSVGElement>(null);

  const getColor = (change: number | null) => {
    if (change == null || !Number.isFinite(change)) return "#303945";
    if (change <= -5) return "#991b1b"; // Deep red
    if (change <= -2) return "#ef4444"; // Light red
    if (change >= 5) return "#166534";  // Deep green
    if (change >= 2) return "#22c55e";  // Light green
    return "#4b5563"; // Gray
  };

  const treemapData = useMemo(() => {
    const root = d3.hierarchy({ children: data })
      .sum(d => (d as any).value || 1)
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    d3.treemap()
      .size([width, height])
      .padding(1)
      (root as any);

    return root.leaves();
  }, [data, width, height, sizeBy]);

  return (
    <div className="relative overflow-hidden" style={{ width, height }}>
      <svg width={width} height={height} className="block">
        {treemapData.map((d: any, i) => {
          const item = d.data as HeatmapData;
          const rectWidth = d.x1 - d.x0;
          const rectHeight = d.y1 - d.y0;
          const color = getColor(item.changePct);

          return (
            <g
              key={item.ticker}
              transform={`translate(${d.x0},${d.y0})`}
              className="cursor-pointer group"
              onClick={() => navigate(reviewInstrument(item.ticker, item.market || "NSE").primaryPath)}
            >
              <rect
                width={Math.max(0, rectWidth)}
                height={Math.max(0, rectHeight)}
                fill={color}
                className="transition-opacity hover:opacity-80"
              />
              {rectWidth > 30 && rectHeight > 20 && (
                <text
                  x={rectWidth / 2}
                  y={rectHeight / 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="white"
                  className="pointer-events-none select-none text-[10px] font-bold"
                >
                  {item.ticker}
                </text>
              )}
              {rectWidth > 40 && rectHeight > 35 && (
                <text
                  x={rectWidth / 2}
                  y={rectHeight / 2 + 12}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="white"
                  fillOpacity={0.8}
                  className="pointer-events-none select-none text-[8px]"
                >
                  {item.changePct == null ? "Unavailable" : `${item.changePct >= 0 ? "+" : ""}${item.changePct.toFixed(2)}%`}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
