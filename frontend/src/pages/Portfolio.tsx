import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Area, AreaChart, Brush, CartesianGrid, Legend, Line, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import {
  addHolding,
  addMutualFundHolding,
  deleteHolding,
  fetchChart,
  fetchPortfolio,
  fetchPortfolioBenchmarkOverlay,
  fetchPortfolioCorrelation,
  fetchPortfolioDividends,
  fetchPortfolioRiskMetrics,
  fetchStockReturns,
  fetchTaxLots,
  searchMutualFunds,
  searchSymbols,
  type SearchSymbolItem,
} from "../api/client";
import { CountryFlag } from "../components/common/CountryFlag";
import { InstrumentBadges } from "../components/common/InstrumentBadges";
import { AllocationChart } from "../components/portfolio/AllocationChart";
import { BacktestResults } from "../components/portfolio/BacktestResults";
import { BenchmarkOverlayChart } from "../components/portfolio/BenchmarkOverlayChart";
import { CorrelationHeatmap } from "../components/portfolio/CorrelationHeatmap";
import { DividendTracker } from "../components/portfolio/DividendTracker";
import { RiskMetricsPanel } from "../components/portfolio/RiskMetricsPanel";
import { TaxLotManager } from "../components/portfolio/TaxLotManager";
import { EarningsCalendar } from "../components/EarningsCalendar";
import { EarningsDateBadge } from "../components/EarningsDateBadge";
import { MutualFundPortfolioSection } from "../components/mutualFunds/MutualFundPortfolioSection";
import { PortfolioEventsCalendar } from "../components/PortfolioEventsCalendar";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { TerminalInput } from "../components/terminal/TerminalInput";
import { usePortfolioEarnings } from "../hooks/useStocks";
import { useSettingsStore } from "../store/settingsStore";
import type {
  ChartPoint,
  MutualFund,
  PortfolioBenchmarkOverlay,
  PortfolioCorrelationResponse,
  PortfolioDividendTracker,
  PortfolioResponse,
  PortfolioRiskMetrics,
  TaxLotSummary,
} from "../types";
import { MOMENTUM_ROTATION_BASKET } from "../utils/constants";
import { formatInr } from "../utils/formatters";

type MonthSlot = {
  key: string;
  label: string;
  endTs: number;
};

type PortfolioTrendPoint = {
  key: string;
  month: string;
  value: number;
  invested: number;
  pnl: number;
  pct: number | null;
  investments: Array<{ ticker: string; date: string }>;
};

function buildMonthSlots(items: PortfolioResponse["items"]): MonthSlot[] {
  const now = new Date();
  let start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  let hasBuyDate = false;

  for (const row of items) {
    const buy = new Date(`${row.buy_date}T00:00:00Z`);
    if (!Number.isFinite(buy.getTime())) continue;
    hasBuyDate = true;
    const buyMonthStart = new Date(Date.UTC(buy.getUTCFullYear(), buy.getUTCMonth(), 1));
    if (buyMonthStart.getTime() < start.getTime()) {
      start = buyMonthStart;
    }
  }

  if (!hasBuyDate) {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  }

  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const months: MonthSlot[] = [];
  for (let cursor = new Date(start); cursor.getTime() <= end.getTime(); cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth();
    const monthEnd = new Date(Date.UTC(year, month + 1, 1) - 1);
    months.push({
      key: `${year}-${String(month + 1).padStart(2, "0")}`,
      label: cursor.toLocaleString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }),
      endTs: Math.floor(monthEnd.getTime() / 1000),
    });
  }
  return months;
}

function computePortfolioTrend(
  items: PortfolioResponse["items"],
  chartByTicker: Record<string, ChartPoint[]>,
): PortfolioTrendPoint[] {
  const slots = buildMonthSlots(items);
  const totals = new Array<number>(slots.length).fill(0);
  const invested = new Array<number>(slots.length).fill(0);
  const investmentEventsByMonth: Record<string, Array<{ ticker: string; date: string }>> = {};

  for (const row of items) {
    const points = (chartByTicker[row.ticker] ?? [])
      .filter((p) => Number.isFinite(Number(p.t)) && Number.isFinite(Number(p.c)))
      .sort((a, b) => Number(a.t) - Number(b.t));
    const qty = Number(row.quantity);
    const avg = Number(row.avg_buy_price);
    const buyTs = Math.floor(new Date(`${row.buy_date}T00:00:00Z`).getTime() / 1000);
    const buyDateSafe = new Date(`${row.buy_date}T00:00:00Z`);
    if (Number.isFinite(buyDateSafe.getTime())) {
      const eventKey = `${buyDateSafe.getUTCFullYear()}-${String(buyDateSafe.getUTCMonth() + 1).padStart(2, "0")}`;
      const dateLabel = buyDateSafe.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
      investmentEventsByMonth[eventKey] = investmentEventsByMonth[eventKey] ?? [];
      investmentEventsByMonth[eventKey].push({ ticker: row.ticker, date: dateLabel });
    }
    const investedForHolding = qty * avg;
    if (!Number.isFinite(investedForHolding) || investedForHolding <= 0) continue;

    let idx = 0;
    let lastClose: number | null = null;
    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[i];
      if (slot.endTs >= buyTs) {
        invested[i] += investedForHolding;
      }
      while (idx < points.length && Number(points[idx].t) <= slot.endTs) {
        lastClose = Number(points[idx].c);
        idx += 1;
      }
      if (slot.endTs >= buyTs && lastClose != null && Number.isFinite(lastClose)) {
        totals[i] += qty * lastClose;
      }
    }
  }

  return slots.map((slot, i) => {
    const pnl = totals[i] - invested[i];
    const pct = invested[i] > 0 ? (pnl / invested[i]) * 100 : null;
    return {
      key: slot.key,
      month: slot.label,
      value: totals[i],
      invested: invested[i],
      pnl,
      pct,
      investments: investmentEventsByMonth[slot.key] ?? [],
    };
  });
}

