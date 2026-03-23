import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { SparklineCell } from "../components/home/SparklineCell";
import { TerminalBadge } from "../components/terminal/TerminalBadge";
import { TerminalPanel } from "../components/terminal/TerminalPanel";

type CommodityCategoryId = "energy" | "metals" | "agriculture";

type CommodityRow = {
  symbol: string;
  name: string;
  category: CommodityCategoryId;
  price: number;
  change: number;
  change_pct: number;
  volume: number;
  sparkline: number[];
};

type CommodityCategory = {
  id: CommodityCategoryId;
  label: string;
  items: CommodityRow[];
};

type FuturesCurvePoint = {
  contract: string;
  expiry: string;
  price: number;
  change_pct?: number;
};

type SeasonalPoint = {
  month: string;
  average_return_pct: number;
  average_price?: number;
};

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "") || "/api";
const CATEGORY_ORDER: CommodityCategoryId[] = ["energy", "metals", "agriculture"];
const CATEGORY_LABELS: Record<CommodityCategoryId, string> = {
  energy: "Energy",
  metals: "Metals",
  agriculture: "Agriculture",
};
const SYMBOL_ALIASES: Record<string, string> = {
  GOLD: "GC=F",
  SILVER: "SI=F",
  COPPER: "HG=F",
  OIL: "CL=F",
  CRUDE: "CL=F",
  GAS: "NG=F",
  NATGAS: "NG=F",
  CORN: "ZC=F",
  SOYBEAN: "ZS=F",
  SOYBEANS: "ZS=F",
  WHEAT: "ZW=F",
  COFFEE: "KC=F",
};

const FALLBACK_CATEGORIES: CommodityCategory[] = [
  {
    id: "energy",
    label: "Energy",
    items: [
      { symbol: "CL=F", name: "WTI Crude", category: "energy", price: 82.46, change: 1.18, change_pct: 1.45, volume: 382410, sparkline: [79.8, 80.4, 80.9, 81.2, 81.7, 82.1, 82.46] },
      { symbol: "NG=F", name: "Natural Gas", category: "energy", price: 2.74, change: -0.03, change_pct: -1.08, volume: 214503, sparkline: [2.81, 2.84, 2.8, 2.79, 2.77, 2.76, 2.74] },
      { symbol: "RB=F", name: "RBOB Gasoline", category: "energy", price: 2.61, change: 0.02, change_pct: 0.83, volume: 42103, sparkline: [2.52, 2.54, 2.55, 2.56, 2.57, 2.59, 2.61] },
      { symbol: "HO=F", name: "Heating Oil", category: "energy", price: 2.93, change: 0.04, change_pct: 1.39, volume: 28418, sparkline: [2.82, 2.84, 2.86, 2.88, 2.89, 2.91, 2.93] },
    ],
  },
  {
    id: "metals",
    label: "Metals",
    items: [
      { symbol: "GC=F", name: "Gold", category: "metals", price: 2187.5, change: 18.4, change_pct: 0.85, volume: 198240, sparkline: [2140, 2148, 2156, 2162, 2170, 2179, 2187.5] },
      { symbol: "SI=F", name: "Silver", category: "metals", price: 24.82, change: 0.31, change_pct: 1.26, volume: 130875, sparkline: [24.1, 24.18, 24.32, 24.36, 24.48, 24.63, 24.82] },
      { symbol: "HG=F", name: "Copper", category: "metals", price: 4.08, change: -0.02, change_pct: -0.49, volume: 77402, sparkline: [4.16, 4.15, 4.14, 4.12, 4.11, 4.1, 4.08] },
      { symbol: "PL=F", name: "Platinum", category: "metals", price: 919.3, change: 6.7, change_pct: 0.73, volume: 16382, sparkline: [902, 905, 908, 910, 913, 916, 919.3] },
    ],
  },
  {
    id: "agriculture",
    label: "Agriculture",
    items: [
      { symbol: "ZC=F", name: "Corn", category: "agriculture", price: 448.75, change: 5.25, change_pct: 1.18, volume: 162403, sparkline: [438, 439.5, 441.2, 442.6, 444.1, 446.4, 448.75] },
      { symbol: "ZS=F", name: "Soybeans", category: "agriculture", price: 1178.5, change: -8.25, change_pct: -0.7, volume: 110282, sparkline: [1199, 1195, 1192, 1188, 1186, 1181, 1178.5] },
      { symbol: "ZW=F", name: "Wheat", category: "agriculture", price: 571.25, change: 3.0, change_pct: 0.53, volume: 93842, sparkline: [562, 564, 565, 567, 568, 569.8, 571.25] },
      { symbol: "KC=F", name: "Coffee", category: "agriculture", price: 187.15, change: 2.1, change_pct: 1.13, volume: 27654, sparkline: [180.5, 181.8, 183.2, 184.7, 185.9, 186.4, 187.15] },
    ],
  },
];

