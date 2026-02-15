import { useCallback, useEffect, useRef, useState } from "react";
import { Area, AreaChart, Brush, CartesianGrid, Legend, Line, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { addHolding, deleteHolding, fetchChart, fetchPortfolio, fetchQuarterlyReports, fetchStockReturns, searchSymbols } from "../api/client";
import { AllocationChart } from "../components/portfolio/AllocationChart";
import { BacktestResults } from "../components/portfolio/BacktestResults";
import { useSettingsStore } from "../store/settingsStore";
import type { ChartPoint, PortfolioResponse } from "../types";
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

type PortfolioEventItem = {
  id: string;
  ticker: string;
  dateIso: string;
  dateLabel: string;
  type: string;
  title: string;
  source: string;
  url?: string;
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
  const [data, setData] = useState<PortfolioResponse | null>(null);
  const [returnsMap, setReturnsMap] = useState<Record<string, { "1m"?: number | null; "1y"?: number | null }>>({});
  const [portfolioTrend, setPortfolioTrend] = useState<PortfolioTrendPoint[]>([]);
  const [portfolioTrendLoading, setPortfolioTrendLoading] = useState(false);
  const [portfolioEvents, setPortfolioEvents] = useState<PortfolioEventItem[]>([]);
  const [portfolioEventsLoading, setPortfolioEventsLoading] = useState(false);
  const [trendRange, setTrendRange] = useState<"1Y" | "3Y" | "5Y" | "ALL">("ALL");
  const [ticker, setTicker] = useState(MOMENTUM_ROTATION_BASKET[0]);
  const [quantity, setQuantity] = useState(10);
  const [avgBuyPrice, setAvgBuyPrice] = useState(2500);
  const [buyDate, setBuyDate] = useState("2025-01-01");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tickerSuggestions, setTickerSuggestions] = useState<Array<{ ticker: string; name: string }>>([]);
  const [isTickerSuggestionsOpen, setIsTickerSuggestionsOpen] = useState(false);
  const selectedMarket = useSettingsStore((s) => s.selectedMarket);
  const searchRequestRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doTickerSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setTickerSuggestions(MOMENTUM_ROTATION_BASKET.map((x) => ({ ticker: x, name: "Momentum Basket" })));
      setIsTickerSuggestionsOpen(true);
      return;
    }
    const requestId = ++searchRequestRef.current;
    try {
      const res = await searchSymbols(q, selectedMarket);
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
    setPortfolioEventsLoading(true);
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

      const eventSymbols = (symbols.length > 0 ? symbols : MOMENTUM_ROTATION_BASKET).slice(0, 20);
      const quarterlyRows = await Promise.all(
        eventSymbols.map(async (symbol) => {
          try {
            const reports = await fetchQuarterlyReports(selectedMarket, symbol, 6);
            return reports.map((report) => ({ symbol, report }));
          } catch {
            return [];
          }
        }),
      );
      const normalizedEvents = quarterlyRows
        .flat()
        .reduce<PortfolioEventItem[]>((acc, { symbol, report }) => {
          const dateIso = String(report.publishedAt || report.periodEndDate || "");
          const ts = new Date(dateIso).getTime();
          if (!Number.isFinite(ts)) return acc;
          acc.push({
            id: `${symbol}-${report.id}-${dateIso}`,
            ticker: symbol,
            dateIso,
            dateLabel: new Date(ts).toLocaleDateString("en-US", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            }),
            type: String(report.reportType || "Quarterly Result"),
            title: String(report.title || "Quarterly Update"),
            source: String(report.source || "Exchange"),
            url: Array.isArray(report.links) && report.links.length > 0 ? report.links[0]?.url : undefined,
          });
          return acc;
        }, [])
        .sort((a, b) => new Date(b.dateIso).getTime() - new Date(a.dateIso).getTime())
        .slice(0, 24);
      setPortfolioEvents(normalizedEvents);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load portfolio");
      setPortfolioTrend([]);
      setPortfolioEvents([]);
    } finally {
      setLoading(false);
      setPortfolioTrendLoading(false);
      setPortfolioEventsLoading(false);
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

  return (
    <div className="space-y-3 p-4">
      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="mb-2 text-sm font-semibold">Add Holding</div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Ticker</label>
            <div className="relative">
              <input
                className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs outline-none focus:border-terminal-accent"
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
                <div className="absolute left-0 right-0 top-8 z-10 max-h-64 overflow-auto rounded border border-terminal-border bg-terminal-panel">
                  {tickerSuggestions.map((item) => (
                    <button
                      key={item.ticker}
                      className="block w-full border-b border-terminal-border px-2 py-1 text-left text-xs hover:bg-terminal-bg"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pickTicker(item.ticker);
                      }}
                    >
                      {item.ticker} - {item.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Qty</label>
            <input className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" type="number" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Avg Buy</label>
            <input className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" type="number" value={avgBuyPrice} onChange={(e) => setAvgBuyPrice(Number(e.target.value))} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Buy Date</label>
            <input className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" type="date" value={buyDate} onChange={(e) => setBuyDate(e.target.value)} />
          </div>
          <div className="flex items-end">
            <button
              className="w-full rounded bg-terminal-accent px-3 py-1 text-xs text-black"
              onClick={async () => {
                try {
                  await addHolding({ ticker, quantity, avg_buy_price: avgBuyPrice, buy_date: buyDate });
                  await load();
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Failed to add holding");
                }
              }}
            >
              Add
            </button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-terminal-muted">Momentum Basket:</span>
          {MOMENTUM_ROTATION_BASKET.map((symbol) => (
            <button
              key={symbol}
              className={`rounded border px-1.5 py-0.5 text-[10px] ${
                ticker === symbol
                  ? "border-terminal-accent text-terminal-accent"
                  : "border-terminal-border text-terminal-muted hover:text-terminal-text"
              }`}
              onClick={() => pickTicker(symbol)}
            >
              {symbol}
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="text-xs text-terminal-muted">Loading portfolio...</div>}
      {error && <div className="rounded border border-terminal-neg bg-terminal-neg/10 p-3 text-xs text-terminal-neg">{error}</div>}
      {data && (
        <>
          <div className="sticky top-0 z-10 rounded border border-terminal-accent/30 bg-terminal-panel/95 p-3 backdrop-blur">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
              <div className="rounded border border-terminal-accent/40 bg-terminal-bg p-3">
                <div className="text-[11px] uppercase tracking-wide text-terminal-muted">Portfolio Value</div>
                <div className="mt-1 text-xl font-semibold leading-none text-terminal-text lg:text-2xl [font-variant-numeric:tabular-nums]">
                  {formatInr(totalValue)}
                </div>
              </div>
              <div className="rounded border border-terminal-border bg-terminal-bg p-3">
                <div className="text-[11px] uppercase tracking-wide text-terminal-muted">Invested</div>
                <div className="mt-1 text-xl font-semibold leading-none text-terminal-text lg:text-2xl [font-variant-numeric:tabular-nums]">
                  {formatInr(totalCost)}
                </div>
              </div>
              <div className="rounded border border-terminal-border bg-terminal-bg p-3">
                <div className="text-[11px] uppercase tracking-wide text-terminal-muted">Unrealized P&L</div>
                <div className={`mt-1 text-xl font-semibold leading-none lg:text-2xl [font-variant-numeric:tabular-nums] ${performanceToneClass}`}>
                  {formatInr(overallPnl)}
                </div>
              </div>
              <div className="rounded border border-terminal-border bg-terminal-bg p-3">
                <div className="text-[11px] uppercase tracking-wide text-terminal-muted">Total Return</div>
                <div className={`mt-1 text-xl font-semibold leading-none lg:text-2xl [font-variant-numeric:tabular-nums] ${performanceToneClass}`}>
                  {formatPctValue(lifetimePct)}
                </div>
              </div>
              <div className="rounded border border-terminal-border bg-terminal-bg p-3">
                <div className="text-[11px] uppercase tracking-wide text-terminal-muted">Win Rate</div>
                <div className="mt-1 text-xl font-semibold leading-none text-terminal-text lg:text-2xl [font-variant-numeric:tabular-nums]">
                  {holdingsCount > 0 ? formatPctValue((winnersCount / holdingsCount) * 100) : "-"}
                </div>
              </div>
              <div className="rounded border border-terminal-border bg-terminal-bg p-3">
                <div className="text-[11px] uppercase tracking-wide text-terminal-muted">Avg Days Held</div>
                <div className="mt-1 text-xl font-semibold leading-none text-terminal-text lg:text-2xl [font-variant-numeric:tabular-nums]">
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
                <div className="h-[26rem] w-full">
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
                  <span className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-terminal-muted">
                    Total Holdings: <span className="text-terminal-text">{holdingsCount}</span>
                  </span>
                  <span className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-terminal-muted">
                    Net Invested: <span className="text-terminal-text">{formatInr(totalCost)}</span>
                  </span>
                  <span className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-terminal-muted">
                    Net Current: <span className="text-terminal-text">{formatInr(totalValue)}</span>
                  </span>
                  <span className={`rounded border border-terminal-border bg-terminal-bg px-2 py-1 ${performanceToneClass}`}>
                    Net P&L: {formatInr(overallPnl)} ({lifetimePct.toFixed(2)}%)
                  </span>
                </div>
                <div className="overflow-auto">
                  <table className="min-w-full text-xs">
                <thead>
                  <tr className="border-b border-terminal-border text-terminal-muted">
                    <th className="px-2 py-1 text-left">Ticker</th>
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
                        <td className="px-2 py-1">{row.ticker}</td>
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

              <div className="rounded border border-terminal-border bg-terminal-panel p-3">
                <div className="mb-2 text-sm font-semibold">Portfolio Events</div>
                <div className="mb-2 text-[11px] text-terminal-muted">
                  Quarterly result announcements and report events for current holdings (or momentum basket defaults).
                </div>
                {portfolioEventsLoading ? (
                  <div className="text-xs text-terminal-muted">Loading portfolio events...</div>
                ) : portfolioEvents.length === 0 ? (
                  <div className="text-xs text-terminal-muted">No events available for current holdings.</div>
                ) : (
                  <div className="overflow-auto">
                    <table className="min-w-full text-xs">
                  <thead>
                    <tr className="border-b border-terminal-border text-terminal-muted">
                      <th className="px-2 py-1 text-left">Date</th>
                      <th className="px-2 py-1 text-left">Ticker</th>
                      <th className="px-2 py-1 text-left">Event</th>
                      <th className="px-2 py-1 text-left">Type</th>
                      <th className="px-2 py-1 text-left">Source</th>
                      <th className="px-2 py-1 text-left">Link</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolioEvents.map((evt) => (
                      <tr key={evt.id} className="border-b border-terminal-border/50">
                        <td className="px-2 py-1">{evt.dateLabel}</td>
                        <td className="px-2 py-1 text-terminal-accent">{evt.ticker}</td>
                        <td className="px-2 py-1">{evt.title}</td>
                        <td className="px-2 py-1">{evt.type}</td>
                        <td className="px-2 py-1">{evt.source}</td>
                        <td className="px-2 py-1">
                          {evt.url ? (
                            <a
                              className="text-terminal-accent underline"
                              href={evt.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open
                            </a>
                          ) : (
                            <span className="text-terminal-muted">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                    </table>
                  </div>
                )}
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
