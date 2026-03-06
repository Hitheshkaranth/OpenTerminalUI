import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import {
  fetchCryptoDominance,
  fetchCryptoIndex,
  fetchCryptoMarkets,
  fetchCryptoMovers,
  fetchCryptoSectors,
  type CryptoMoverRow,
} from "../api/client";
import { CryptoCorrelationMatrixPanel } from "../components/crypto/CryptoCorrelationMatrixPanel";
import { CryptoDefiPanel } from "../components/crypto/CryptoDefiPanel";
import { CryptoDerivativesPanel } from "../components/crypto/CryptoDerivativesPanel";
import { CryptoHeatmapPanel } from "../components/crypto/CryptoHeatmapPanel";
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

function pctClass(v: number): string {
  return v >= 0 ? "text-terminal-pos" : "text-terminal-neg";
}

async function fetchCryptoAdvanced<T>(path: string): Promise<T> {
  const base = import.meta.env.VITE_API_BASE_URL || "/api";
  const response = await fetch(`${base}${path}`);
  if (!response.ok) {
    throw new Error(`Crypto endpoint failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export function CryptoWorkspacePage() {
  const navigate = useNavigate();
  const setTicker = useStockStore((s) => s.setTicker);
  const [tab, setTab] = useState<CryptoTab>("markets");
  const [moversMetric, setMoversMetric] = useState("gainers");
  const [corrWindow, setCorrWindow] = useState(30);

  const marketsQuery = useQuery({
    queryKey: ["crypto", "markets"],
    queryFn: () => fetchCryptoMarkets(60),
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

  const topWatchlist = useMemo(() => (marketsQuery.data || []).slice(0, 12), [marketsQuery.data]);

  const openChart = (symbol: string) => {
    const normalized = symbol.replace("-USD", "").toUpperCase();
    setTicker(normalized);
    navigate("/equity/chart-workstation");
  };

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="ot-type-heading-lg text-terminal-text">Crypto Workspace</div>
          <div className="text-xs text-terminal-muted">Markets, movers, dominance, index, sectors, and advanced analytics</div>
        </div>
        <div className="inline-flex items-center gap-1 rounded border border-terminal-border bg-terminal-panel p-1">
          {(["markets", "movers", "index", "sectors", "heatmap", "derivatives", "defi", "correlation"] as CryptoTab[]).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded px-2 py-1 text-xs uppercase ${
                tab === id ? "bg-terminal-accent/20 text-terminal-accent" : "text-terminal-muted hover:text-terminal-text"
              }`}
            >
              {id}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <TerminalPanel title="Dominance" subtitle="BTC / ETH / Others">
          {dominanceQuery.data ? (
            <div className="space-y-2 text-xs">
              <div>BTC: <span className="text-terminal-accent">{dominanceQuery.data.btc_pct.toFixed(2)}%</span></div>
              <div>ETH: <span className="text-terminal-accent">{dominanceQuery.data.eth_pct.toFixed(2)}%</span></div>
              <div>Others: <span className="text-terminal-muted">{dominanceQuery.data.others_pct.toFixed(2)}%</span></div>
            </div>
          ) : (
            <div className="text-xs text-terminal-muted">Loading...</div>
          )}
        </TerminalPanel>

        <TerminalPanel title="Market Index" subtitle="Top 10 weighted">
          {indexQuery.data ? (
            <div className="space-y-1 text-xs">
              <div className="text-terminal-text">{indexQuery.data.index_name}</div>
              <div className="text-xl text-terminal-accent">{indexQuery.data.index_value.toFixed(2)}</div>
              <div className={pctClass(indexQuery.data.change_24h)}>{indexQuery.data.change_24h.toFixed(2)}%</div>
            </div>
          ) : (
            <div className="text-xs text-terminal-muted">Loading...</div>
          )}
        </TerminalPanel>

        <TerminalPanel title="Watchlist" subtitle="Top market-cap assets" bodyClassName="space-y-1">
          {topWatchlist.map((row) => (
            <button
              key={row.symbol}
              type="button"
              className="flex w-full items-center justify-between rounded border border-terminal-border px-2 py-1 text-left text-xs hover:border-terminal-accent"
              onClick={() => openChart(row.symbol)}
            >
              <span className="text-terminal-text">{row.symbol}</span>
              <span className={pctClass(row.change_24h)}>{row.change_24h.toFixed(2)}%</span>
            </button>
          ))}
        </TerminalPanel>
      </div>

      {tab === "markets" ? (
        <TerminalPanel title="Crypto Markets" subtitle="Normalized market board" bodyClassName="overflow-auto">
          <table className="w-full text-xs">
            <thead className="text-terminal-muted">
              <tr>
                <th className="text-left">Symbol</th>
                <th className="text-right">Price</th>
                <th className="text-right">24h</th>
                <th className="text-right">Volume</th>
                <th className="text-left">Sector</th>
              </tr>
            </thead>
            <tbody>
              {(marketsQuery.data || []).slice(0, 40).map((row) => (
                <tr key={row.symbol} className="border-t border-terminal-border/50">
                  <td>
                    <button className="text-terminal-accent hover:underline" onClick={() => openChart(row.symbol)}>
                      {row.symbol}
                    </button>
                  </td>
                  <td className="text-right">{row.price.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                  <td className={`text-right ${pctClass(row.change_24h)}`}>{row.change_24h.toFixed(2)}%</td>
                  <td className="text-right">{Math.round(row.volume_24h).toLocaleString()}</td>
                  <td>{row.sector}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TerminalPanel>
      ) : null}

      {tab === "movers" ? (
        <TerminalPanel
          title="Movers"
          subtitle="Leaders and laggards"
          actions={(
            <select
              className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs text-terminal-text"
              value={moversMetric}
              onChange={(e) => setMoversMetric(e.target.value)}
            >
              <option value="gainers">Gainers</option>
              <option value="losers">Losers</option>
              <option value="volume">Volume</option>
              <option value="market_cap">Market Cap</option>
            </select>
          )}
        >
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-4">
            {(moversQuery.data || []).map((row: CryptoMoverRow) => (
              <button
                key={`${moversMetric}-${row.symbol}`}
                type="button"
                className="rounded border border-terminal-border bg-terminal-bg px-2 py-2 text-left text-xs hover:border-terminal-accent"
                onClick={() => openChart(row.symbol)}
              >
                <div className="text-terminal-accent">{row.symbol}</div>
                <div className="text-terminal-text">{row.name}</div>
                <div className={pctClass(row.change_24h)}>{row.change_24h.toFixed(2)}%</div>
              </button>
            ))}
          </div>
        </TerminalPanel>
      ) : null}

      {tab === "index" ? (
        <TerminalPanel title="Index Components" subtitle="Top-cap proxy basket">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-5">
            {(marketsQuery.data || []).slice(0, 10).map((row) => (
              <div key={row.symbol} className="rounded border border-terminal-border bg-terminal-bg p-2 text-xs">
                <div className="text-terminal-accent">{row.symbol}</div>
                <div className={pctClass(row.change_24h)}>{row.change_24h.toFixed(2)}%</div>
              </div>
            ))}
          </div>
        </TerminalPanel>
      ) : null}

      {tab === "sectors" ? (
        <TerminalPanel title="Sector Baskets" subtitle="L1 / DeFi / Memes / AI / Gaming / RWA">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {(sectorsQuery.data || []).map((sector) => (
              <div key={sector.sector} className="rounded border border-terminal-border bg-terminal-bg p-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-terminal-accent">{sector.sector}</span>
                  <span className={pctClass(sector.change_24h)}>{sector.change_24h.toFixed(2)}%</span>
                </div>
                <div className="mt-1 text-terminal-muted">
                  {(sector.components || []).map((c) => c.symbol).join(", ") || "No components"}
                </div>
              </div>
            ))}
          </div>
        </TerminalPanel>
      ) : null}

      {tab === "heatmap" ? (
        <TerminalPanel title="Heatmap + Depth" subtitle="Sector-colored market map with order-book pressure">
          <CryptoHeatmapPanel items={heatmapQuery.data?.items || []} onSelect={openChart} />
        </TerminalPanel>
      ) : null}

      {tab === "derivatives" ? (
        <TerminalPanel title="Derivatives" subtitle="Funding and liquidation aggregation">
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
          />
        </TerminalPanel>
      ) : null}

      {tab === "defi" ? (
        <TerminalPanel title="DeFi Dashboard" subtitle="TVL, DEX flow, lending, and protocol leadership">
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
          />
        </TerminalPanel>
      ) : null}

      {tab === "correlation" ? (
        <TerminalPanel
          title="Correlation Matrix"
          subtitle="Rolling return relationship map"
          actions={(
            <select
              className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs text-terminal-text"
              value={corrWindow}
              onChange={(e) => setCorrWindow(Number(e.target.value))}
            >
              <option value={14}>14d</option>
              <option value={30}>30d</option>
              <option value={60}>60d</option>
              <option value={90}>90d</option>
            </select>
          )}
        >
          <CryptoCorrelationMatrixPanel data={{ symbols: correlationQuery.data?.symbols || [], matrix: correlationQuery.data?.matrix || [] }} />
        </TerminalPanel>
      ) : null}
    </div>
  );
}