function normalizeSymbol(input: string | null): string {
  const value = String(input || "").trim().toUpperCase();
  return SYMBOL_ALIASES[value] || value;
}

async function requestJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path.startsWith("/") ? path : `/${path}`}`);
  const raw = await response.text();
  const payload = raw ? JSON.parse(raw) : null;
  if (!response.ok) {
    throw new Error((payload && typeof payload.detail === "string" && payload.detail) || response.statusText || "Request failed");
  }
  return payload as T;
}

function toCategoryId(value: unknown): CommodityCategoryId {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "metals" || normalized === "agriculture") return normalized;
  return "energy";
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function normalizeCommodityRow(value: unknown, categoryHint?: CommodityCategoryId): CommodityRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const symbol = normalizeSymbol(String(row.symbol || row.ticker || row.code || ""));
  if (!symbol) return null;
  return {
    symbol,
    name: String(row.name || row.label || symbol),
    category: categoryHint || toCategoryId(row.category),
    price: toFiniteNumber(row.price ?? row.last),
    change: toFiniteNumber(row.change),
    change_pct: toFiniteNumber(row.change_pct ?? row.changePct ?? row.change_percent),
    volume: toFiniteNumber(row.volume),
    sparkline: Array.isArray(row.sparkline)
      ? row.sparkline.map((point) => toFiniteNumber(point)).filter((point) => Number.isFinite(point))
      : [],
  };
}

function normalizeCategories(payload: unknown): CommodityCategory[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return FALLBACK_CATEGORIES;
  }
  const raw = payload as Record<string, unknown>;
  const fromCategories = Array.isArray(raw.categories)
    ? raw.categories.map((entry) => {
        const category = entry as Record<string, unknown>;
        const id = toCategoryId(category.id || category.category || category.label);
        const items = Array.isArray(category.items)
          ? category.items.map((item) => normalizeCommodityRow(item, id)).filter((item): item is CommodityRow => item !== null)
          : [];
        return {
          id,
          label: String(category.label || CATEGORY_LABELS[id]),
          items,
        };
      })
    : [];
  if (fromCategories.some((category) => category.items.length > 0)) {
    return CATEGORY_ORDER.map((id) => fromCategories.find((category) => category.id === id) || { id, label: CATEGORY_LABELS[id], items: [] });
  }
  if (Array.isArray(raw.items)) {
    const grouped = new Map<CommodityCategoryId, CommodityRow[]>();
    raw.items.forEach((item) => {
      const normalized = normalizeCommodityRow(item);
      if (!normalized) return;
      const rows = grouped.get(normalized.category) || [];
      rows.push(normalized);
      grouped.set(normalized.category, rows);
    });
    if (grouped.size) {
      return CATEGORY_ORDER.map((id) => ({ id, label: CATEGORY_LABELS[id], items: grouped.get(id) || [] }));
    }
  }
  return FALLBACK_CATEGORIES;
}

function buildFallbackCurve(symbol: string): FuturesCurvePoint[] {
  const row =
    FALLBACK_CATEGORIES.flatMap((category) => category.items).find((item) => item.symbol === symbol) ||
    FALLBACK_CATEGORIES[0].items[0];
  const base = row?.price || 100;
  return ["Front", "M+1", "M+2", "M+3", "M+6", "M+12"].map((contract, index) => ({
    contract,
    expiry: `2026-${String(index + 4).padStart(2, "0")}-15`,
    price: Number((base + index * (base > 100 ? 4.6 : 0.08) - (index > 3 ? 1.4 : 0)).toFixed(2)),
    change_pct: Number(((index - 1.5) * 0.28).toFixed(2)),
  }));
}

function normalizeCurve(payload: unknown, symbol: string): FuturesCurvePoint[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return buildFallbackCurve(symbol);
  const raw = payload as Record<string, unknown>;
  const points = Array.isArray(raw.points)
    ? raw.points
    : Array.isArray(raw.items)
      ? raw.items
      : Array.isArray(raw.contracts)
        ? raw.contracts
        : [];
  const normalized = points
    .map((point) => {
      if (!point || typeof point !== "object" || Array.isArray(point)) return null;
      const row = point as Record<string, unknown>;
      const contract = String(row.contract || row.label || row.month || row.expiry || "");
      if (!contract) return null;
      const normalizedPoint: FuturesCurvePoint = {
        contract,
        expiry: String(row.expiry || row.contract || ""),
        price: toFiniteNumber(row.price ?? row.last),
      };
      if (row.change_pct != null || row.changePct != null) {
        normalizedPoint.change_pct = toFiniteNumber(row.change_pct ?? row.changePct);
      }
      return normalizedPoint;
    })
    .filter((point): point is FuturesCurvePoint => point !== null);
  return normalized.length ? normalized : buildFallbackCurve(symbol);
}

function buildFallbackSeasonal(symbol: string): SeasonalPoint[] {
  const base = symbol === "NG=F" ? -0.6 : symbol === "GC=F" ? 0.45 : 0.25;
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((month, index) => ({
    month,
    average_return_pct: Number((base + Math.sin(index / 1.7) * 1.8 + (index > 7 ? -0.35 : 0.2)).toFixed(2)),
    average_price: Number((100 + index * 2.4 + Math.cos(index / 2.1) * 5.2).toFixed(2)),
  }));
}

function normalizeSeasonal(payload: unknown, symbol: string): { years: number; monthly: SeasonalPoint[] } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { years: 7, monthly: buildFallbackSeasonal(symbol) };
  }
  const raw = payload as Record<string, unknown>;
  const monthly = Array.isArray(raw.monthly)
    ? raw.monthly
        .map((point) => {
          if (!point || typeof point !== "object" || Array.isArray(point)) return null;
          const row = point as Record<string, unknown>;
          const month = String(row.month || row.label || "");
          if (!month) return null;
          const normalizedPoint: SeasonalPoint = {
            month,
            average_return_pct: toFiniteNumber(row.average_return_pct ?? row.averageReturnPct ?? row.return_pct),
          };
          if (row.average_price != null || row.averagePrice != null) {
            normalizedPoint.average_price = toFiniteNumber(row.average_price ?? row.averagePrice);
          }
          return normalizedPoint;
        })
        .filter((point): point is SeasonalPoint => point !== null)
    : [];
  return {
    years: Math.max(5, Math.trunc(toFiniteNumber(raw.years, 7))),
    monthly: monthly.length ? monthly : buildFallbackSeasonal(symbol),
  };
}

function readTooltipNumber(value: number | string | readonly (number | string)[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "number" ? raw : Number(raw);
}

function formatChartTooltipValue(value: number | string | readonly (number | string)[] | undefined, label: string): [string, string] {
  const numeric = readTooltipNumber(value);
  const text = Number.isFinite(numeric)
    ? numeric.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : "--";
  return [text, label];
}

function formatPercentTooltipValue(value: number | string | readonly (number | string)[] | undefined, label: string): [string, string] {
  const numeric = readTooltipNumber(value);
  const text = Number.isFinite(numeric) ? `${numeric.toFixed(2)}%` : "--";
  return [text, label];
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: value >= 1000 ? 1 : 2 }).format(value);
}

function formatSignedPercent(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function CommoditiesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [categories, setCategories] = useState<CommodityCategory[]>(FALLBACK_CATEGORIES);
  const [quotesLoading, setQuotesLoading] = useState(true);
  const [quotesFallback, setQuotesFallback] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsFallback, setDetailsFallback] = useState(false);
  const [curvePoints, setCurvePoints] = useState<FuturesCurvePoint[]>(buildFallbackCurve("CL=F"));
  const [seasonalData, setSeasonalData] = useState<{ years: number; monthly: SeasonalPoint[] }>({
    years: 7,
    monthly: buildFallbackSeasonal("CL=F"),
  });
  const requestedSymbol = normalizeSymbol(searchParams.get("symbol") || searchParams.get("ticker"));
  const [activeTab, setActiveTab] = useState<CommodityCategoryId>("energy");
  const [selectedSymbol, setSelectedSymbol] = useState<string>(requestedSymbol || "CL=F");

  useEffect(() => {
    let cancelled = false;
    setQuotesLoading(true);
    void (async () => {
      try {
        const payload = await requestJson<unknown>("/commodities/quotes");
        if (cancelled) return;
        const normalized = normalizeCategories(payload);
        setCategories(normalized);
        setQuotesFallback(false);
      } catch {
        if (cancelled) return;
        setCategories(FALLBACK_CATEGORIES);
        setQuotesFallback(true);
      } finally {
        if (!cancelled) {
          setQuotesLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const allItems = useMemo(() => categories.flatMap((category) => category.items), [categories]);
  const activeCategory = useMemo(
    () => categories.find((category) => category.id === activeTab) || categories[0] || FALLBACK_CATEGORIES[0],
    [activeTab, categories],
  );
  const selectedCommodity = useMemo(
    () => allItems.find((item) => item.symbol === selectedSymbol) || activeCategory.items[0] || FALLBACK_CATEGORIES[0].items[0],
    [activeCategory.items, allItems, selectedSymbol],
  );

  useEffect(() => {
    if (!requestedSymbol) return;
    const match = categories.find((category) => category.items.some((item) => item.symbol === requestedSymbol));
    if (match) {
      setActiveTab(match.id);
      setSelectedSymbol(requestedSymbol);
      return;
    }
    setSelectedSymbol(requestedSymbol);
  }, [categories, requestedSymbol]);

  useEffect(() => {
    if (!selectedCommodity) return;
    const match = categories.find((category) => category.items.some((item) => item.symbol === selectedCommodity.symbol));
    if (match && match.id !== activeTab) {
      setActiveTab(match.id);
    }
  }, [activeTab, categories, selectedCommodity]);

  useEffect(() => {
    if (!activeCategory.items.length) return;
    const inTab = activeCategory.items.some((item) => item.symbol === selectedSymbol);
    if (!inTab) {
      setSelectedSymbol(activeCategory.items[0].symbol);
    }
  }, [activeCategory.items, selectedSymbol]);

  useEffect(() => {
    if (!selectedCommodity) return;
    const next = new URLSearchParams(searchParams);
    if (next.get("symbol") !== selectedCommodity.symbol) {
      next.set("symbol", selectedCommodity.symbol);
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, selectedCommodity, setSearchParams]);

  useEffect(() => {
    if (!selectedCommodity?.symbol) return;
    let cancelled = false;
    setDetailsLoading(true);
    void (async () => {
      const [curveResult, seasonalResult] = await Promise.allSettled([
        requestJson<unknown>(`/commodities/futures-chain/${encodeURIComponent(selectedCommodity.symbol)}`),
        requestJson<unknown>(`/commodities/seasonal/${encodeURIComponent(selectedCommodity.symbol)}`),
      ]);
      if (cancelled) return;
      const curveOk = curveResult.status === "fulfilled";
      const seasonalOk = seasonalResult.status === "fulfilled";
      setCurvePoints(curveOk ? normalizeCurve(curveResult.value, selectedCommodity.symbol) : buildFallbackCurve(selectedCommodity.symbol));
      setSeasonalData(
        seasonalOk
          ? normalizeSeasonal(seasonalResult.value, selectedCommodity.symbol)
          : { years: 7, monthly: buildFallbackSeasonal(selectedCommodity.symbol) },
      );
      setDetailsFallback(!(curveOk && seasonalOk));
      setDetailsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCommodity?.symbol]);

  return (
    <div className="space-y-4 px-3 py-3">
      <TerminalPanel
        title="Commodities Terminal"
        subtitle="Energy, metals, and agriculture futures with curve and seasonality context"
        actions={
          <div className="flex items-center gap-2">
            <TerminalBadge variant={quotesFallback || detailsFallback ? "warn" : "live"} dot>
              {quotesFallback || detailsFallback ? "Seeded fallback" : "Backend live"}
            </TerminalBadge>
            <TerminalBadge variant="accent">CMDTY</TerminalBadge>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {CATEGORY_ORDER.map((categoryId) => {
              const isActive = activeTab === categoryId;
              return (
                <button
                  key={categoryId}
                  type="button"
                  className={`rounded border px-3 py-1.5 text-xs uppercase tracking-[0.16em] ${
                    isActive
                      ? "border-terminal-accent bg-terminal-accent/15 text-terminal-accent"
                      : "border-terminal-border text-terminal-muted hover:text-terminal-text"
                  }`}
                  onClick={() => setActiveTab(categoryId)}
                >
                  {CATEGORY_LABELS[categoryId]}
                </button>
              );
            })}
            <div className="ml-auto flex items-center gap-2 text-[11px] text-terminal-muted">
              <span>Command aliases:</span>
              <span className="rounded border border-terminal-border px-2 py-0.5">COMMODITY</span>
              <span className="rounded border border-terminal-border px-2 py-0.5">GOLD</span>
              <span className="rounded border border-terminal-border px-2 py-0.5">OIL</span>
            </div>
          </div>
          {(quotesFallback || detailsFallback) ? (
            <div className="rounded border border-terminal-warn/40 bg-terminal-warn/10 px-3 py-2 text-xs text-terminal-warn">
              Commodities backend routes can render seeded fixtures until router registration is wired into the main backend app.
            </div>
          ) : null}
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
            <div className="rounded border border-terminal-border bg-terminal-panel/50">
              <div className="flex items-center justify-between border-b border-terminal-border px-3 py-2">
                <div>
                  <div className="text-xs uppercase tracking-[0.16em] text-terminal-muted">{activeCategory.label}</div>
                  <div className="mt-1 text-[11px] text-terminal-muted">
                    Spot watchlist with mini trend, daily move, and liquidity
                  </div>
                </div>
                {quotesLoading ? <TerminalBadge variant="info" dot>Refreshing</TerminalBadge> : null}
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead className="bg-terminal-bg/40 text-[10px] uppercase tracking-[0.16em] text-terminal-muted">
                    <tr>
                      <th className="px-3 py-2 text-left">Contract</th>
                      <th className="px-3 py-2 text-right">Last</th>
                      <th className="px-3 py-2 text-right">Chg</th>
                      <th className="px-3 py-2 text-right">Chg%</th>
                      <th className="px-3 py-2 text-right">Volume</th>
                      <th className="px-3 py-2 text-left">Trend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeCategory.items.map((item) => {
                      const selected = item.symbol === selectedCommodity?.symbol;
                      return (
                        <tr
                          key={item.symbol}
                          className={`cursor-pointer border-t border-terminal-border/70 ${
                            selected ? "bg-terminal-accent/10" : "hover:bg-terminal-bg/40"
                          }`}
                          onClick={() => setSelectedSymbol(item.symbol)}
                        >
                          <td className="px-3 py-2">
                            <div className="font-medium text-terminal-text">{item.symbol}</div>
                            <div className="text-[11px] text-terminal-muted">{item.name}</div>
                          </td>
                          <td className="px-3 py-2 text-right ot-type-data text-terminal-text">{item.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                          <td className={`px-3 py-2 text-right ot-type-data ${item.change >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>
                            {item.change >= 0 ? "+" : ""}{item.change.toFixed(2)}
                          </td>
                          <td className={`px-3 py-2 text-right ot-type-data ${item.change_pct >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>
                            {formatSignedPercent(item.change_pct)}
                          </td>
                          <td className="px-3 py-2 text-right ot-type-data text-terminal-muted">{formatCompactNumber(item.volume)}</td>
                          <td className="px-3 py-2">
                            <SparklineCell
                              points={item.sparkline}
                              width={120}
                              height={30}
                              ariaLabel={`${item.symbol} sparkline`}
                              className="min-w-[120px]"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid gap-4">
              <TerminalPanel
                title={selectedCommodity ? `${selectedCommodity.name} Snapshot` : "Contract Snapshot"}
                subtitle={selectedCommodity?.symbol || "Select a commodity"}
                actions={
                  selectedCommodity ? (
                    <Link
                      to={`/equity/security/${encodeURIComponent(selectedCommodity.symbol)}?tab=overview`}
                      className="rounded border border-terminal-border px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-terminal-muted hover:text-terminal-text"
                    >
                      Open Security
                    </Link>
                  ) : null
                }
              >
                {selectedCommodity ? (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded border border-terminal-border bg-terminal-bg/40 px-3 py-2">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-terminal-muted">Last</div>
                      <div className="mt-1 ot-type-data text-lg text-terminal-text">
                        {selectedCommodity.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                      </div>
                    </div>
                    <div className="rounded border border-terminal-border bg-terminal-bg/40 px-3 py-2">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-terminal-muted">Daily Move</div>
                      <div className={`mt-1 ot-type-data text-lg ${selectedCommodity.change_pct >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>
                        {formatSignedPercent(selectedCommodity.change_pct)}
                      </div>
                    </div>
                    <div className="rounded border border-terminal-border bg-terminal-bg/40 px-3 py-2">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-terminal-muted">Volume</div>
                      <div className="mt-1 ot-type-data text-lg text-terminal-text">{formatCompactNumber(selectedCommodity.volume)}</div>
                    </div>
                  </div>
                ) : null}
              </TerminalPanel>

              <TerminalPanel
                title="Term Structure"
                subtitle={selectedCommodity ? `${selectedCommodity.symbol} futures curve` : "Select a contract"}
                actions={detailsLoading ? <TerminalBadge variant="info" dot>Updating</TerminalBadge> : null}
                bodyClassName="h-[260px]"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={curvePoints} margin={{ top: 12, right: 18, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                    <XAxis dataKey="contract" stroke="#94A3B8" tickLine={false} axisLine={false} fontSize={10} />
                    <YAxis stroke="#94A3B8" tickLine={false} axisLine={false} fontSize={10} domain={["dataMin - 2", "dataMax + 2"]} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155", fontSize: "11px" }}
                      formatter={(value) => formatChartTooltipValue(value, "Price")}
                    />
                    <Line type="monotone" dataKey="price" stroke="var(--ot-color-accent-primary)" strokeWidth={2.2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </TerminalPanel>
            </div>
          </div>
        </div>
      </TerminalPanel>

      <TerminalPanel
        title="Seasonality"
        subtitle={selectedCommodity ? `${selectedCommodity.symbol} monthly average profile over ${seasonalData.years} years` : "Monthly average returns"}
        bodyClassName="h-[320px]"
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={seasonalData.monthly} margin={{ top: 12, right: 18, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="commodities-seasonal-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--ot-color-accent-primary)" stopOpacity={0.32} />
                <stop offset="100%" stopColor="var(--ot-color-accent-primary)" stopOpacity={0.04} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
            <XAxis dataKey="month" stroke="#94A3B8" tickLine={false} axisLine={false} fontSize={10} />
            <YAxis stroke="#94A3B8" tickLine={false} axisLine={false} fontSize={10} />
            <Tooltip
              contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155", fontSize: "11px" }}
              formatter={(value) => formatPercentTooltipValue(value, "Avg return")}
            />
            <Area
              type="monotone"
              dataKey="average_return_pct"
              stroke="var(--ot-color-accent-primary)"
              fill="url(#commodities-seasonal-fill)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </TerminalPanel>
    </div>
  );
}
