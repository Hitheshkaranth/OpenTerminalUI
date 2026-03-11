import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import {
  fetchCryptoDominance,
  fetchCryptoIndex,
  fetchCryptoMarkets,
  fetchCryptoMovers,
  fetchCryptoSectors,
  type CryptoMarketRow,
  type CryptoMarketsQuery,
  type CryptoMoverRow,
} from "../api/client";
import { CryptoCorrelationMatrixPanel } from "../components/crypto/CryptoCorrelationMatrixPanel";
import { CryptoDefiPanel } from "../components/crypto/CryptoDefiPanel";
import { CryptoDerivativesPanel } from "../components/crypto/CryptoDerivativesPanel";
import { CryptoHeatmapPanel } from "../components/crypto/CryptoHeatmapPanel";
import { TerminalBadge } from "../components/terminal/TerminalBadge";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { TerminalInput } from "../components/terminal/TerminalInput";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { useStockStore } from "../store/stockStore";

type CryptoTab = "markets" | "movers" | "index" | "sectors" | "heatmap" | "derivatives" | "defi" | "correlation";

type HeatmapResponse = {
  items: Array<{
    symbol: string;
    name: string;
    sector: string;
    change_24h: number;
    market_cap: number;
    depth_imbalance: number;
    bucket: string;
  }>;
};

type DerivativesResponse = {
  items: Array<{
    symbol: string;
    funding_rate_8h: number;
    open_interest_usd: number;
    long_liquidations_24h: number;
    short_liquidations_24h: number;
    liquidations_24h: number;
  }>;
  totals: {
    open_interest_usd: number;
    long_liquidations_24h: number;
    short_liquidations_24h: number;
    liquidations_24h: number;
  };
};

type DefiResponse = {
  headline: {
    tvl_usd: number;
    dex_volume_24h: number;
    lending_borrowed_usd: number;
    defi_change_24h: number;
  };
  protocols: Array<{
    symbol: string;
    name: string;
    change_24h: number;
    dominance_pct: number;
    tvl_proxy_usd: number;
  }>;
};

type CorrelationResponse = {
  symbols: string[];
  matrix: number[][];
  window: number;
};

const TAB_META: Record<CryptoTab, { title: string; subtitle: string }> = {
  markets: { title: "Market Board", subtitle: "Search, rank, and route the liquid crypto universe" },
  movers: { title: "Movers", subtitle: "Leaders, laggards, and tape pressure" },
  index: { title: "Index Monitor", subtitle: "Top basket proxy for index-level positioning" },
  sectors: { title: "Sector Rotation", subtitle: "Basket leadership across L1, DeFi, AI, and more" },
  heatmap: { title: "Heatmap", subtitle: "Market-cap map with depth imbalance" },
  derivatives: { title: "Derivatives", subtitle: "Funding, open interest, and liquidation pressure" },
  defi: { title: "DeFi", subtitle: "Protocol leadership, TVL proxy, and dex flow" },
  correlation: { title: "Correlation", subtitle: "Rolling return relationship map" },
};

function pctClass(v: number): string {
  return v >= 0 ? "text-terminal-pos" : "text-terminal-neg";
}

function normalizeChartSymbol(symbol: string): string {
  return symbol.replace("-USD", "").toUpperCase();
}

function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatCurrencyCompact(value: number): string {
  if (!Number.isFinite(value)) return "--";
  return `$${formatCompact(value)}`;
}

function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return "--";
  const maximumFractionDigits = value >= 1000 ? 2 : value >= 1 ? 2 : 4;
  return value.toLocaleString("en-US", { maximumFractionDigits });
}

