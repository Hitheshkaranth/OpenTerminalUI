import React, { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  LineChart as LineChartIcon,
  Sigma,
  Loader2,
  Play,
  TrendingUp,
  AlertCircle,
  Activity,
  Layers,
  Target,
  Search
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Area,
  AreaChart,
  ReferenceLine
} from "recharts";

import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { extractApiErrorMessage } from "../api/base";
import {
  fetchStatlabMethods,
  postForecast,
  postCointegration,
  postStationarity,
  postDecomposition,
  ForecastResult,
  CointResult,
  StationarityResult,
  DecompositionResult
} from "../api/statlab";

type TabType = "forecast" | "coint" | "stationarity" | "decomposition";

export function StatisticalLab() {
  const [activeTab, setActiveTab] = useState<TabType>("forecast");

  // --- Forecast State ---
  const [forecastTicker, setForecastTicker] = useState("RELIANCE");
  const [forecastMethod, setForecastMethod] = useState("");
  const [forecastHorizon, setForecastHorizon] = useState(30);

  // --- Coint State ---
  const [cointTickerA, setCointTickerA] = useState("RELIANCE");
  const [cointTickerB, setCointTickerB] = useState("HDFCBANK");

  // --- Stationarity State ---
  const [statTicker, setStatTicker] = useState("RELIANCE");

  // --- Decomposition State ---
  const [decompTicker, setDecompTicker] = useState("RELIANCE");
  const [decompPeriod, setDecompPeriod] = useState(21);

  // --- Data Fetching ---
  const { data: methods, isPending: isPendingMethods } = useQuery({
    queryKey: ["statlab-methods"],
    queryFn: fetchStatlabMethods,
  });

  useEffect(() => {
    if (methods?.forecast_methods?.length && !forecastMethod) {
      setForecastMethod(methods.forecast_methods[0].id);
    }
  }, [methods, forecastMethod]);

  const forecastMutation = useMutation({
    mutationFn: postForecast,
  });

  const cointMutation = useMutation({
    mutationFn: postCointegration,
  });

  const statMutation = useMutation({
    mutationFn: postStationarity,
  });

  const decompMutation = useMutation({
    mutationFn: postDecomposition,
  });

  // --- Render Helpers ---
  const renderError = (mutation: any) => {
    if (!mutation.error) return null;
    return (
      <div className="mb-4 flex items-center rounded border border-terminal-neg/50 bg-terminal-neg/10 p-3 text-xs text-terminal-neg">
        <AlertCircle className="mr-2 h-4 w-4 shrink-0" />
        <span>{extractApiErrorMessage(mutation.error, "Analysis failed")}</span>
      </div>
    );
  };

  const renderTabButton = (id: TabType, label: string) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`px-4 py-2 text-xs font-medium uppercase tracking-wider transition-all border-b-2 ${
        activeTab === id
          ? "border-terminal-accent bg-terminal-accent/10 text-terminal-accent"
          : "border-transparent text-terminal-muted hover:text-terminal-text hover:bg-terminal-panel"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-terminal-bg text-terminal-text">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-terminal-border p-4 bg-terminal-panel/50">
        <div className="flex items-center space-x-3">
          <div className="rounded bg-terminal-accent/20 p-2 text-terminal-accent">
            <Sigma className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold uppercase tracking-tight text-terminal-accent">Statistical Lab</h1>
            <p className="text-[10px] text-terminal-muted uppercase tracking-widest">
              Forecasting · Cointegration · Stationarity · Decomposition (statsmodels)
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-terminal-border bg-terminal-panel/30">
        {renderTabButton("forecast", "Forecast")}
        {renderTabButton("coint", "Pairs & Cointegration")}
        {renderTabButton("stationarity", "Stationarity")}
        {renderTabButton("decomposition", "Decomposition")}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {activeTab === "forecast" && (
          <div className="space-y-4">
            <TerminalPanel title="Forecasting Configuration">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-4 items-end">
                <div>
                  <label className="block text-[10px] uppercase text-terminal-muted mb-1">Ticker</label>
                  <input
                    type="text"
                    value={forecastTicker}
                    onChange={(e) => setForecastTicker(e.target.value.toUpperCase())}
                    className="w-full bg-terminal-bg border border-terminal-border px-3 py-2 text-xs text-terminal-text focus:border-terminal-accent focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase text-terminal-muted mb-1">Method</label>
                  <select
                    value={forecastMethod}
                    onChange={(e) => setForecastMethod(e.target.value)}
                    className="w-full bg-terminal-bg border border-terminal-border px-3 py-2 text-xs text-terminal-text focus:border-terminal-accent focus:outline-none"
                    disabled={isPendingMethods}
                  >
                    {methods?.forecast_methods.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] uppercase text-terminal-muted mb-1">Horizon (Days)</label>
                  <input
                    type="number"
                    value={forecastHorizon}
                    onChange={(e) => setForecastHorizon(parseInt(e.target.value))}
                    className="w-full bg-terminal-bg border border-terminal-border px-3 py-2 text-xs text-terminal-text focus:border-terminal-accent focus:outline-none"
                  />
                </div>
                <button
                  onClick={() => forecastMutation.mutate({ ticker: forecastTicker, method: forecastMethod, horizon: forecastHorizon })}
                  disabled={forecastMutation.isPending}
                  className="flex items-center justify-center bg-terminal-accent px-4 py-2 text-xs font-bold uppercase text-black hover:bg-terminal-accent/80 disabled:opacity-50"
                >
                  {forecastMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                  Run Forecast
                </button>
              </div>
            </TerminalPanel>

            {renderError(forecastMutation)}

            {forecastMutation.data ? (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
                <div className="lg:col-span-3">
                  <TerminalPanel title={`${forecastMutation.data.ticker} Forecast (${forecastMutation.data.method})`}>
                    <div className="h-[400px] w-full pt-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart
                          data={[
                            ...forecastMutation.data.history.map(h => ({ ...h, isForecast: false })),
                            ...forecastMutation.data.forecast.map(f => ({ date: f.date, value: null, mean: f.mean, lower: f.lower, upper: f.upper, isForecast: true }))
                          ]}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" vertical={false} />
                          <XAxis dataKey="date" stroke="#4B5563" fontSize={10} tickFormatter={(val) => val.split("-").slice(1).join("-")} />
                          <YAxis stroke="#4B5563" fontSize={10} domain={["auto", "auto"]} />
                          <Tooltip
                            contentStyle={{ backgroundColor: "#000", border: "1px solid #374151", fontSize: "12px" }}
                            itemStyle={{ padding: "2px 0" }}
                          />
                          <Legend wrapperStyle={{ fontSize: "10px", paddingTop: "10px" }} />
                          <Area
                            type="monotone"
                            dataKey={(data) => [data.lower, data.upper]}
                            stroke="none"
                            fill="#3B82F6"
                            fillOpacity={0.1}
                            name="Confidence Band"
                            connectNulls
                          />
                          <Line
                            type="monotone"
                            dataKey="value"
                            stroke="#10B981"
                            strokeWidth={2}
                            dot={false}
                            name="History"
                          />
                          <Line
                            type="monotone"
                            dataKey="mean"
                            stroke="#3B82F6"
                            strokeWidth={2}
                            strokeDasharray="5 5"
                            dot={false}
                            name="Forecast"
                            connectNulls
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </TerminalPanel>
                </div>
                <div className="space-y-4">
                  <TerminalPanel title="Model Stats">
                    <div className="space-y-4 p-2">
                      <div className="border-l-2 border-terminal-accent pl-3">
                        <div className="text-[10px] uppercase text-terminal-muted">Order</div>
                        <div className="text-lg font-bold text-terminal-text">{forecastMutation.data.model.order}</div>
                      </div>
                      <div className="border-l-2 border-terminal-accent pl-3">
                        <div className="text-[10px] uppercase text-terminal-muted">AIC</div>
                        <div className="text-lg font-bold text-terminal-text">{forecastMutation.data.model.aic.toFixed(2)}</div>
                      </div>
                      <div className="border-l-2 border-terminal-accent pl-3">
                        <div className="text-[10px] uppercase text-terminal-muted">In-sample RMSE</div>
                        <div className="text-lg font-bold text-terminal-text">{forecastMutation.data.metrics.rmse_in_sample.toFixed(4)}</div>
                      </div>
                    </div>
                  </TerminalPanel>
                </div>
              </div>
            ) : (
              !forecastMutation.isPending && (
                <div className="flex h-64 items-center justify-center border-2 border-dashed border-terminal-border rounded">
                  <p className="text-terminal-muted uppercase tracking-widest text-xs">Run analysis to see results</p>
                </div>
              )
            )}
          </div>
        )}

        {activeTab === "coint" && (
          <div className="space-y-4">
            <TerminalPanel title="Cointegration Configuration">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3 items-end">
                <div>
                  <label className="block text-[10px] uppercase text-terminal-muted mb-1">Ticker A</label>
                  <input
                    type="text"
                    value={cointTickerA}
                    onChange={(e) => setCointTickerA(e.target.value.toUpperCase())}
                    className="w-full bg-terminal-bg border border-terminal-border px-3 py-2 text-xs text-terminal-text focus:border-terminal-accent focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase text-terminal-muted mb-1">Ticker B</label>
                  <input
                    type="text"
                    value={cointTickerB}
                    onChange={(e) => setCointTickerB(e.target.value.toUpperCase())}
                    className="w-full bg-terminal-bg border border-terminal-border px-3 py-2 text-xs text-terminal-text focus:border-terminal-accent focus:outline-none"
                  />
                </div>
                <button
                  onClick={() => cointMutation.mutate({ ticker_a: cointTickerA, ticker_b: cointTickerB })}
                  disabled={cointMutation.isPending}
                  className="flex items-center justify-center bg-terminal-accent px-4 py-2 text-xs font-bold uppercase text-black hover:bg-terminal-accent/80 disabled:opacity-50"
                >
                  {cointMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                  Check Cointegration
                </button>
              </div>
            </TerminalPanel>

            {renderError(cointMutation)}

            {cointMutation.data ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
                  <StatCard label="P-Value" value={cointMutation.data.coint_pvalue.toFixed(4)} color={cointMutation.data.is_cointegrated ? "text-terminal-pos" : "text-terminal-muted"} />
                  <StatCard label="Hedge Ratio" value={cointMutation.data.hedge_ratio.toFixed(4)} />
                  <StatCard label="Half-Life (Days)" value={cointMutation.data.half_life.toFixed(1)} />
                  <StatCard label="Correlation" value={cointMutation.data.correlation.toFixed(2)} />
                  <StatCard label="Current Z" value={cointMutation.data.current_z.toFixed(2)} />
                  <div className="rounded border border-terminal-border bg-terminal-panel p-3">
                    <div className="text-[10px] uppercase text-terminal-muted">Signal</div>
                    <div className={`text-lg font-bold ${cointMutation.data.signal === "LONG_SPREAD" ? "text-terminal-pos" : cointMutation.data.signal === "SHORT_SPREAD" ? "text-terminal-neg" : "text-terminal-muted"}`}>
                      {cointMutation.data.signal}
                    </div>
                  </div>
                </div>

                <TerminalPanel title={`Spread Z-Score: ${cointMutation.data.ticker_a} / ${cointMutation.data.ticker_b}`}>
                  <div className="h-[300px] w-full pt-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={cointMutation.data.series}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" vertical={false} />
                        <XAxis dataKey="date" stroke="#4B5563" fontSize={10} tickFormatter={(val) => val.split("-").slice(1).join("-")} />
                        <YAxis stroke="#4B5563" fontSize={10} domain={[-4, 4]} />
                        <Tooltip contentStyle={{ backgroundColor: "#000", border: "1px solid #374151", fontSize: "12px" }} />
                        <ReferenceLine y={2} stroke="#EF4444" strokeDasharray="3 3" label={{ value: "Entry", position: "right", fill: "#EF4444", fontSize: 10 }} />
                        <ReferenceLine y={-2} stroke="#10B981" strokeDasharray="3 3" label={{ value: "Entry", position: "right", fill: "#10B981", fontSize: 10 }} />
                        <ReferenceLine y={0} stroke="#4B5563" />
                        <Line type="monotone" dataKey="zscore" stroke="#F59E0B" strokeWidth={1.5} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </TerminalPanel>
              </div>
            ) : (
              !cointMutation.isPending && (
                <div className="flex h-64 items-center justify-center border-2 border-dashed border-terminal-border rounded">
                  <p className="text-terminal-muted uppercase tracking-widest text-xs">Run analysis to see results</p>
                </div>
              )
            )}
          </div>
        )}

        {activeTab === "stationarity" && (
          <div className="space-y-4">
            <TerminalPanel title="Stationarity Configuration">
              <div className="flex space-x-4 items-end">
                <div className="flex-1">
                  <label className="block text-[10px] uppercase text-terminal-muted mb-1">Ticker</label>
                  <input
                    type="text"
                    value={statTicker}
                    onChange={(e) => setStatTicker(e.target.value.toUpperCase())}
                    className="w-full bg-terminal-bg border border-terminal-border px-3 py-2 text-xs text-terminal-text focus:border-terminal-accent focus:outline-none"
                  />
                </div>
                <button
                  onClick={() => statMutation.mutate({ ticker: statTicker })}
                  disabled={statMutation.isPending}
                  className="flex items-center justify-center bg-terminal-accent px-4 py-2 text-xs font-bold uppercase text-black hover:bg-terminal-accent/80 disabled:opacity-50"
                >
                  {statMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                  Check Stationarity
                </button>
              </div>
            </TerminalPanel>

            {renderError(statMutation)}

            {statMutation.data ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <StationarityCard
                    title="ADF Test (Prices)"
                    stat={statMutation.data.adf.stat}
                    pvalue={statMutation.data.adf.pvalue}
                    isPass={statMutation.data.adf.is_stationary}
                  />
                  <StationarityCard
                    title="KPSS Test (Prices)"
                    stat={statMutation.data.kpss.stat}
                    pvalue={statMutation.data.kpss.pvalue}
                    isPass={statMutation.data.kpss.is_stationary}
                  />
                  <StationarityCard
                    title="ADF Test (Returns)"
                    stat={statMutation.data.returns_adf.stat}
                    pvalue={statMutation.data.returns_adf.pvalue}
                    isPass={statMutation.data.returns_adf.is_stationary}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="rounded border border-terminal-border bg-terminal-panel p-4">
                    <div className="text-[10px] uppercase text-terminal-muted mb-1">Hurst Exponent</div>
                    <div className="text-2xl font-bold text-terminal-accent mb-1">{statMutation.data.hurst.toFixed(3)}</div>
                    <div className={`text-[10px] font-bold px-2 py-0.5 inline-block rounded ${
                      statMutation.data.hurst < 0.45 ? "bg-terminal-pos/20 text-terminal-pos" :
                      statMutation.data.hurst > 0.55 ? "bg-terminal-accent/20 text-terminal-accent" :
                      "bg-terminal-muted/20 text-terminal-muted"
                    }`}>
                      {statMutation.data.hurst < 0.45 ? "MEAN-REVERTING" : statMutation.data.hurst > 0.55 ? "TRENDING" : "RANDOM WALK"}
                    </div>
                  </div>
                  <div className="md:col-span-2 rounded border border-terminal-border bg-terminal-panel/30 p-4">
                    <div className="text-[10px] uppercase text-terminal-muted mb-2">Interpretation</div>
                    <p className="text-xs text-terminal-text leading-relaxed">{statMutation.data.interpretation}</p>
                  </div>
                </div>
              </div>
            ) : (
              !statMutation.isPending && (
                <div className="flex h-64 items-center justify-center border-2 border-dashed border-terminal-border rounded">
                  <p className="text-terminal-muted uppercase tracking-widest text-xs">Run analysis to see results</p>
                </div>
              )
            )}
          </div>
        )}

        {activeTab === "decomposition" && (
          <div className="space-y-4">
            <TerminalPanel title="Decomposition Configuration">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3 items-end">
                <div>
                  <label className="block text-[10px] uppercase text-terminal-muted mb-1">Ticker</label>
                  <input
                    type="text"
                    value={decompTicker}
                    onChange={(e) => setDecompTicker(e.target.value.toUpperCase())}
                    className="w-full bg-terminal-bg border border-terminal-border px-3 py-2 text-xs text-terminal-text focus:border-terminal-accent focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase text-terminal-muted mb-1">Period (e.g. 21)</label>
                  <input
                    type="number"
                    value={decompPeriod}
                    onChange={(e) => setDecompPeriod(parseInt(e.target.value))}
                    className="w-full bg-terminal-bg border border-terminal-border px-3 py-2 text-xs text-terminal-text focus:border-terminal-accent focus:outline-none"
                  />
                </div>
                <button
                  onClick={() => decompMutation.mutate({ ticker: decompTicker, period: decompPeriod })}
                  disabled={decompMutation.isPending}
                  className="flex items-center justify-center bg-terminal-accent px-4 py-2 text-xs font-bold uppercase text-black hover:bg-terminal-accent/80 disabled:opacity-50"
                >
                  {decompMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                  Decompose Series
                </button>
              </div>
            </TerminalPanel>

            {renderError(decompMutation)}

            {decompMutation.data ? (
              <div className="space-y-4">
                <DecompChart title="Observed" data={decompMutation.data.series} dataKey="observed" color="#10B981" />
                <DecompChart title="Trend" data={decompMutation.data.series} dataKey="trend" color="#3B82F6" />
                <DecompChart title="Seasonal" data={decompMutation.data.series} dataKey="seasonal" color="#F59E0B" />
                <DecompChart title="Residual" data={decompMutation.data.series} dataKey="resid" color="#9CA3AF" />
              </div>
            ) : (
              !decompMutation.isPending && (
                <div className="flex h-64 items-center justify-center border-2 border-dashed border-terminal-border rounded">
                  <p className="text-terminal-muted uppercase tracking-widest text-xs">Run analysis to see results</p>
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Sub-components ---

function StatCard({ label, value, color = "text-terminal-text" }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="text-[10px] uppercase text-terminal-muted">{label}</div>
      <div className={`text-lg font-bold ${color}`}>{value}</div>
    </div>
  );
}

function StationarityCard({ title, stat, pvalue, isPass }: { title: string; stat: number; pvalue: number; isPass: boolean }) {
  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-4">
      <div className="text-[10px] uppercase text-terminal-muted mb-2 font-bold">{title}</div>
      <div className="flex justify-between items-end">
        <div>
          <div className="text-[10px] uppercase text-terminal-muted">Stat</div>
          <div className="text-lg font-bold text-terminal-text">{stat.toFixed(3)}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase text-terminal-muted">P-Value</div>
          <div className="text-lg font-bold text-terminal-text">{pvalue.toFixed(4)}</div>
        </div>
      </div>
      <div className={`mt-3 text-[10px] font-bold px-2 py-1 rounded inline-block ${isPass ? "bg-terminal-pos/20 text-terminal-pos" : "bg-terminal-neg/20 text-terminal-neg"}`}>
        {isPass ? "STATIONARY" : "NON-STATIONARY"}
      </div>
    </div>
  );
}

function DecompChart({ title, data, dataKey, color }: { title: string, data: any[], dataKey: string, color: string }) {
  return (
    <TerminalPanel title={title} className="w-full">
      <div className="h-[120px] w-full pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" vertical={false} />
            <XAxis dataKey="date" hide />
            <YAxis stroke="#4B5563" fontSize={8} domain={["auto", "auto"]} />
            <Tooltip
              contentStyle={{ backgroundColor: "#000", border: "1px solid #374151", fontSize: "10px" }}
              labelStyle={{ display: "none" }}
            />
            <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </TerminalPanel>
  );
}
