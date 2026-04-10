import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { hierarchy, treemap, type HierarchyRectangularNode } from "d3-hierarchy";
import { useNavigate } from "react-router-dom";

import {
  fetchMarketHeatmap,
  type HeatmapGroup,
  type HeatmapGroupBy,
  type HeatmapLeaf,
  type HeatmapMarket,
  type HeatmapPeriod,
  type HeatmapSizeBy,
} from "../api/heatmap";
import { TerminalPanel } from "../components/terminal/TerminalPanel";

type TooltipState = {
  x: number;
  y: number;
  item: HeatmapLeaf;
} | null;

type TreemapNode = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  data: HeatmapLeaf;
};

type GroupNode = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  data: HeatmapGroup;
};

type TreemapLayout = {
  groups: GroupNode[];
  leaves: TreemapNode[];
};

const PERIOD_OPTIONS: HeatmapPeriod[] = ["1d", "1w", "1m", "3m", "ytd", "1y"];
const SIZE_OPTIONS: Array<{ value: HeatmapSizeBy; label: string }> = [
  { value: "market_cap", label: "Market Cap" },
  { value: "volume", label: "Volume" },
  { value: "turnover", label: "Turnover" },
];

function formatCompact(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatCurrency(value: number, market: HeatmapMarket): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: market === "IN" ? "INR" : "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function heatColor(changePct: number): string {
  if (changePct <= -5) return "#dc2626";
  if (changePct <= -3) return "#ef4444";
  if (changePct <= -1) return "#f97316";
  if (changePct < 1) return "#6b7280";
  if (changePct < 3) return "#22c55e";
  if (changePct < 5) return "#16a34a";
  return "#15803d";
}

function buildTreemap(groups: HeatmapGroup[], width: number, height: number): TreemapLayout {
  if (!groups.length || width <= 0 || height <= 0) {
    return { groups: [], leaves: [] };
  }
  const root = hierarchy<{ children: HeatmapGroup[] | HeatmapLeaf[] } | HeatmapGroup | HeatmapLeaf>({
    children: groups as unknown as HeatmapGroup[] | HeatmapLeaf[],
  } as { children: HeatmapGroup[] })
    .sum((node) => {
      const candidate = node as Partial<HeatmapLeaf> & Partial<HeatmapGroup>;
      return Number(candidate.value ?? 0);
    })
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  treemap<{ children: HeatmapGroup[] | HeatmapLeaf[] } | HeatmapGroup | HeatmapLeaf>()
    .size([width, height])
    .paddingOuter(3)
    .paddingTop((node) => (node.depth === 1 ? 18 : 1))
    .paddingInner(2)(root);

  const rectangularRoot =
    root as HierarchyRectangularNode<{ children: HeatmapGroup[] | HeatmapLeaf[] } | HeatmapGroup | HeatmapLeaf>;

  return {
    groups: rectangularRoot
      .descendants()
      .filter((node) => node.depth === 1)
      .map((node) => ({
        x0: node.x0,
        y0: node.y0,
        x1: node.x1,
        y1: node.y1,
        data: node.data as HeatmapGroup,
      })),
    leaves: rectangularRoot.leaves().map((node) => ({
      x0: node.x0,
      y0: node.y0,
      x1: node.x1,
      y1: node.y1,
      data: node.data as HeatmapLeaf,
    })),
  };
}