function signedPct(value: number): string {
  if (!Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

async function fetchCryptoAdvanced<T>(path: string): Promise<T> {
  const base = import.meta.env.VITE_API_BASE_URL || "/api";
  const response = await fetch(`${base}${path}`);
  if (!response.ok) {
    throw new Error(`Crypto endpoint failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

function MetricCard({
  label,
  value,
  detail,
  tone = "text-terminal-text",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: string;
}) {
  return (
    <div className="rounded border border-terminal-border bg-terminal-bg/80 p-3">
      <div className="text-[11px] uppercase tracking-wide text-terminal-muted">{label}</div>
      <div className={`mt-1 text-lg ${tone}`}>{value}</div>
      <div className="mt-1 text-xs text-terminal-muted">{detail}</div>
    </div>
  );
}

export function CryptoWorkspacePage() {
  const navigate = useNavigate();
  const setTicker = useStockStore((s) => s.setTicker);
  const [tab, setTab] = useState<CryptoTab>("markets");
  const [moversMetric, setMoversMetric] = useState("gainers");
  const [corrWindow, setCorrWindow] = useState(30);
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState("all");
  const [sortBy, setSortBy] = useState<NonNullable<CryptoMarketsQuery["sortBy"]>>("market_cap");
  const [sortOrder, setSortOrder] = useState<NonNullable<CryptoMarketsQuery["sortOrder"]>>("desc");

  const marketsQuery = useQuery({
    queryKey: ["crypto", "markets", query, sector, sortBy, sortOrder],
    queryFn: () =>
      fetchCryptoMarkets({
        limit: 120,
        q: query || undefined,
        sector: sector === "all" ? undefined : sector,
        sortBy,
        sortOrder,
      }),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const moversQuery = useQuery({
    queryKey: ["crypto", "movers", moversMetric],
    queryFn: () => fetchCryptoMovers(moversMetric, 20),
    staleTime: 20_000,
    refetchInterval: 20_000,
  });
  const dominanceQuery = useQuery({
    queryKey: ["crypto", "dominance"],
    queryFn: fetchCryptoDominance,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const indexQuery = useQuery({
    queryKey: ["crypto", "index"],
    queryFn: () => fetchCryptoIndex(10),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const sectorsQuery = useQuery({
    queryKey: ["crypto", "sectors"],
    queryFn: fetchCryptoSectors,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const heatmapQuery = useQuery({
    queryKey: ["crypto", "heatmap"],
    queryFn: () => fetchCryptoAdvanced<HeatmapResponse>("/v1/crypto/heatmap?limit=48"),
    staleTime: 20_000,
    refetchInterval: 20_000,
  });
  const derivativesQuery = useQuery({
    queryKey: ["crypto", "derivatives"],
    queryFn: () => fetchCryptoAdvanced<DerivativesResponse>("/v1/crypto/derivatives?limit=24"),
    staleTime: 10_000,
    refetchInterval: 10_000,
  });
  const defiQuery = useQuery({
    queryKey: ["crypto", "defi"],
    queryFn: () => fetchCryptoAdvanced<DefiResponse>("/v1/crypto/defi"),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const correlationQuery = useQuery({
    queryKey: ["crypto", "correlation", corrWindow],
    queryFn: () => fetchCryptoAdvanced<CorrelationResponse>(`/v1/crypto/correlation?window=${corrWindow}&limit=8`),
    staleTime: 45_000,
    refetchInterval: 45_000,
  });

  const marketRows = marketsQuery.data || [];
  const moverRows = moversQuery.data || [];

  useEffect(() => {
    if (!marketRows.length) {
      setSelectedSymbol("");
      return;
    }
    if (!selectedSymbol || !marketRows.some((row) => row.symbol === selectedSymbol)) {
      setSelectedSymbol(marketRows[0].symbol);
    }
  }, [marketRows, selectedSymbol]);

  const selectedAsset = useMemo(
    () => marketRows.find((row) => row.symbol === selectedSymbol) ?? marketRows[0] ?? null,
    [marketRows, selectedSymbol],
  );
  const totalMarketCap = useMemo(
    () => marketRows.reduce((sum, row) => sum + (Number(row.market_cap) || 0), 0),
    [marketRows],
  );
  const totalVolume = useMemo(
    () => marketRows.reduce((sum, row) => sum + (Number(row.volume_24h) || 0), 0),
    [marketRows],
  );
  const advancers = useMemo(() => marketRows.filter((row) => row.change_24h >= 0).length, [marketRows]);
  const breadthPct = marketRows.length ? Math.round((advancers / marketRows.length) * 100) : 0;
  const sectorOptions = useMemo(() => {
    const fromSectors = (sectorsQuery.data || []).map((item) => item.sector).filter(Boolean);
    const fromMarkets = marketRows.map((row) => row.sector).filter(Boolean);
    return Array.from(new Set(["all", ...fromSectors, ...fromMarkets]));
  }, [marketRows, sectorsQuery.data]);
  const radarBoard = useMemo(() => {
    const seen = new Set<string>();
    const items: CryptoMarketRow[] = [];
    for (const row of marketRows.slice(0, 6)) {
      if (seen.has(row.symbol)) continue;
      seen.add(row.symbol);
      items.push(row);
    }
    for (const row of moverRows) {
      if (items.length >= 10) break;
      if (seen.has(row.symbol)) continue;
      seen.add(row.symbol);
      items.push({
        symbol: row.symbol,
        name: row.name,
        price: row.price,
        change_24h: row.change_24h,
        volume_24h: row.volume_24h,
        market_cap: row.market_cap,
        sector: "Rotation",
      });
    }
    return items;
  }, [marketRows, moverRows]);

  const openChart = (symbol: string) => {
    const normalized = normalizeChartSymbol(symbol);
    setSelectedSymbol(symbol);
    setTicker(normalized);
    navigate("/equity/chart-workstation");
  };

  const focusAsset = (symbol: string) => {
    setSelectedSymbol(symbol);
    setTab("markets");
  };

  const activeMeta = TAB_META[tab];
  const focusShare = selectedAsset && totalMarketCap > 0 ? (selectedAsset.market_cap / totalMarketCap) * 100 : 0;
  const focusVolumeShare = selectedAsset && totalVolume > 0 ? (selectedAsset.volume_24h / totalVolume) * 100 : 0;
  const topSector = (sectorsQuery.data || [])[0];

  function renderModule() {
    if (tab === "markets") {
      return (
        <TerminalPanel
          title={activeMeta.title}
          subtitle={activeMeta.subtitle}
          bodyClassName="space-y-3"
          actions={<TerminalBadge variant="live">{marketRows.length} symbols</TerminalBadge>}
        >
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_180px_180px_120px]">
            <TerminalInput
              aria-label="Search crypto markets"
              placeholder="Search symbol or asset"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <TerminalInput as="select" aria-label="Filter crypto sector" value={sector} onChange={(event) => setSector(event.target.value)}>
              {sectorOptions.map((option) => (
                <option key={option} value={option}>
                  {option === "all" ? "All sectors" : option}
                </option>
              ))}
            </TerminalInput>
            <TerminalInput
              as="select"
              aria-label="Sort crypto markets"
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as NonNullable<CryptoMarketsQuery["sortBy"]>)}
            >
              <option value="market_cap">Market cap</option>
              <option value="volume_24h">Volume</option>
              <option value="change_24h">24h change</option>
              <option value="price">Price</option>
              <option value="symbol">Symbol</option>
            </TerminalInput>
            <TerminalInput
              as="select"
              aria-label="Sort direction"
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value as NonNullable<CryptoMarketsQuery["sortOrder"]>)}
            >
              <option value="desc">Desc</option>
              <option value="asc">Asc</option>
            </TerminalInput>
          </div>

          {marketsQuery.isLoading ? (
            <div className="rounded border border-terminal-border bg-terminal-bg px-3 py-2 text-xs text-terminal-muted">
              Refreshing crypto market board...
            </div>
          ) : null}
          {marketsQuery.isError ? (
            <div className="rounded border border-terminal-neg bg-terminal-neg/10 px-3 py-2 text-xs text-terminal-neg">
              Failed to load market board.
            </div>
          ) : null}

          <div className="overflow-auto">
            <table className="w-full min-w-[760px] text-xs">
              <thead className="text-terminal-muted">
                <tr>
                  <th className="pb-2 text-left">Asset</th>
                  <th className="pb-2 text-right">Last</th>
                  <th className="pb-2 text-right">24h</th>
                  <th className="pb-2 text-right">Volume</th>
                  <th className="pb-2 text-right">Mkt Cap</th>
                  <th className="pb-2 text-left">Sector</th>
                  <th className="pb-2 text-right">Route</th>
                </tr>
              </thead>
              <tbody>
                {marketRows.slice(0, 28).map((row) => {
                  const isSelected = selectedAsset?.symbol === row.symbol;
                  return (
                    <tr
                      key={row.symbol}
                      className={`border-t border-terminal-border/50 ${isSelected ? "bg-terminal-accent/6" : ""}`}
                      onClick={() => setSelectedSymbol(row.symbol)}
                    >
                      <td className="py-2">
                        <button
                          type="button"
                          className="text-left text-terminal-accent hover:underline"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedSymbol(row.symbol);
                          }}
                        >
                          {row.symbol}
                        </button>
                        <div className="text-terminal-muted">{row.name}</div>
                      </td>
                      <td className="py-2 text-right text-terminal-text">{formatPrice(row.price)}</td>
                      <td className={`py-2 text-right ${pctClass(row.change_24h)}`}>{signedPct(row.change_24h)}</td>
                      <td className="py-2 text-right">{formatCurrencyCompact(row.volume_24h)}</td>
                      <td className="py-2 text-right">{formatCurrencyCompact(row.market_cap)}</td>
                      <td className="py-2">
                        <span className="rounded border border-terminal-border px-2 py-1 text-[10px] uppercase tracking-wide text-terminal-muted">
                          {row.sector || "General"}
                        </span>
                      </td>
                      <td className="py-2 text-right">
                        <TerminalButton
                          size="sm"
                          variant="ghost"
                          onClick={(event) => {
                            event.stopPropagation();
                            openChart(row.symbol);
                          }}
                        >
                          Chart
                        </TerminalButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TerminalPanel>
      );
    }

    if (tab === "movers") {
      return (
        <TerminalPanel
          title={activeMeta.title}
          subtitle={activeMeta.subtitle}
          bodyClassName="space-y-3"
          actions={(
            <TerminalInput as="select" value={moversMetric} onChange={(event) => setMoversMetric(event.target.value)} className="min-w-[140px]">
              <option value="gainers">Gainers</option>
              <option value="losers">Losers</option>
              <option value="volume">Volume</option>
              <option value="market_cap">Market Cap</option>
            </TerminalInput>
          )}
        >
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {moverRows.map((row: CryptoMoverRow) => (
              <button
                key={`${moversMetric}-${row.symbol}`}
                type="button"
                className="rounded border border-terminal-border bg-terminal-bg px-3 py-3 text-left text-xs hover:border-terminal-accent"
                onClick={() => focusAsset(row.symbol)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-terminal-accent">{row.symbol}</div>
                    <div className="text-terminal-text">{row.name}</div>
                  </div>
                  <TerminalBadge variant={row.change_24h >= 0 ? "success" : "danger"}>{signedPct(row.change_24h)}</TerminalBadge>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-terminal-muted">Price</div>
                    <div className="text-terminal-text">{formatPrice(row.price)}</div>
                  </div>
                  <div>
                    <div className="text-terminal-muted">Volume</div>
                    <div className="text-terminal-text">{formatCurrencyCompact(row.volume_24h)}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </TerminalPanel>
      );
    }

    if (tab === "index") {
      return (
        <TerminalPanel title={activeMeta.title} subtitle={activeMeta.subtitle} bodyClassName="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <MetricCard
              label="Index Value"
              value={indexQuery.data ? indexQuery.data.index_value.toFixed(2) : "--"}
              detail={indexQuery.data?.index_name || "Crypto market-cap index"}
              tone="text-terminal-accent"
            />
            <MetricCard
              label="24h Change"
              value={indexQuery.data ? signedPct(indexQuery.data.change_24h) : "--"}
              detail={`${indexQuery.data?.component_count ?? 0} components`}
              tone={indexQuery.data ? pctClass(indexQuery.data.change_24h) : "text-terminal-text"}
            />
            <MetricCard
              label="Index Market Cap"
              value={indexQuery.data ? formatCurrencyCompact(indexQuery.data.total_market_cap) : "--"}
              detail={`Top ${indexQuery.data?.top_n ?? 0} weighted basket`}
            />
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
            {marketRows.slice(0, 10).map((row) => (
              <button
                key={row.symbol}
                type="button"
                className="rounded border border-terminal-border bg-terminal-bg p-3 text-left text-xs hover:border-terminal-accent"
                onClick={() => focusAsset(row.symbol)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-terminal-accent">{row.symbol}</span>
                  <span className={pctClass(row.change_24h)}>{signedPct(row.change_24h)}</span>
                </div>
                <div className="mt-2 text-terminal-muted">{row.name}</div>
                <div className="mt-2 text-terminal-text">{formatCurrencyCompact(row.market_cap)}</div>
              </button>
            ))}
          </div>
        </TerminalPanel>
      );
    }

    if (tab === "sectors") {
      return (
        <TerminalPanel title={activeMeta.title} subtitle={activeMeta.subtitle}>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {(sectorsQuery.data || []).map((row) => (
              <div key={row.sector} className="rounded border border-terminal-border bg-terminal-bg p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-terminal-accent">{row.sector}</span>
                  <span className={pctClass(row.change_24h)}>{signedPct(row.change_24h)}</span>
                </div>
                <div className="mt-2 text-terminal-text">{formatCurrencyCompact(row.market_cap)}</div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {(row.components || []).slice(0, 4).map((component) => (
                    <button
                      key={`${row.sector}-${component.symbol}`}
                      type="button"
                      className="rounded border border-terminal-border px-2 py-1 text-[10px] text-terminal-muted hover:border-terminal-accent hover:text-terminal-text"
                      onClick={() => focusAsset(component.symbol)}
                    >
                      {component.symbol}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </TerminalPanel>
      );
    }

    if (tab === "heatmap") {
      return (
        <TerminalPanel title={activeMeta.title} subtitle={activeMeta.subtitle}>
          <CryptoHeatmapPanel items={heatmapQuery.data?.items || []} onSelect={openChart} />
        </TerminalPanel>
      );
    }

    if (tab === "derivatives") {
      return (
        <TerminalPanel title={activeMeta.title} subtitle={activeMeta.subtitle}>
          <CryptoDerivativesPanel
            rows={derivativesQuery.data?.items || []}
            totals={
              derivativesQuery.data?.totals || {
                open_interest_usd: 0,
                long_liquidations_24h: 0,
                short_liquidations_24h: 0,
                liquidations_24h: 0,
              }
            }
            onSelect={openChart}
          />
        </TerminalPanel>
      );
    }

    if (tab === "defi") {
      return (
        <TerminalPanel title={activeMeta.title} subtitle={activeMeta.subtitle}>
          <CryptoDefiPanel
            headline={
              defiQuery.data?.headline || {
                tvl_usd: 0,
                dex_volume_24h: 0,
                lending_borrowed_usd: 0,
                defi_change_24h: 0,
              }
            }
            protocols={defiQuery.data?.protocols || []}
            onSelect={openChart}
          />
        </TerminalPanel>
      );
    }

    return (
      <TerminalPanel
        title={activeMeta.title}
        subtitle={activeMeta.subtitle}
        actions={(
          <TerminalInput as="select" value={corrWindow} onChange={(event) => setCorrWindow(Number(event.target.value))} className="min-w-[100px]">
            <option value={14}>14d</option>
            <option value={30}>30d</option>
            <option value={60}>60d</option>
            <option value={90}>90d</option>
          </TerminalInput>
        )}
      >
        <CryptoCorrelationMatrixPanel data={{ symbols: correlationQuery.data?.symbols || [], matrix: correlationQuery.data?.matrix || [] }} />
      </TerminalPanel>
    );
  }

  return (
    <div className="space-y-3 p-3">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.95fr)]">
        <div className="rounded border border-terminal-border bg-[radial-gradient(circle_at_top_left,rgba(38,140,255,0.16),transparent_42%),linear-gradient(180deg,rgba(12,16,21,0.96),rgba(10,13,18,0.98))] p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1">
                <TerminalBadge variant="accent">crypto</TerminalBadge>
                <TerminalBadge variant="info">command center</TerminalBadge>
                <TerminalBadge variant="live">live market map</TerminalBadge>
              </div>
              <div>
                <div className="ot-type-heading-lg text-terminal-text">Crypto Command Center</div>
                <div className="max-w-3xl text-xs text-terminal-muted">
                  TradingView-style crypto navigation with a focus asset, ranked market board, mover radar, and direct entry into heatmap, derivatives, DeFi, and correlation modules.
                </div>
              </div>
            </div>

            <div className="w-full max-w-[360px] rounded border border-terminal-border bg-terminal-bg/80 p-2">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-[11px] uppercase tracking-wide text-terminal-muted">Active module</div>
                <TerminalBadge variant="neutral">{tab}</TerminalBadge>
              </div>
              <div className="flex flex-wrap gap-1">
                {(["markets", "movers", "index", "sectors", "heatmap", "derivatives", "defi", "correlation"] as CryptoTab[]).map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTab(id)}
                    className={`rounded border px-2 py-1 text-xs uppercase ${
                      tab === id
                        ? "border-terminal-accent bg-terminal-accent/20 text-terminal-accent"
                        : "border-terminal-border text-terminal-muted hover:border-terminal-accent hover:text-terminal-text"
                    }`}
                  >
                    {id}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Dominance"
              value={dominanceQuery.data ? `${dominanceQuery.data.btc_pct.toFixed(1)} / ${dominanceQuery.data.eth_pct.toFixed(1)}` : "--"}
              detail={dominanceQuery.data ? `BTC / ETH with ${dominanceQuery.data.others_pct.toFixed(1)}% others` : "BTC / ETH / Others"}
              tone="text-terminal-accent"
            />
            <MetricCard
              label="Market Cap"
              value={formatCurrencyCompact(dominanceQuery.data?.total_market_cap || totalMarketCap)}
              detail={`${marketRows.length} ranked assets`}
            />
            <MetricCard
              label="24h Breadth"
              value={`${breadthPct}%`}
              detail={`${advancers} up / ${Math.max(marketRows.length - advancers, 0)} down`}
              tone={breadthPct >= 50 ? "text-terminal-pos" : "text-terminal-neg"}
            />
            <MetricCard
              label="Index"
              value={indexQuery.data ? indexQuery.data.index_value.toFixed(2) : "--"}
              detail={indexQuery.data ? signedPct(indexQuery.data.change_24h) : "Top 10 weighted basket"}
              tone={indexQuery.data ? pctClass(indexQuery.data.change_24h) : "text-terminal-text"}
            />
          </div>
        </div>

        <TerminalPanel
          title="Focus Asset"
          subtitle={selectedAsset ? `${selectedAsset.name} | ${selectedAsset.sector}` : "Awaiting market data"}
          bodyClassName="space-y-3"
          actions={<TerminalBadge variant={selectedAsset && selectedAsset.change_24h >= 0 ? "success" : "danger"}>{selectedAsset ? signedPct(selectedAsset.change_24h) : "--"}</TerminalBadge>}
        >
          {selectedAsset ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xl text-terminal-accent">{selectedAsset.symbol}</div>
                  <div className="text-xs text-terminal-muted">{selectedAsset.name}</div>
                </div>
                <div className="text-right">
                  <div className="text-lg text-terminal-text">{formatPrice(selectedAsset.price)}</div>
                  <div className={`text-xs ${pctClass(selectedAsset.change_24h)}`}>{signedPct(selectedAsset.change_24h)}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded border border-terminal-border bg-terminal-bg p-2">
                  <div className="text-terminal-muted">24h Volume</div>
                  <div className="text-terminal-text">{formatCurrencyCompact(selectedAsset.volume_24h)}</div>
                </div>
                <div className="rounded border border-terminal-border bg-terminal-bg p-2">
                  <div className="text-terminal-muted">Market Cap</div>
                  <div className="text-terminal-text">{formatCurrencyCompact(selectedAsset.market_cap)}</div>
                </div>
                <div className="rounded border border-terminal-border bg-terminal-bg p-2">
                  <div className="text-terminal-muted">Universe Share</div>
                  <div className="text-terminal-text">{focusShare.toFixed(2)}%</div>
                </div>
                <div className="rounded border border-terminal-border bg-terminal-bg p-2">
                  <div className="text-terminal-muted">Volume Share</div>
                  <div className="text-terminal-text">{focusVolumeShare.toFixed(2)}%</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <TerminalButton variant="accent" onClick={() => openChart(selectedAsset.symbol)}>Open Chart</TerminalButton>
                <TerminalButton variant="default" onClick={() => setTab("movers")}>Mover Tape</TerminalButton>
                <TerminalButton variant="default" onClick={() => setTab("heatmap")}>Depth Heatmap</TerminalButton>
                <TerminalButton variant="default" onClick={() => setTab("derivatives")}>Derivatives</TerminalButton>
              </div>
            </>
          ) : (
            <div className="text-xs text-terminal-muted">No focus asset available for the current search and sector filter.</div>
          )}
        </TerminalPanel>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.9fr)]">
        <div>{renderModule()}</div>

        <div className="space-y-3">
          <TerminalPanel title="Radar Board" subtitle="Leaders, liquid names, and desk watchlist" bodyClassName="space-y-3">
            <div className="space-y-1">
              {radarBoard.slice(0, 8).map((row) => (
                <button
                  key={`radar-${row.symbol}`}
                  type="button"
                  className={`flex w-full items-center justify-between rounded border px-2 py-2 text-left text-xs ${
                    selectedAsset?.symbol === row.symbol
                      ? "border-terminal-accent bg-terminal-accent/10"
                      : "border-terminal-border bg-terminal-bg hover:border-terminal-accent"
                  }`}
                  onClick={() => focusAsset(row.symbol)}
                >
                  <span>
                    <span className="block text-terminal-accent">{row.symbol}</span>
                    <span className="block text-terminal-muted">{row.name}</span>
                  </span>
                  <span className={`text-right ${pctClass(row.change_24h)}`}>{signedPct(row.change_24h)}</span>
                </button>
              ))}
            </div>

            <div className="border-t border-terminal-border/50 pt-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[11px] uppercase tracking-wide text-terminal-muted">Mover queue</span>
                <TerminalInput as="select" value={moversMetric} onChange={(event) => setMoversMetric(event.target.value)} className="w-32">
                  <option value="gainers">Gainers</option>
                  <option value="losers">Losers</option>
                  <option value="volume">Volume</option>
                  <option value="market_cap">Market Cap</option>
                </TerminalInput>
              </div>
              <div className="space-y-1">
                {moverRows.slice(0, 5).map((row) => (
                  <div key={`mover-queue-${row.symbol}`} className="flex items-center justify-between rounded border border-terminal-border bg-terminal-bg px-2 py-2 text-xs">
                    <button type="button" className="text-left text-terminal-text hover:text-terminal-accent" onClick={() => focusAsset(row.symbol)}>
                      <span className="block text-terminal-accent">{row.symbol}</span>
                      <span className="block text-terminal-muted">{row.name}</span>
                    </button>
                    <span className={pctClass(row.change_24h)}>{signedPct(row.change_24h)}</span>
                  </div>
                ))}
              </div>
            </div>
          </TerminalPanel>

          <TerminalPanel title="Sector Rotation" subtitle="Current leadership and desk pivots" bodyClassName="space-y-2">
            {topSector ? (
              <div className="rounded border border-terminal-border bg-terminal-bg p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-terminal-accent">{topSector.sector}</div>
                  <div className={pctClass(topSector.change_24h)}>{signedPct(topSector.change_24h)}</div>
                </div>
                <div className="mt-2 text-terminal-text">{formatCurrencyCompact(topSector.market_cap)}</div>
                <div className="mt-2 text-terminal-muted">
                  {(topSector.components || []).slice(0, 4).map((row) => row.symbol).join(", ") || "No components"}
                </div>
              </div>
            ) : (
              <div className="text-xs text-terminal-muted">Sector baskets are refreshing.</div>
            )}

            {(sectorsQuery.data || []).slice(0, 4).map((row) => (
              <button
                key={`sector-${row.sector}`}
                type="button"
                className="flex w-full items-center justify-between rounded border border-terminal-border bg-terminal-bg px-2 py-2 text-left text-xs hover:border-terminal-accent"
                onClick={() => {
                  setSector(row.sector);
                  setTab("markets");
                }}
              >
                <span>
                  <span className="block text-terminal-text">{row.sector}</span>
                  <span className="block text-terminal-muted">{(row.components || []).slice(0, 3).map((item) => item.symbol).join(", ")}</span>
                </span>
                <span className={pctClass(row.change_24h)}>{signedPct(row.change_24h)}</span>
              </button>
            ))}

            <div className="grid grid-cols-2 gap-2">
              <TerminalButton variant="default" onClick={() => setTab("heatmap")}>Open Heatmap</TerminalButton>
              <TerminalButton variant="default" onClick={() => setTab("correlation")}>Open Correlation</TerminalButton>
            </div>
          </TerminalPanel>
        </div>
      </div>
    </div>
  );
}
