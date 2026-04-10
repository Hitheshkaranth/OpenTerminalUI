import { useEffect, useMemo, useRef, useState } from "react";
import { ResponsiveHeatMap } from "@nivo/heatmap";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  fetchCorrelationClusters,
  fetchCorrelationMatrix,
  fetchPortfolio,
  fetchRollingCorrelation,
  searchSymbols,
  type SearchSymbolItem,
} from "../api/client";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { TerminalInput } from "../components/terminal/TerminalInput";
import type {
  CorrelationCluster,
  CorrelationClustersResponse,
  CorrelationMatrixResponse,
  CorrelationRollingResponse,
} from "../types";

type DashboardTab = "matrix" | "rolling" | "clusters";
type MatrixPeriod = "1M" | "3M" | "6M" | "1Y" | "3Y";
type RollingPeriod = "1Y" | "3Y";

const DEFAULT_SYMBOLS = ["RELIANCE", "TCS", "HDFCBANK", "ICICIBANK", "INFY"];
const BANK_STOCKS = ["HDFCBANK", "ICICIBANK", "SBIN", "AXISBANK", "KOTAKBANK"];
const IT_STOCKS = ["TCS", "INFY", "WIPRO", "HCLTECH", "TECHM"];
const NIFTY_TOP_10 = ["RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "HINDUNILVR", "ITC", "SBIN", "LT", "BHARTIARTL"];
const PERIOD_OPTIONS: MatrixPeriod[] = ["1M", "3M", "6M", "1Y", "3Y"];
const WINDOW_OPTIONS = [20, 30, 60, 90, 120];
const CLUSTER_COLORS = ["#5B8FF9", "#26A65B", "#F39C12", "#E84142", "#00B7C3", "#8E5AFF", "#F26B8A", "#8892B0"];

function addUniqueSymbols(current: string[], incoming: string[]): string[] {
  const merged = [...current];
  for (const symbol of incoming) {
    const normalized = symbol.trim().toUpperCase();
    if (!normalized || merged.includes(normalized)) continue;
    if (merged.length >= 20) break;
    merged.push(normalized);
  }
  return merged;
}

function formatPct(value: number): string {
  return `${value.toFixed(2)}`;
}

function clusterBadgeColor(index: number): string {
  return CLUSTER_COLORS[index % CLUSTER_COLORS.length];
}

export function CorrelationDashboardPage() {
  const [tab, setTab] = useState<DashboardTab>("matrix");
  const [symbols, setSymbols] = useState<string[]>(DEFAULT_SYMBOLS);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SearchSymbolItem[]>([]);
  const [portfolioSymbols, setPortfolioSymbols] = useState<string[]>([]);
  const [loadingPortfolio, setLoadingPortfolio] = useState(false);
  const [matrixPeriod, setMatrixPeriod] = useState<MatrixPeriod>("1Y");
  const [rollingPeriod, setRollingPeriod] = useState<RollingPeriod>("3Y");
  const [windowSize, setWindowSize] = useState(60);
  const [clusterCount, setClusterCount] = useState(4);
  const [selectedPair, setSelectedPair] = useState<[string, string]>([DEFAULT_SYMBOLS[0], DEFAULT_SYMBOLS[1]]);
  const [matrix, setMatrix] = useState<CorrelationMatrixResponse | null>(null);
  const [rolling, setRolling] = useState<CorrelationRollingResponse | null>(null);
  const [clusters, setClusters] = useState<CorrelationClustersResponse | null>(null);
  const [matrixLoading, setMatrixLoading] = useState(false);
  const [rollingLoading, setRollingLoading] = useState(false);
  const [clustersLoading, setClustersLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingPortfolio(true);
    fetchPortfolio()
      .then((data) => {
        if (cancelled) return;
        const next = Array.from(new Set((data.items ?? []).map((item) => item.ticker?.toUpperCase()).filter(Boolean)));
        setPortfolioSymbols(next);
      })
      .catch(() => {
        if (!cancelled) setPortfolioSymbols([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingPortfolio(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (symbols.length < 2) return;
    if (!symbols.includes(selectedPair[0]) || !symbols.includes(selectedPair[1]) || selectedPair[0] === selectedPair[1]) {
      setSelectedPair([symbols[0], symbols[1]]);
    }
  }, [symbols, selectedPair]);

  useEffect(() => {
    if (!query.trim()) {
      setSuggestions([]);
      return;
    }
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      searchSymbols(query, "NSE")
        .then((results) => setSuggestions(results.slice(0, 8)))
        .catch(() => setSuggestions([]));
    }, 250);
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [query]);

  useEffect(() => {
    if (symbols.length < 2) {
      setMatrix(null);
      return;
    }
    let cancelled = false;
    setMatrixLoading(true);
    setError(null);
    fetchCorrelationMatrix({ symbols, period: matrixPeriod, frequency: "daily" })
      .then((data) => {
        if (!cancelled) setMatrix(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setMatrix(null);
        setError(err instanceof Error ? err.message : "Failed to load correlation matrix");
      })
      .finally(() => {
        if (!cancelled) setMatrixLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbols, matrixPeriod]);

  useEffect(() => {
    if (tab !== "rolling" || symbols.length < 2 || !selectedPair[0] || !selectedPair[1] || selectedPair[0] === selectedPair[1]) {
      return;
    }
    let cancelled = false;
    setRollingLoading(true);
    setError(null);
    fetchRollingCorrelation({
      symbol1: selectedPair[0],
      symbol2: selectedPair[1],
      window: windowSize,
      period: rollingPeriod,
    })
      .then((data) => {
        if (!cancelled) setRolling(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setRolling(null);
        setError(err instanceof Error ? err.message : "Failed to load rolling correlation");
      })
      .finally(() => {
        if (!cancelled) setRollingLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, selectedPair, windowSize, rollingPeriod, symbols]);

  useEffect(() => {
    if (tab !== "clusters" || symbols.length < 2) return;
    let cancelled = false;
    setClustersLoading(true);
    setError(null);
    fetchCorrelationClusters({ symbols, period: matrixPeriod, n_clusters: clusterCount })
      .then((data) => {
        if (!cancelled) setClusters(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setClusters(null);
        setError(err instanceof Error ? err.message : "Failed to load correlation clusters");
      })
      .finally(() => {
        if (!cancelled) setClustersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, symbols, matrixPeriod, clusterCount]);

  const heatmapData = useMemo(
    () =>
      (matrix?.symbols ?? []).map((rowSymbol, rowIndex) => ({
        id: rowSymbol,
        data: (matrix?.symbols ?? []).map((colSymbol, colIndex) => ({
          x: colSymbol,
          y: matrix?.matrix?.[rowIndex]?.[colIndex] ?? 0,
        })),
      })),
    [matrix],
  );

  const decorrelatedPairs = useMemo(() => {
    if (!matrix) return [];
    const pairs: Array<{ pair: string; value: number }> = [];
    for (let rowIndex = 0; rowIndex < matrix.symbols.length; rowIndex += 1) {
      for (let colIndex = rowIndex + 1; colIndex < matrix.symbols.length; colIndex += 1) {
        pairs.push({
          pair: `${matrix.symbols[rowIndex]} / ${matrix.symbols[colIndex]}`,
          value: matrix.matrix[rowIndex][colIndex],
        });
      }
    }
    return pairs.sort((left, right) => left.value - right.value).slice(0, 5);
  }, [matrix]);

  const addSymbol = (value: string) => {
    setSymbols((current) => addUniqueSymbols(current, [value]));
    setQuery("");
    setSuggestions([]);
  };

  const addSymbolGroup = (nextSymbols: string[]) => {
    setSymbols((current) => addUniqueSymbols(current, nextSymbols));
  };

  const onMatrixCellClick = (rowSymbol: string, colSymbol: string) => {
    if (rowSymbol === colSymbol) return;
    setSelectedPair([rowSymbol, colSymbol]);
    setTab("rolling");
  };

  const clusterCards = (clusters?.clusters ?? []) as CorrelationCluster[];

  return (
    <div className="space-y-4 p-4 font-mono">
      <TerminalPanel
        title="Correlation Dashboard"
        subtitle="Cross-asset co-movement, rolling stability, and cluster structure"
        actions={<div className="text-[10px] uppercase text-terminal-muted">{symbols.length}/20 symbols</div>}
      >
        <div className="space-y-3">
          <div className="relative">
            <div className="flex flex-wrap gap-2 rounded border border-terminal-border bg-terminal-bg p-2">
              {symbols.map((symbol) => (
                <span
                  key={symbol}
                  className="inline-flex items-center gap-2 rounded border border-terminal-accent/40 bg-terminal-accent/10 px-2 py-1 text-[11px] text-terminal-accent"
                >
                  {symbol}
                  <button
                    type="button"
                    className="text-terminal-muted transition-colors hover:text-terminal-neg"
                    onClick={() => setSymbols((current) => current.filter((item) => item !== symbol))}
                    aria-label={`Remove ${symbol}`}
                  >
                    X
                  </button>
                </span>
              ))}
              <div className="min-w-[220px] flex-1">
                <TerminalInput
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={symbols.length >= 20 ? "Max 20 symbols reached" : "Add symbol..."}
                  disabled={symbols.length >= 20}
                  className="border-0 bg-transparent px-0 py-1 focus:border-0"
                  data-testid="correlation-symbol-input"
                />
              </div>
            </div>
            {suggestions.length > 0 ? (
              <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded border border-terminal-border bg-terminal-panel shadow-2xl">
                {suggestions.map((item) => (
                  <button
                    key={`${item.ticker}-${item.exchange ?? ""}`}
                    type="button"
                    className="flex w-full items-center justify-between border-b border-terminal-border/40 px-3 py-2 text-left text-xs text-terminal-muted hover:bg-terminal-bg hover:text-terminal-text"
                    onClick={() => addSymbol(item.ticker)}
                  >
                    <span className="font-semibold text-terminal-text">{item.ticker}</span>
                    <span className="truncate pl-3 text-[10px]">{item.name}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <TerminalButton size="sm" onClick={() => addSymbolGroup(NIFTY_TOP_10)}>Nifty 50 Top 10</TerminalButton>
            <TerminalButton size="sm" onClick={() => addSymbolGroup(portfolioSymbols)} disabled={loadingPortfolio || portfolioSymbols.length === 0}>
              My Portfolio
            </TerminalButton>
            <TerminalButton size="sm" onClick={() => addSymbolGroup(BANK_STOCKS)}>Bank Stocks</TerminalButton>
            <TerminalButton size="sm" onClick={() => addSymbolGroup(IT_STOCKS)}>IT Stocks</TerminalButton>
          </div>
        </div>
      </TerminalPanel>

      <div className="flex flex-wrap items-center gap-2">
        {([
          ["matrix", "Matrix"],
          ["rolling", "Rolling"],
          ["clusters", "Clusters"],
        ] as Array<[DashboardTab, string]>).map(([tabKey, label]) => (
          <TerminalButton
            key={tabKey}
            size="sm"
            variant={tab === tabKey ? "accent" : "default"}
            onClick={() => setTab(tabKey)}
          >
            {label}
          </TerminalButton>
        ))}
      </div>

      {error ? <div className="rounded border border-terminal-neg bg-terminal-neg/10 p-3 text-xs text-terminal-neg">{error}</div> : null}

      {tab === "matrix" ? (
        <TerminalPanel
          title="Correlation Matrix"
          subtitle={matrix ? `${matrix.period_start} to ${matrix.period_end}` : "Daily Pearson correlation"}
          actions={
            <div className="flex gap-2">
              {PERIOD_OPTIONS.map((period) => (
                <TerminalButton
                  key={period}
                  size="sm"
                  variant={matrixPeriod === period ? "accent" : "default"}
                  onClick={() => setMatrixPeriod(period)}
                >
                  {period}
                </TerminalButton>
              ))}
            </div>
          }
          bodyClassName="p-0"
        >
          <div className="h-[640px] p-3" data-testid="correlation-matrix-heatmap">
            {matrixLoading ? (
              <div className="flex h-full items-center justify-center text-xs text-terminal-muted">Loading matrix...</div>
            ) : matrix && matrix.symbols.length >= 2 ? (
              <ResponsiveHeatMap
                data={heatmapData as any}
                margin={{ top: 72, right: 80, bottom: 50, left: 80 }}
                valueFormat={(value: number) => Number(value).toFixed(2)}
                axisTop={{ tickSize: 0, tickPadding: 8, tickRotation: -35 }}
                axisLeft={{ tickSize: 0, tickPadding: 8 }}
                colors={{
                  type: "diverging",
                  scheme: "red_yellow_blue",
                  divergeAt: 0.5,
                  minValue: -1,
                  maxValue: 1,
                }}
                emptyColor="#10141d"
                borderColor={(cell: any) => (cell.serieId === cell.data.x ? "#ffffff" : "#1f2937")}
                borderWidth={(cell: any) => (cell.serieId === cell.data.x ? 2 : 1)}
                labelTextColor={{ from: "color", modifiers: [["darker", 3.2]] }}
                cellOpacity={1}
                cellHoverOthersOpacity={0.3}
                animate={false}
                enableLabels
                onClick={(cell: any) => onMatrixCellClick(String(cell.serieId), String(cell.data.x))}
                tooltip={({ cell }: any) => (
                  <div className="rounded border border-terminal-border bg-terminal-panel px-2 py-1 text-[10px] text-terminal-text">
                    {cell.serieId} / {cell.data.x}: {Number(cell.value).toFixed(2)}
                  </div>
                )}
                theme={{
                  axis: {
                    ticks: {
                      text: { fill: "#93a0b8", fontSize: 10 },
                    },
                  },
                  labels: {
                    text: { fill: "#f6f7fb", fontSize: 10, fontWeight: 700 },
                  },
                  grid: {
                    line: { stroke: "#1f2937" },
                  },
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-terminal-muted">Add at least two symbols to render the matrix.</div>
            )}
          </div>
        </TerminalPanel>
      ) : null}

      {tab === "rolling" ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <TerminalPanel
            title="Rolling Correlation"
            subtitle={`${selectedPair[0]} vs ${selectedPair[1]}`}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <TerminalInput
                  as="select"
                  size="sm"
                  value={selectedPair[0]}
                  onChange={(event) => setSelectedPair([event.target.value, selectedPair[1]])}
                >
                  {symbols.map((symbol) => (
                    <option key={`left-${symbol}`} value={symbol}>{symbol}</option>
                  ))}
                </TerminalInput>
                <TerminalInput
                  as="select"
                  size="sm"
                  value={selectedPair[1]}
                  onChange={(event) => setSelectedPair([selectedPair[0], event.target.value])}
                >
                  {symbols.map((symbol) => (
                    <option key={`right-${symbol}`} value={symbol}>{symbol}</option>
                  ))}
                </TerminalInput>
                <TerminalInput
                  as="select"
                  size="sm"
                  value={String(windowSize)}
                  onChange={(event) => setWindowSize(Number(event.target.value))}
                >
                  {WINDOW_OPTIONS.map((window) => (
                    <option key={window} value={window}>{window}D</option>
                  ))}
                </TerminalInput>
                <TerminalInput
                  as="select"
                  size="sm"
                  value={rollingPeriod}
                  onChange={(event) => setRollingPeriod(event.target.value as RollingPeriod)}
                >
                  <option value="1Y">1Y</option>
                  <option value="3Y">3Y</option>
                </TerminalInput>
              </div>
            }
            bodyClassName="p-0"
          >
            <div className="h-[520px] p-3" data-testid="correlation-rolling-chart">
              {rollingLoading ? (
                <div className="flex h-full items-center justify-center text-xs text-terminal-muted">Loading rolling series...</div>
              ) : rolling ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rolling.series}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    {(rolling.regimes ?? []).map((regime, index) => (
                      <ReferenceArea
                        key={`${regime.start}-${regime.end}-${index}`}
                        x1={regime.start}
                        x2={regime.end}
                        fill={regime.label === "high" ? "#26A65B" : regime.label === "medium" ? "#F1C40F" : "#E84142"}
                        fillOpacity={0.12}
                        strokeOpacity={0}
                      />
                    ))}
                    <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" />
                    <ReferenceLine y={0.5} stroke="#5B8FF9" strokeDasharray="4 4" />
                    <ReferenceLine y={-0.5} stroke="#E84142" strokeDasharray="4 4" />
                    <XAxis dataKey="date" minTickGap={48} stroke="#93a0b8" tick={{ fill: "#93a0b8", fontSize: 10 }} />
                    <YAxis domain={[-1, 1]} stroke="#93a0b8" tick={{ fill: "#93a0b8", fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#0d1117", border: "1px solid #273142", fontSize: "10px" }}
                      formatter={(value: number | string | undefined) => [Number(value ?? 0).toFixed(2), "Correlation"]}
                    />
                    <Line type="monotone" dataKey="correlation" stroke="#5B8FF9" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-terminal-muted">Select two symbols to load rolling correlation.</div>
              )}
            </div>
          </TerminalPanel>

          <TerminalPanel title="Stats" subtitle="Current rolling profile">
            <div className="grid grid-cols-2 gap-3">
              {([
                ["Current", rolling?.current],
                ["Average", rolling?.avg],
                ["Min", rolling?.min],
                ["Max", rolling?.max],
              ] as Array<[string, number | undefined]>).map(([label, value]) => (
                <div key={label} className="rounded border border-terminal-border bg-terminal-bg p-3">
                  <div className="text-[10px] uppercase text-terminal-muted">{label}</div>
                  <div className="mt-1 text-lg font-semibold text-terminal-text">{value == null ? "-" : formatPct(value)}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-2">
              {(rolling?.regimes ?? []).map((regime) => (
                <div key={`${regime.start}-${regime.end}`} className="rounded border border-terminal-border/60 bg-terminal-bg px-3 py-2 text-[11px]">
                  <div className="flex items-center justify-between text-terminal-text">
                    <span className="uppercase">{regime.label}</span>
                    <span>{regime.avg_correlation.toFixed(2)}</span>
                  </div>
                  <div className="mt-1 text-[10px] text-terminal-muted">{regime.start} to {regime.end}</div>
                </div>
              ))}
            </div>
          </TerminalPanel>
        </div>
      ) : null}

      {tab === "clusters" ? (
        <div className="space-y-4">
          <TerminalPanel
            title="Hierarchical Clusters"
            subtitle="Average-linkage groups from 1 - correlation distance"
            actions={
              <div className="flex items-center gap-3 text-[11px] text-terminal-muted">
                <span>Clusters: {clusterCount}</span>
                <input
                  type="range"
                  min={2}
                  max={8}
                  value={clusterCount}
                  onChange={(event) => setClusterCount(Number(event.target.value))}
                />
              </div>
            }
          >
            {clustersLoading ? (
              <div className="text-xs text-terminal-muted">Loading clusters...</div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" data-testid="correlation-cluster-cards">
                {clusterCards.map((cluster, index) => (
                  <div key={cluster.cluster_id} className="rounded border border-terminal-border bg-terminal-bg p-3">
                    <div className="flex items-center justify-between">
                      <span
                        className="rounded px-2 py-1 text-[10px] font-semibold uppercase text-black"
                        style={{ backgroundColor: clusterBadgeColor(index) }}
                      >
                        Cluster {cluster.cluster_id}
                      </span>
                      <span className="text-[10px] text-terminal-muted">{cluster.avg_intra_correlation.toFixed(2)}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {cluster.symbols.map((symbol) => (
                        <span key={symbol} className="rounded border border-terminal-border px-2 py-1 text-[10px] text-terminal-text">
                          {symbol}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TerminalPanel>

          <div className="grid gap-4 lg:grid-cols-2">
            <TerminalPanel title="Decorrelated Pairs" subtitle="Lowest observed pair correlations">
              <div className="space-y-2">
                {decorrelatedPairs.map((pair) => (
                  <div key={pair.pair} className="flex items-center justify-between rounded border border-terminal-border bg-terminal-bg px-3 py-2 text-xs">
                    <span className="text-terminal-text">{pair.pair}</span>
                    <span className="font-semibold text-terminal-neg">{pair.value.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </TerminalPanel>

            <TerminalPanel title="Dendrogram Snapshot" subtitle="Recursive merge tree summary">
              <pre className="max-h-[320px] overflow-auto rounded border border-terminal-border bg-terminal-bg p-3 text-[10px] text-terminal-muted">
                {JSON.stringify(clusters?.dendrogram ?? {}, null, 2)}
              </pre>
            </TerminalPanel>
          </div>
        </div>
      ) : null}
    </div>
  );
}