function formatCompactInr(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e7) return `INR ${(value / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `INR ${(value / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `INR ${(value / 1e3).toFixed(1)}K`;
  return `INR ${value.toFixed(0)}`;
}

function formatPctValue(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value.toFixed(digits)}%`;
}

function daysSince(dateString: string): number | null {
  const ts = new Date(`${dateString}T00:00:00Z`).getTime();
  if (!Number.isFinite(ts)) return null;
  const diffMs = Date.now() - ts;
  if (!Number.isFinite(diffMs)) return null;
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

export function PortfolioPage() {
  const [portfolioMode, setPortfolioMode] = useState<"equity" | "mutual_funds">("equity");
  const [mfSchemeCode, setMfSchemeCode] = useState("");
  const [mfSchemeName, setMfSchemeName] = useState("");
  const [mfFundHouse, setMfFundHouse] = useState("");
  const [mfCategory, setMfCategory] = useState("");
  const [mfUnits, setMfUnits] = useState(10);
  const [mfAvgNav, setMfAvgNav] = useState(10);
  const [mfSuggestions, setMfSuggestions] = useState<MutualFund[]>([]);
  const [mfSuggestionsOpen, setMfSuggestionsOpen] = useState(false);
  const [mfRefreshToken, setMfRefreshToken] = useState(0);
  const [mfError, setMfError] = useState<string | null>(null);
  const [mfMessage, setMfMessage] = useState<string | null>(null);
  const [data, setData] = useState<PortfolioResponse | null>(null);
  const [returnsMap, setReturnsMap] = useState<Record<string, { "1m"?: number | null; "1y"?: number | null }>>({});
  const [portfolioTrend, setPortfolioTrend] = useState<PortfolioTrendPoint[]>([]);
  const [portfolioTrendLoading, setPortfolioTrendLoading] = useState(false);
  const [trendRange, setTrendRange] = useState<"1Y" | "3Y" | "5Y" | "ALL">("ALL");
  const [swipeStartX, setSwipeStartX] = useState<number | null>(null);
  const [ticker, setTicker] = useState(MOMENTUM_ROTATION_BASKET[0]);
  const [quantity, setQuantity] = useState(10);
  const [avgBuyPrice, setAvgBuyPrice] = useState(2500);
  const [buyDate, setBuyDate] = useState("2025-01-01");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [riskMetrics, setRiskMetrics] = useState<PortfolioRiskMetrics | null>(null);
  const [correlation, setCorrelation] = useState<PortfolioCorrelationResponse | null>(null);
  const [dividends, setDividends] = useState<PortfolioDividendTracker | null>(null);
  const [taxLots, setTaxLots] = useState<TaxLotSummary | null>(null);
  const [benchmarkOverlay, setBenchmarkOverlay] = useState<PortfolioBenchmarkOverlay | null>(null);
  const [tickerSuggestions, setTickerSuggestions] = useState<SearchSymbolItem[]>([]);
  const [isTickerSuggestionsOpen, setIsTickerSuggestionsOpen] = useState(false);
  const selectedMarket = useSettingsStore((s) => s.selectedMarket);
  const searchRequestRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const portfolioSymbols = useMemo(
    () => Array.from(new Set((data?.items ?? []).map((x) => x.ticker).filter(Boolean))),
    [data?.items],
  );
  const { data: portfolioEarnings = [] } = usePortfolioEarnings(portfolioSymbols, 60);
  const nextEarningsMap = useMemo(
    () =>
      portfolioEarnings.reduce<Record<string, (typeof portfolioEarnings)[number]>>((acc, row) => {
        const key = (row.symbol || "").toUpperCase();
        if (!key) return acc;
        if (!acc[key] || row.earnings_date < acc[key].earnings_date) acc[key] = row;
        return acc;
      }, {}),
    [portfolioEarnings],
  );

  const doTickerSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setTickerSuggestions(MOMENTUM_ROTATION_BASKET.map((x) => ({ ticker: x, name: "Momentum Basket" })));
      setIsTickerSuggestionsOpen(true);
      return;
    }
    const requestId = ++searchRequestRef.current;
    try {
      const merged = await searchSymbols(q, selectedMarket);
      const seen = new Set<string>();
      const res = merged.filter((item) => {
        const key = `${(item.ticker || "").toUpperCase()}::${(item.name || "").toUpperCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (requestId !== searchRequestRef.current) return;
      setTickerSuggestions(res);
      setIsTickerSuggestionsOpen(res.length > 0);
    } catch {
      if (requestId !== searchRequestRef.current) return;
      setTickerSuggestions([]);
      setIsTickerSuggestionsOpen(false);
    }
  }, [selectedMarket]);

  const pickTicker = useCallback((value: string) => {
    setTicker(value.trim().toUpperCase());
    setTickerSuggestions([]);
    setIsTickerSuggestionsOpen(false);
  }, []);

  const load = async () => {
    setLoading(true);
    setError(null);
    setPortfolioTrendLoading(true);
    try {
      const res = await fetchPortfolio();
      setData(res);
      const symbols = Array.from(new Set(res.items.map((x) => x.ticker).filter(Boolean)));
      const entries = await Promise.all(
        symbols.map(async (s) => {
          try {
            const val = await fetchStockReturns(s);
            return [s, { "1m": val["1m"] ?? null, "1y": val["1y"] ?? null }] as const;
          } catch {
            return [s, { "1m": null, "1y": null }] as const;
          }
        }),
      );
      setReturnsMap(Object.fromEntries(entries));

      const chartEntries = await Promise.all(
        symbols.map(async (s) => {
          try {
            const hist = await fetchChart(s, "1d", "max", selectedMarket);
            return [s, Array.isArray(hist?.data) ? hist.data : []] as const;
          } catch {
            return [s, []] as const;
          }
        }),
      );
      setPortfolioTrend(computePortfolioTrend(res.items, Object.fromEntries(chartEntries)));
      const [riskRes, corrRes, divRes, taxRes, benchRes] = await Promise.all([
        fetchPortfolioRiskMetrics({ benchmark: "NIFTY50", risk_free_rate: 0.06 }).catch(() => null),
        fetchPortfolioCorrelation({ window: 60 }).catch(() => null),
        fetchPortfolioDividends({ days: 180 }).catch(() => null),
        fetchTaxLots().catch(() => null),
        fetchPortfolioBenchmarkOverlay({ benchmark: "NIFTY50" }).catch(() => null),
      ]);
      setRiskMetrics(riskRes);
      setCorrelation(corrRes);
      setDividends(divRes);
      setTaxLots(taxRes);
      setBenchmarkOverlay(benchRes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load portfolio");
      setPortfolioTrend([]);
    } finally {
      setLoading(false);
      setPortfolioTrendLoading(false);
    }
  };

  const calcGrowth = (period: "1m" | "1y") => {
    if (!data) return { previous: 0, current: 0, growth: 0, pct: null as number | null };
    let previous = 0;
    let current = 0;
    for (const row of data.items) {
      if (row.current_value == null) continue;
      const r = returnsMap[row.ticker]?.[period];
      if (r == null || !Number.isFinite(Number(r)) || Number(r) <= -0.99) continue;
      const curr = Number(row.current_value);
      const prev = curr / (1 + Number(r));
      if (!Number.isFinite(prev)) continue;
      previous += prev;
      current += curr;
    }
    const growth = current - previous;
    const pct = previous > 0 ? (growth / previous) * 100 : null;
    return { previous, current, growth, pct };
  };

  const totalCost = data?.summary.total_cost ?? 0;
  const totalValue = data?.summary.total_value ?? 0;
  const overallPnl = data?.summary.overall_pnl ?? (totalValue - totalCost);
  const lifetimePct = totalCost > 0 ? (overallPnl / totalCost) * 100 : 0;
  const mom = calcGrowth("1m");
  const yoy = calcGrowth("1y");
  const holdingsCount = data?.items.length ?? 0;
  const winnersCount = (data?.items ?? []).filter((row) => (row.pnl ?? 0) > 0).length;
  const losersCount = (data?.items ?? []).filter((row) => (row.pnl ?? 0) < 0).length;
  const performanceToneClass = overallPnl >= 0 ? "text-terminal-pos" : "text-terminal-neg";
  const avgHoldingDays =
    holdingsCount > 0
      ? Math.round(
          (data?.items ?? [])
            .map((row) => daysSince(row.buy_date))
            .filter((d): d is number => d != null)
            .reduce((acc, d) => acc + d, 0) / Math.max(1, holdingsCount),
        )
      : 0;
  const bestHolding = (data?.items ?? [])
    .filter((row) => row.pnl != null)
    .sort((a, b) => Number(b.pnl ?? 0) - Number(a.pnl ?? 0))[0];
  const worstHolding = (data?.items ?? [])
    .filter((row) => row.pnl != null)
    .sort((a, b) => Number(a.pnl ?? 0) - Number(b.pnl ?? 0))[0];
  const topWeight = (data?.items ?? [])
    .map((row) => {
      const value = Number(row.current_value ?? 0);
      const weightPct = totalValue > 0 ? (value / totalValue) * 100 : 0;
      return { ticker: row.ticker, weightPct };
    })
    .sort((a, b) => b.weightPct - a.weightPct)[0];
  const sectorBuckets = (data?.items ?? []).reduce<Record<string, { value: number; invested: number; pnl: number }>>((acc, row) => {
    if (row.current_value == null) return acc;
    const key = (row.sector || "Unknown").trim() || "Unknown";
    const currentValue = Number(row.current_value);
    const invested = Number(row.quantity) * Number(row.avg_buy_price);
    const pnl = currentValue - invested;
    const prev = acc[key] ?? { value: 0, invested: 0, pnl: 0 };
    acc[key] = {
      value: prev.value + currentValue,
      invested: prev.invested + invested,
      pnl: prev.pnl + pnl,
    };
    return acc;
  }, {});
  const sectorData = Object.entries(sectorBuckets)
    .map(([sector, bucket]) => ({
      sector,
      value: bucket.value,
      pct: totalValue > 0 ? (bucket.value / totalValue) * 100 : 0,
      pnl: bucket.pnl,
      pnlPct: bucket.invested > 0 ? (bucket.pnl / bucket.invested) * 100 : null,
    }))
    .sort((a, b) => b.value - a.value);
  const trendSlice = (() => {
    if (trendRange === "ALL") return portfolioTrend;
    const monthsBack = trendRange === "1Y" ? 12 : trendRange === "3Y" ? 36 : 60;
    return portfolioTrend.slice(Math.max(0, portfolioTrend.length - monthsBack));
  })();
  const trendValues = trendSlice.flatMap((row) => [row.value, row.invested]).filter((v) => Number.isFinite(v));
  const trendMin = trendValues.length ? Math.min(...trendValues) : 0;
  const trendMax = trendValues.length ? Math.max(...trendValues) : 0;
  const trendSpread = Math.max(1, trendMax - trendMin);
  const yAxisDomain: [number, number] = [
    Math.max(0, trendMin - trendSpread * 0.12),
    trendMax + trendSpread * 0.12,
  ];
  const returnValues = trendSlice.map((row) => row.pct).filter((v): v is number => v != null && Number.isFinite(v));
  const returnMin = returnValues.length ? Math.min(...returnValues) : -5;
  const returnMax = returnValues.length ? Math.max(...returnValues) : 5;
  const returnSpread = Math.max(1, returnMax - returnMin);
  const returnDomain: [number, number] = [returnMin - returnSpread * 0.18, returnMax + returnSpread * 0.18];

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  useEffect(() => {
    if (portfolioMode !== "mutual_funds") return;
    const q = mfSchemeCode.trim();
    if (q.length < 2) {
      setMfSuggestions([]);
      setMfSuggestionsOpen(false);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const items = await searchMutualFunds(q);
        setMfSuggestions(items.slice(0, 12));
        setMfSuggestionsOpen(items.length > 0);
      } catch {
        setMfSuggestions([]);
        setMfSuggestionsOpen(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [mfSchemeCode, portfolioMode]);

  const pickMfSuggestion = (item: MutualFund) => {
    setMfSchemeCode(String(item.scheme_code));
    setMfSchemeName(item.scheme_name || "");
    setMfFundHouse(item.fund_house || "");
    setMfCategory(item.scheme_sub_category || item.scheme_category || "");
    if (Number.isFinite(Number(item.nav)) && Number(item.nav) > 0) {
      setMfAvgNav(Number(item.nav));
    }
    setMfSuggestionsOpen(false);
  };

  if (portfolioMode === "mutual_funds") {
    return (
      <div className="space-y-3 p-4">
        <div className="rounded border border-terminal-border bg-terminal-panel p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold uppercase tracking-wide text-terminal-accent">Portfolio</div>
            <span className="rounded border border-terminal-border bg-terminal-bg px-2 py-0.5 text-[11px] text-terminal-muted">
              Mode: Mutual Funds
            </span>
          </div>
          <div className="flex gap-1">
            <button className="rounded border border-terminal-border px-2 py-1 text-xs text-terminal-muted" onClick={() => setPortfolioMode("equity")}>
              Equity
            </button>
            <button className="rounded border border-terminal-accent px-2 py-1 text-xs text-terminal-accent">
              Mutual Funds
            </button>
          </div>
        </div>
        <div className="rounded border border-terminal-border bg-terminal-panel p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold uppercase tracking-wide text-terminal-accent">Add Mutual Fund Holding</div>
            <span className="rounded border border-terminal-border bg-terminal-bg px-2 py-0.5 text-[11px] text-terminal-muted">
              Portfolio: Mutual Funds
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Scheme Code</label>
              <div className="relative">
                <TerminalInput
                  className="w-full text-xs"
                  value={mfSchemeCode}
                  onChange={(e) => setMfSchemeCode(e.target.value)}
                  onFocus={() => {
                    if (mfSuggestions.length > 0) setMfSuggestionsOpen(true);
                  }}
                  onBlur={() => {
                    setTimeout(() => setMfSuggestionsOpen(false), 120);
                  }}
                />
                {mfSuggestionsOpen && mfSuggestions.length > 0 && (
                  <div className="absolute left-0 right-0 top-8 z-10 max-h-64 overflow-auto rounded-sm border border-terminal-border bg-terminal-panel shadow-lg">
                    {mfSuggestions.map((item) => (
                      <button
                        key={item.scheme_code}
                        className="block w-full border-b border-terminal-border px-2 py-1 text-left hover:bg-terminal-bg"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          pickMfSuggestion(item);
                        }}
                      >
                        <div className="text-xs text-terminal-text">
                          {item.scheme_code} | {item.scheme_name}
                        </div>
                        <div className="text-[10px] text-terminal-muted">
                          {item.fund_house || "Unknown Fund House"} | {item.scheme_sub_category || item.scheme_category || "Other"}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Scheme Name</label>
              <TerminalInput className="w-full text-xs" value={mfSchemeName} onChange={(e) => setMfSchemeName(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Fund House</label>
              <TerminalInput className="w-full text-xs" value={mfFundHouse} onChange={(e) => setMfFundHouse(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Category</label>
              <TerminalInput className="w-full text-xs" value={mfCategory} onChange={(e) => setMfCategory(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Units</label>
              <TerminalInput className="w-full text-xs" type="number" value={mfUnits} onChange={(e) => setMfUnits(Number(e.target.value))} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Avg NAV</label>
              <TerminalInput className="w-full text-xs" type="number" value={mfAvgNav} onChange={(e) => setMfAvgNav(Number(e.target.value))} />
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Action</label>
              <TerminalButton
                variant="accent"
                className="w-full justify-center"
                onClick={async () => {
                  setMfError(null);
                  setMfMessage(null);
                  if (!mfSchemeCode.trim() || !/^\d+$/.test(mfSchemeCode.trim())) {
                    setMfError("Enter a valid numeric scheme code.");
                    return;
                  }
                  if (!Number.isFinite(mfUnits) || mfUnits <= 0 || !Number.isFinite(mfAvgNav) || mfAvgNav <= 0) {
                    setMfError("Units and Avg NAV must be greater than 0.");
                    return;
                  }
                  try {
                    let resolvedName = mfSchemeName.trim();
                    let resolvedHouse = mfFundHouse.trim();
                    let resolvedCategory = mfCategory.trim();
                    let resolvedAvgNav = mfAvgNav;
                    if (!resolvedName) {
                      const lookup = await searchMutualFunds(mfSchemeCode.trim());
                      const exact = lookup.find((x) => String(x.scheme_code) === mfSchemeCode.trim()) || lookup[0];
                      if (exact) {
                        resolvedName = exact.scheme_name || resolvedName;
                        resolvedHouse = exact.fund_house || resolvedHouse;
                        resolvedCategory = exact.scheme_sub_category || exact.scheme_category || resolvedCategory;
                        if (Number.isFinite(Number(exact.nav)) && Number(exact.nav) > 0) {
                          resolvedAvgNav = Number(exact.nav);
                          setMfAvgNav(resolvedAvgNav);
                        }
                        setMfSchemeName(resolvedName);
                        setMfFundHouse(resolvedHouse);
                        setMfCategory(resolvedCategory);
                      }
                    }
                    if (!resolvedName) {
                      setMfError("Could not resolve scheme details from scheme code. Pick a suggestion first.");
                      return;
                    }
                    await addMutualFundHolding({
                      scheme_code: Number(mfSchemeCode.trim()),
                      scheme_name: resolvedName,
                      fund_house: resolvedHouse || undefined,
                      category: resolvedCategory || undefined,
                      units: mfUnits,
                      avg_nav: resolvedAvgNav,
                    });
                    setMfMessage("Mutual fund holding added.");
                    setMfRefreshToken((n) => n + 1);
                  } catch (e) {
                    setMfError(e instanceof Error ? e.message : "Failed to add mutual fund holding");
                  }
                }}
              >
                Add Holding
              </TerminalButton>
            </div>
            <div />
            <div />
            <div />
            <div />
          </div>
          {mfError && <div className="mt-2 text-xs text-terminal-neg">{mfError}</div>}
          {mfMessage && <div className="mt-2 text-xs text-terminal-pos">{mfMessage}</div>}
        </div>
        <MutualFundPortfolioSection refreshToken={mfRefreshToken} />
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4">
      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold uppercase tracking-wide text-terminal-accent">Portfolio</div>
          <span className="rounded border border-terminal-border bg-terminal-bg px-2 py-0.5 text-[11px] text-terminal-muted">
            Mode: Equity
          </span>
        </div>
        <div className="flex gap-1">
          <button className="rounded border border-terminal-accent px-2 py-1 text-xs text-terminal-accent">
            Equity
          </button>
          <button className="rounded border border-terminal-border px-2 py-1 text-xs text-terminal-muted" onClick={() => setPortfolioMode("mutual_funds")}>
            Mutual Funds
          </button>
        </div>
      </div>
      <div className="rounded border border-terminal-border bg-terminal-panel p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold uppercase tracking-wide text-terminal-accent">Add Holding</div>
          <span className="rounded border border-terminal-border bg-terminal-bg px-2 py-0.5 text-[11px] text-terminal-muted">
            Market: {selectedMarket}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Ticker</label>
            <div className="relative">
              <TerminalInput
                className="w-full text-xs"
                value={ticker}
                placeholder={`Search ${selectedMarket} ticker`}
                onChange={(e) => {
                  const next = e.target.value.toUpperCase();
                  setTicker(next);
                  if (debounceRef.current) clearTimeout(debounceRef.current);
                  debounceRef.current = setTimeout(() => {
                    void doTickerSearch(next);
                  }, 250);
                }}
                onFocus={() => {
                  if (tickerSuggestions.length > 0 && ticker.length >= 2) {
                    setIsTickerSuggestionsOpen(true);
                  }
                }}
                onBlur={() => {
                  setTimeout(() => setIsTickerSuggestionsOpen(false), 120);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setTickerSuggestions([]);
                    setIsTickerSuggestionsOpen(false);
                  }
                }}
              />
              {isTickerSuggestionsOpen && tickerSuggestions.length > 0 && (
                <div className="absolute left-0 right-0 top-8 z-10 max-h-64 overflow-auto rounded-sm border border-terminal-border bg-terminal-panel shadow-lg">
                  {tickerSuggestions.map((item) => (
                    <button
                      key={`${item.ticker}:${item.name}`}
                      className="block w-full border-b border-terminal-border px-2 py-1 text-left text-xs text-terminal-text hover:bg-terminal-bg"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pickTicker(item.ticker);
                      }}
                    >
                      <span className="inline-flex items-center gap-2">
                        <CountryFlag countryCode={item.country_code} flagEmoji={item.flag_emoji} size="sm" />
                        <span>{item.ticker}</span>
                        <span className="text-terminal-muted">- {item.name}</span>
                        {item.exchange ? <span className="text-terminal-muted">({item.exchange})</span> : null}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Qty</label>
            <TerminalInput className="w-full text-xs" type="number" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Avg Buy</label>
            <TerminalInput className="w-full text-xs" type="number" value={avgBuyPrice} onChange={(e) => setAvgBuyPrice(Number(e.target.value))} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Buy Date</label>
            <TerminalInput className="w-full text-xs" type="date" value={buyDate} onChange={(e) => setBuyDate(e.target.value)} />
          </div>
          <div className="flex items-end">
            <TerminalButton
              variant="accent"
              className="w-full justify-center"
              onClick={async () => {
                try {
                  await addHolding({ ticker, quantity, avg_buy_price: avgBuyPrice, buy_date: buyDate });
                  await load();
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Failed to add holding");
                }
              }}
            >
              Add Holding
            </TerminalButton>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-terminal-muted">Quick Picks:</span>
          {MOMENTUM_ROTATION_BASKET.map((symbol) => (
            <TerminalButton
              key={symbol}
              className={`px-1.5 py-0.5 text-[10px] normal-case tracking-normal ${
                ticker === symbol
                  ? "border-terminal-accent bg-terminal-accent/20 text-terminal-accent"
                  : "border-terminal-border text-terminal-muted hover:text-terminal-text"
              }`}
              onClick={() => pickTicker(symbol)}
            >
              {symbol}
            </TerminalButton>
          ))}
        </div>
      </div>

      {loading && <div className="text-xs text-terminal-muted">Loading portfolio...</div>}
      {error && <div className="rounded border border-terminal-neg bg-terminal-neg/10 p-3 text-xs text-terminal-neg">{error}</div>}
      {data && (
        <>
          <div className="rounded border border-terminal-accent/40 bg-terminal-panel p-3 shadow-[0_0_0_1px_rgba(0,193,118,0.08)]">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
              <div className="rounded border border-terminal-accent/50 bg-terminal-bg px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-terminal-muted">Portfolio Value</div>
                <div className="mt-1 text-sm font-semibold leading-none text-terminal-text md:text-base [font-variant-numeric:tabular-nums]">
                  {formatInr(totalValue)}
                </div>
              </div>
              <div className="rounded border border-terminal-border/80 bg-terminal-bg px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-terminal-muted">Invested</div>
                <div className="mt-1 text-sm font-semibold leading-none text-terminal-text md:text-base [font-variant-numeric:tabular-nums]">
                  {formatInr(totalCost)}
                </div>
              </div>
              <div className={`rounded border bg-terminal-bg px-3 py-2 ${overallPnl >= 0 ? "border-terminal-pos/60" : "border-terminal-neg/60"}`}>
                <div className="text-[10px] uppercase tracking-wide text-terminal-muted">Unrealized P&L</div>
                <div className={`mt-1 text-sm font-semibold leading-none md:text-base [font-variant-numeric:tabular-nums] ${performanceToneClass}`}>
                  {formatInr(overallPnl)}
                </div>
              </div>
              <div className={`rounded border bg-terminal-bg px-3 py-2 ${lifetimePct >= 0 ? "border-terminal-pos/60" : "border-terminal-neg/60"}`}>
                <div className="text-[10px] uppercase tracking-wide text-terminal-muted">Total Return</div>
                <div className={`mt-1 text-sm font-semibold leading-none md:text-base [font-variant-numeric:tabular-nums] ${performanceToneClass}`}>
                  {formatPctValue(lifetimePct)}
                </div>
              </div>
              <div className="rounded border border-terminal-border/80 bg-terminal-bg px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-terminal-muted">Win Rate</div>
                <div className="mt-1 text-sm font-semibold leading-none text-terminal-text md:text-base [font-variant-numeric:tabular-nums]">
                  {holdingsCount > 0 ? formatPctValue((winnersCount / holdingsCount) * 100) : "-"}
                </div>
              </div>
              <div className="rounded border border-terminal-border/80 bg-terminal-bg px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-terminal-muted">Avg Days Held</div>
                <div className="mt-1 text-sm font-semibold leading-none text-terminal-text md:text-base [font-variant-numeric:tabular-nums]">
                  {avgHoldingDays || 0}
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-2 rounded border border-terminal-border bg-terminal-panel p-2 text-[11px]">
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-4">
              <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-terminal-muted">
                Best Contributor:{" "}
                <span className="text-terminal-pos">
                  {bestHolding ? `${bestHolding.ticker} (${formatInr(bestHolding.pnl ?? 0)})` : "-"}
                </span>
              </div>
              <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-terminal-muted">
                Worst Contributor:{" "}
                <span className="text-terminal-neg">
                  {worstHolding ? `${worstHolding.ticker} (${formatInr(worstHolding.pnl ?? 0)})` : "-"}
                </span>
              </div>
              <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-terminal-muted">
                Top Concentration:{" "}
                <span className="text-terminal-text">
                  {topWeight ? `${topWeight.ticker} (${formatPctValue(topWeight.weightPct, 1)})` : "-"}
                </span>
              </div>
              <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-terminal-muted">
                Holdings Split:{" "}
                <span className="text-terminal-pos">{winnersCount} winners</span> /{" "}
                <span className="text-terminal-neg">{losersCount} losers</span>
              </div>
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            <RiskMetricsPanel metrics={riskMetrics} />
            <CorrelationHeatmap data={correlation} />
            <DividendTracker data={dividends} />
            <BenchmarkOverlayChart data={benchmarkOverlay} />
            <div className="xl:col-span-2">
              <TaxLotManager
                data={taxLots}
                onRefresh={async () => {
                  const refreshed = await fetchTaxLots();
                  setTaxLots(refreshed);
                }}
              />
            </div>
            <div className="rounded border border-terminal-border bg-terminal-panel p-3">
              <div className="mb-2 text-sm font-semibold text-terminal-accent">Upcoming Earnings</div>
              <div className="space-y-2">
                {portfolioEarnings.slice(0, 5).map((row) => (
                  <div key={`${row.symbol}-${row.earnings_date}`} className="flex items-center justify-between rounded border border-terminal-border bg-terminal-bg px-2 py-1">
                    <span className="text-xs text-terminal-text">{row.symbol}</span>
                    <EarningsDateBadge event={row} />
                  </div>
                ))}
                {portfolioEarnings.length === 0 ? <div className="text-xs text-terminal-muted">No upcoming earnings.</div> : null}
              </div>
            </div>
            <EarningsCalendar symbols={portfolioSymbols} />
          </div>

          <PortfolioEventsCalendar symbols={portfolioSymbols} days={30} />

          <div className="grid gap-3 xl:grid-cols-12">
            <div className="rounded border border-terminal-border bg-terminal-panel p-3 xl:col-span-12">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold">Portfolio Movement & Historical Return</div>
                <div className="flex items-center gap-1 text-[11px]">
                  {(["1Y", "3Y", "5Y", "ALL"] as const).map((r) => (
                    <button
                      key={r}
                      className={`rounded border px-1.5 py-0.5 ${
                        trendRange === r
                          ? "border-terminal-accent text-terminal-accent"
                          : "border-terminal-border text-terminal-muted hover:text-terminal-text"
                      }`}
                      onClick={() => setTrendRange(r)}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              {portfolioTrendLoading ? (
                <div className="text-xs text-terminal-muted">Loading monthly portfolio movement...</div>
              ) : trendSlice.length === 0 ? (
                <div className="text-xs text-terminal-muted">No monthly portfolio movement data available.</div>
              ) : (
                <div
                  className="h-[26rem] w-full"
                  onTouchStart={(e) => setSwipeStartX(e.touches[0]?.clientX ?? null)}
                  onTouchEnd={(e) => {
                    if (swipeStartX == null) return;
                    const delta = (e.changedTouches[0]?.clientX ?? 0) - swipeStartX;
                    setSwipeStartX(null);
                    const order: Array<"1Y" | "3Y" | "5Y" | "ALL"> = ["1Y", "3Y", "5Y", "ALL"];
                    const idx = order.indexOf(trendRange);
                    if (delta < -60 && idx < order.length - 1) setTrendRange(order[idx + 1]);
                    if (delta > 60 && idx > 0) setTrendRange(order[idx - 1]);
                  }}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trendSlice}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#2a2f3a" />
                      <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#8e98a8", fontSize: 10 }} />
                      <YAxis
                        yAxisId="value"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "#8e98a8", fontSize: 10 }}
                        width={88}
                        tickCount={6}
                        domain={yAxisDomain}
                        tickFormatter={(value: number) => formatCompactInr(value)}
                      />
                      <YAxis
                        yAxisId="return"
                        orientation="right"
                        axisLine={false}
                        tickLine={false}
                        width={64}
                        tick={{ fill: "#8e98a8", fontSize: 10 }}
                        domain={returnDomain}
                        tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                      />
                      <Tooltip
                        contentStyle={{ border: "1px solid #2a2f3a", background: "#0c0f14", color: "#d8dde7" }}
                        formatter={(value: number | string | undefined, name: string | undefined) =>
                          name === "Portfolio Value" || name === "Invested Baseline"
                            ? [formatInr(Number(value ?? 0)), name]
                            : name === "Return %"
                            ? [`${Number(value ?? 0).toFixed(2)}%`, "Return %"]
                            : [String(value ?? "-"), name ?? "Value"]
                        }
                        content={({ active, payload, label }) => {
                          if (!active || !payload || payload.length === 0) return null;
                          const row = payload[0]?.payload as PortfolioTrendPoint | undefined;
                          return (
                            <div className="rounded border border-terminal-border bg-terminal-panel px-3 py-2 text-xs text-terminal-text">
                              <div className="mb-1 font-semibold">Month: {label}</div>
                              <div>Portfolio Value: {formatInr(row?.value ?? 0)}</div>
                              <div>Invested Baseline: {formatInr(row?.invested ?? 0)}</div>
                              <div className={row && row.pnl >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>
                                Return: {formatInr(row?.pnl ?? 0)} ({row?.pct == null ? "-" : `${row.pct.toFixed(2)}%`})
                              </div>
                              {row && row.investments.length > 0 && (
                                <div className="mt-1 border-t border-terminal-border pt-1 text-terminal-accent">
                                  Invested: {row.investments.map((x) => `${x.ticker} (${x.date})`).join(", ")}
                                </div>
                              )}
                            </div>
                          );
                        }}
                        labelFormatter={(label) => `Month: ${label}`}
                      />
                      <Legend wrapperStyle={{ color: "#d8dde7", fontSize: "11px" }} />
                      <Area
                        yAxisId="value"
                        type="monotone"
                        dataKey="value"
                        name="Portfolio Value"
                        fill="#00c176"
                        fillOpacity={0.22}
                        stroke="#00c176"
                        strokeWidth={2.2}
                        dot={{ r: 1.5 }}
                        activeDot={{ r: 4 }}
                      />
                      <Area
                        yAxisId="value"
                        type="monotone"
                        dataKey="invested"
                        name="Invested Baseline"
                        fill="#5aa9ff"
                        fillOpacity={0.09}
                        stroke="#5aa9ff"
                        strokeWidth={1.8}
                        dot={false}
                        activeDot={{ r: 3 }}
                      />
                      <Line
                        yAxisId="return"
                        type="monotone"
                        dataKey="pct"
                        name="Return %"
                        stroke="#fbbf24"
                        strokeWidth={1.8}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                      {trendSlice
                        .filter((row) => row.investments.length > 0)
                        .map((row) => (
                          <ReferenceDot
                            key={`inv-${row.key}`}
                            yAxisId="value"
                            x={row.month}
                            y={row.value}
                            r={3}
                            fill="#fbbf24"
                            stroke="#fbbf24"
                            label={{
                              value:
                                row.investments.length === 1
                                  ? `${row.investments[0].ticker} ${row.investments[0].date}`
                                  : `${row.investments[0].ticker} +${row.investments.length - 1}`,
                              position: "top",
                              fill: "#fbbf24",
                              fontSize: 10,
                            }}
                          />
                        ))}
                      {trendSlice.length > 18 && (
                        <Brush
                          dataKey="month"
                          height={18}
                          stroke="#8e98a8"
                          travellerWidth={8}
                          startIndex={Math.max(0, trendSlice.length - 24)}
                          endIndex={trendSlice.length - 1}
                        />
                      )}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div className="mt-2 text-[11px] text-terminal-muted">
                Historical monthly returns are now derived from full available price history and shown as Return % (right axis).
              </div>
            </div>

            <div className="space-y-3 xl:col-span-8">
              <div className="rounded border border-terminal-border bg-terminal-panel p-3">
              <div className="mb-2 text-sm font-semibold">Holdings</div>
              <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="rounded border border-terminal-accent/40 bg-terminal-bg px-2 py-1 text-terminal-text">
                    Total Holdings: <span className="text-terminal-text">{holdingsCount}</span>
                  </span>
                  <span className="rounded border border-terminal-border/80 bg-terminal-bg px-2 py-1 text-terminal-text">
                    Net Invested: <span className="text-terminal-text">{formatInr(totalCost)}</span>
                  </span>
                  <span className="rounded border border-terminal-border/80 bg-terminal-bg px-2 py-1 text-terminal-text">
                    Net Current: <span className="text-terminal-text">{formatInr(totalValue)}</span>
                  </span>
                  <span className={`rounded border px-2 py-1 ${overallPnl >= 0 ? "border-terminal-pos/60 bg-terminal-pos/10 text-terminal-pos" : "border-terminal-neg/60 bg-terminal-neg/10 text-terminal-neg"}`}>
                    Net P&L: {formatInr(overallPnl)} ({lifetimePct.toFixed(2)}%)
                  </span>
                </div>
                <div className="overflow-auto">
                  <table className="min-w-full text-xs">
                <thead>
                  <tr className="border-b border-terminal-border text-terminal-muted">
                    <th className="px-2 py-1 text-left">Flag</th>
                    <th className="px-2 py-1 text-left">Ticker</th>
                    <th className="px-2 py-1 text-left">Next Earnings</th>
                    <th className="px-2 py-1 text-left">F&O</th>
                    <th className="px-2 py-1 text-right">Qty</th>
                    <th className="px-2 py-1 text-right">Avg Buy</th>
                    <th className="px-2 py-1 text-left">Sector</th>
                    <th className="px-2 py-1 text-right">Days Held</th>
                    <th className="px-2 py-1 text-right">Current</th>
                    <th className="px-2 py-1 text-right">Value</th>
                    <th className="px-2 py-1 text-right">Weight</th>
                    <th className="px-2 py-1 text-right">% Change</th>
                    <th className="px-2 py-1 text-right">P&L Contrib</th>
                    <th className="px-2 py-1 text-right">P&L</th>
                    <th className="px-2 py-1 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => {
                    const invested = Number(row.quantity) * Number(row.avg_buy_price);
                    const current = row.current_value == null ? null : Number(row.current_value);
                    const pctChange = current != null && invested > 0 ? ((current - invested) / invested) * 100 : null;
                    const weightPct = totalValue > 0 && current != null ? (current / totalValue) * 100 : null;
                    const pnlContribPct = overallPnl !== 0 && row.pnl != null ? (Number(row.pnl) / overallPnl) * 100 : null;
                    const heldDays = daysSince(row.buy_date);
                    const pnlClass =
                      row.pnl == null ? "text-terminal-muted" : row.pnl >= 0 ? "text-terminal-pos" : "text-terminal-neg";
                    const pctClass =
                      pctChange == null ? "text-terminal-muted" : pctChange >= 0 ? "text-terminal-pos" : "text-terminal-neg";
                    const contribClass =
                      pnlContribPct == null ? "text-terminal-muted" : pnlContribPct >= 0 ? "text-terminal-pos" : "text-terminal-neg";
                    return (
                      <tr key={row.id} className="border-b border-terminal-border/50">
                        <td className="px-2 py-1">
                          <CountryFlag countryCode={row.country_code} flagEmoji={row.flag_emoji} />
                        </td>
                        <td className="px-2 py-1">{row.ticker}</td>
                        <td className="px-2 py-1">
                          <EarningsDateBadge event={nextEarningsMap[row.ticker.toUpperCase()]} />
                        </td>
                        <td className="px-2 py-1">
                          <InstrumentBadges exchange={row.exchange} hasFutures={row.has_futures} hasOptions={row.has_options} />
                        </td>
                        <td className="px-2 py-1 text-right">{row.quantity}</td>
                        <td className="px-2 py-1 text-right">{formatInr(row.avg_buy_price)}</td>
                        <td className="px-2 py-1">{row.sector || "-"}</td>
                        <td className="px-2 py-1 text-right">{heldDays == null ? "-" : heldDays}</td>
                        <td className="px-2 py-1 text-right">{formatInr(row.current_price ?? undefined)}</td>
                        <td className="px-2 py-1 text-right">{formatInr(row.current_value ?? undefined)}</td>
                        <td className="px-2 py-1 text-right text-terminal-text">{formatPctValue(weightPct, 2)}</td>
                        <td className={`px-2 py-1 text-right ${pctClass}`}>{formatPctValue(pctChange, 2)}</td>
                        <td className={`px-2 py-1 text-right ${contribClass}`}>{formatPctValue(pnlContribPct, 2)}</td>
                        <td className={`px-2 py-1 text-right ${pnlClass}`}>{formatInr(row.pnl ?? undefined)}</td>
                        <td className="px-2 py-1 text-right">
                          <button
                            className="rounded border border-terminal-border px-2 py-1"
                            onClick={async () => {
                              try {
                                await deleteHolding(row.id);
                                await load();
                              } catch (e) {
                                setError(e instanceof Error ? e.message : "Failed to delete holding");
                              }
                            }}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                  </table>
                </div>
              </div>

            </div>

            <div className="space-y-3 xl:col-span-4">
              <div className="rounded border border-terminal-border bg-terminal-panel p-3">
                <div className="mb-2 text-sm font-semibold">Portfolio Signals</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded border border-terminal-border bg-terminal-bg p-2">
                    <div className="text-terminal-muted">MoM</div>
                    <div className={mom.growth >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>
                      {formatInr(mom.growth)} ({formatPctValue(mom.pct)})
                    </div>
                  </div>
                  <div className="rounded border border-terminal-border bg-terminal-bg p-2">
                    <div className="text-terminal-muted">YoY</div>
                    <div className={yoy.growth >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>
                      {formatInr(yoy.growth)} ({formatPctValue(yoy.pct)})
                    </div>
                  </div>
                  <div className="rounded border border-terminal-border bg-terminal-bg p-2">
                    <div className="text-terminal-muted">Best</div>
                    <div className="text-terminal-pos">{bestHolding ? bestHolding.ticker : "-"}</div>
                  </div>
                  <div className="rounded border border-terminal-border bg-terminal-bg p-2">
                    <div className="text-terminal-muted">Worst</div>
                    <div className="text-terminal-neg">{worstHolding ? worstHolding.ticker : "-"}</div>
                  </div>
                  <div className="rounded border border-terminal-border bg-terminal-bg p-2">
                    <div className="text-terminal-muted">Top Weight</div>
                    <div className="text-terminal-text">{topWeight ? `${topWeight.ticker} ${formatPctValue(topWeight.weightPct, 1)}` : "-"}</div>
                  </div>
                  <div className="rounded border border-terminal-border bg-terminal-bg p-2">
                    <div className="text-terminal-muted">Sectors</div>
                    <div className="text-terminal-text">{Object.keys(sectorBuckets).length}</div>
                  </div>
                </div>
              </div>

              <div className="rounded border border-terminal-border bg-terminal-panel p-3">
                <div className="mb-2 text-sm font-semibold">Sector Allocation</div>
                <AllocationChart data={sectorData} />
              </div>
            </div>
          </div>
        </>
      )}

      <BacktestResults initialTickers={(data?.items ?? []).map((row) => row.ticker)} />
    </div>
  );
}