export function MarketHeatmapPage() {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [market, setMarket] = useState<HeatmapMarket>("IN");
  const [period, setPeriod] = useState<HeatmapPeriod>("1d");
  const [group, setGroup] = useState<HeatmapGroupBy>("sector");
  const [sizeBy, setSizeBy] = useState<HeatmapSizeBy>("market_cap");
  const [activeGroupName, setActiveGroupName] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState>(null);
  const [size, setSize] = useState({ width: 960, height: 620 });

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setSize({
        width: Math.max(320, Math.floor(entry.contentRect.width)),
        height: Math.max(420, Math.floor(entry.contentRect.height)),
      });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const query = useQuery({
    queryKey: ["market-heatmap", market, group, period, sizeBy],
    queryFn: () => fetchMarketHeatmap({ market, group, period, sizeBy }),
    staleTime: 300_000,
  });

  useEffect(() => {
    setActiveGroupName(null);
  }, [group, market, period, sizeBy]);

  const activeGroup = useMemo(
    () => (query.data?.groups ?? []).find((entry) => entry.name === activeGroupName) ?? null,
    [activeGroupName, query.data?.groups],
  );
  const visibleGroups = useMemo(() => {
    if (activeGroup) {
      return [
        {
          ...activeGroup,
          value: activeGroup.children.reduce((sum, child) => sum + Number(child.value || 0), 0),
        },
      ];
    }
    return query.data?.groups ?? [];
  }, [activeGroup, query.data?.groups]);
  const layout = useMemo(() => buildTreemap(visibleGroups, size.width, size.height), [visibleGroups, size.height, size.width]);
  const isMobile = size.width < 768;

  return (
    <div className="space-y-4">
      <TerminalPanel
        title="Market Heatmap"
        subtitle="Treemap of the current equity universe sized by cap, volume, or turnover."
        className="min-h-[760px]"
        bodyClassName="space-y-4"
      >
        <div className="flex flex-wrap items-center gap-3 rounded border border-terminal-border bg-terminal-bg/40 px-3 py-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-terminal-muted">Market</span>
            {(["IN", "US"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setMarket(value)}
                className={`rounded border px-2 py-1 ${market === value ? "border-terminal-accent bg-terminal-accent/15 text-terminal-accent" : "border-terminal-border text-terminal-muted hover:text-terminal-text"}`}
              >
                {value}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-terminal-muted">Period</span>
            {PERIOD_OPTIONS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setPeriod(value)}
                data-testid={`heatmap-period-${value}`}
                className={`rounded border px-2 py-1 uppercase ${period === value ? "border-terminal-accent bg-terminal-accent/15 text-terminal-accent" : "border-terminal-border text-terminal-muted hover:text-terminal-text"}`}
              >
                {value}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-terminal-muted">Group</span>
            {(["sector", "industry"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setGroup(value)}
                className={`rounded border px-2 py-1 capitalize ${group === value ? "border-terminal-accent bg-terminal-accent/15 text-terminal-accent" : "border-terminal-border text-terminal-muted hover:text-terminal-text"}`}
              >
                {value}
              </button>
            ))}
          </div>
          <label className="ml-auto flex items-center gap-2 text-terminal-muted">
            <span>Size By</span>
            <select
              value={sizeBy}
              onChange={(event) => setSizeBy(event.target.value as HeatmapSizeBy)}
              className="rounded border border-terminal-border bg-terminal-panel px-2 py-1 text-terminal-text outline-none"
            >
              {SIZE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1fr_240px]">
          <div className="relative min-h-[620px] rounded border border-terminal-border bg-terminal-panel">
            <div className="flex items-center gap-2 border-b border-terminal-border px-3 py-2 text-xs">
              <button
                type="button"
                onClick={() => setActiveGroupName(null)}
                className={`rounded px-2 py-1 ${activeGroupName == null ? "bg-terminal-accent/15 text-terminal-accent" : "text-terminal-muted hover:text-terminal-text"}`}
              >
                All
              </button>
              {activeGroupName ? (
                <>
                  <span className="text-terminal-muted">{">"}</span>
                  <button
                    type="button"
                    onClick={() => setActiveGroupName(activeGroupName)}
                    className="rounded bg-terminal-accent/15 px-2 py-1 text-terminal-accent"
                  >
                    {activeGroupName}
                  </button>
                </>
              ) : (
                <span className="text-terminal-muted">Click a group label to drill down.</span>
              )}
            </div>
            <div ref={containerRef} className="h-[620px] w-full">
              {query.isLoading ? (
                <div className="flex h-full items-center justify-center text-sm text-terminal-muted">Loading heatmap data…</div>
              ) : query.isError ? (
                <div className="flex h-full items-center justify-center px-6 text-center text-sm text-terminal-neg">
                  Failed to load heatmap data.
                </div>
              ) : !layout.leaves.length ? (
                <div className="flex h-full items-center justify-center text-sm text-terminal-muted">No heatmap data available.</div>
              ) : isMobile ? (
                <div className="space-y-2 overflow-auto p-3" data-testid="heatmap-mobile-list">
                  {(activeGroup?.children ?? query.data?.data ?? []).map((item) => (
                    <button
                      key={item.symbol}
                      type="button"
                      className="w-full rounded border border-terminal-border bg-terminal-bg/40 p-3 text-left hover:border-terminal-accent/50"
                      onClick={() => navigate(`/equity/security/${encodeURIComponent(item.symbol)}`)}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-semibold text-terminal-text">{item.symbol}</div>
                          <div className="text-[11px] text-terminal-muted">{item.name}</div>
                        </div>
                        <div className={`text-sm font-semibold ${item.change_pct >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>
                          {item.change_pct >= 0 ? "+" : ""}
                          {item.change_pct.toFixed(2)}%
                        </div>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded bg-terminal-border/20">
                        <div
                          className="h-full rounded"
                          style={{
                            width: `${Math.min(100, Math.max(8, Math.abs(item.change_pct) * 12))}%`,
                            backgroundColor: heatColor(item.change_pct),
                          }}
                        />
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <svg width={size.width} height={size.height} className="block" data-testid="market-heatmap-svg">
                  {layout.groups.map((node) => {
                    const labelWidth = Math.max(0, node.x1 - node.x0);
                    return (
                      <g key={`group-${node.data.name}`} transform={`translate(${node.x0}, ${node.y0})`}>
                        <rect width={labelWidth} height={18} fill="rgba(15,23,42,0.55)" />
                        <text
                          x={6}
                          y={13}
                          fill="#cbd5e1"
                          fontSize={11}
                          fontWeight={700}
                          className={`${activeGroupName ? "" : "cursor-pointer"}`}
                          onClick={() => {
                            if (!activeGroupName) setActiveGroupName(node.data.name);
                          }}
                        >
                          {node.data.name}
                        </text>
                      </g>
                    );
                  })}
                  {layout.leaves.map((node) => {
                    const item = node.data;
                    const rectWidth = Math.max(0, node.x1 - node.x0);
                    const rectHeight = Math.max(0, node.y1 - node.y0);
                    return (
                      <g
                        key={`${item.symbol}-${item.value}`}
                        transform={`translate(${node.x0}, ${node.y0})`}
                        className="cursor-pointer"
                        onClick={() => navigate(`/equity/security/${encodeURIComponent(item.symbol)}`)}
                        onMouseEnter={(event) => {
                          setTooltip({
                            x: event.clientX,
                            y: event.clientY,
                            item,
                          });
                        }}
                        onMouseMove={(event) => {
                          setTooltip((current) => (current ? { ...current, x: event.clientX, y: event.clientY } : current));
                        }}
                        onMouseLeave={() => setTooltip(null)}
                      >
                        <rect width={rectWidth} height={rectHeight} rx={2} fill={heatColor(item.change_pct)} data-testid="heatmap-rect" />
                        {rectWidth > 56 && rectHeight > 28 ? (
                          <text x={8} y={18} fill="#f8fafc" fontSize={12} fontWeight={700}>
                            {item.symbol}
                          </text>
                        ) : null}
                        {rectWidth > 72 && rectHeight > 50 ? (
                          <text x={8} y={34} fill="#e5e7eb" fontSize={11}>
                            {item.change_pct >= 0 ? "+" : ""}
                            {item.change_pct.toFixed(2)}%
                          </text>
                        ) : null}
                        {rectWidth > 120 && rectHeight > 68 ? (
                          <text x={8} y={50} fill="#d1d5db" fontSize={10}>
                            {item.name}
                          </text>
                        ) : null}
                      </g>
                    );
                  })}
                </svg>
              )}
            </div>
            {tooltip ? (
              <div
                className="pointer-events-none fixed z-40 max-w-64 rounded border border-terminal-border bg-terminal-panel px-3 py-2 text-[11px] text-terminal-text shadow-lg"
                style={{ left: tooltip.x + 14, top: tooltip.y + 14 }}
              >
              <div className="font-semibold">{tooltip.item.symbol}</div>
              <div className="text-terminal-muted">{tooltip.item.name}</div>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                  <span className="text-terminal-muted">Sector</span>
                  <span>{tooltip.item.sector}</span>
                  <span className="text-terminal-muted">Industry</span>
                  <span>{tooltip.item.industry}</span>
                  <span className="text-terminal-muted">Price</span>
                  <span>{formatCurrency(tooltip.item.price, market)}</span>
                  <span className="text-terminal-muted">Change</span>
                  <span>{tooltip.item.change_pct >= 0 ? "+" : ""}{tooltip.item.change_pct.toFixed(2)}%</span>
                  <span className="text-terminal-muted">Volume</span>
                  <span>{formatCompact(tooltip.item.volume)}</span>
                  <span className="text-terminal-muted">Mkt Cap</span>
                  <span>{formatCompact(tooltip.item.market_cap)}</span>
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-3">
            <TerminalPanel title="Top Movers" bodyClassName="space-y-2">
              {(query.data?.data ?? []).slice(0, 8).map((item) => (
                <button
                  key={item.symbol}
                  type="button"
                  onClick={() => navigate(`/equity/security/${encodeURIComponent(item.symbol)}`)}
                  className="flex w-full items-center justify-between rounded border border-terminal-border bg-terminal-bg/40 px-3 py-2 text-left text-xs hover:border-terminal-accent/50"
                >
                  <div>
                    <div className="font-semibold text-terminal-text">{item.symbol}</div>
                    <div className="text-[10px] text-terminal-muted">{group === "sector" ? item.sector : item.industry}</div>
                  </div>
                  <div className={`font-semibold ${item.change_pct >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>
                    {item.change_pct >= 0 ? "+" : ""}
                    {item.change_pct.toFixed(2)}%
                  </div>
                </button>
              ))}
            </TerminalPanel>
            <TerminalPanel title="Universe Snapshot" bodyClassName="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-terminal-muted">Constituents</span>
                <span className="text-terminal-text">{query.data?.data.length ?? 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-terminal-muted">Grouping</span>
                <span className="capitalize text-terminal-text">{group}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-terminal-muted">Size Metric</span>
                <span className="text-terminal-text">{SIZE_OPTIONS.find((option) => option.value === sizeBy)?.label}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-terminal-muted">Aggregate Value</span>
                <span className="text-terminal-text">{formatCompact(query.data?.total_value ?? 0)}</span>
              </div>
            </TerminalPanel>
          </div>
        </div>
      </TerminalPanel>
    </div>
  );
}

export default MarketHeatmapPage;
