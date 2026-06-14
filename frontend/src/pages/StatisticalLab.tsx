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
  ReferenceLine,
  BarChart,
  Bar,
  ScatterChart,
  Scatter,
  ZAxis,
  Cell
} from "recharts";

import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { extractApiErrorMessage } from "../api/base";
import {
  fetchStatlabMethods,
  postForecast,
  postCointegration,
  postStationarity,
  postDecomposition,
  postRegression,
  postAutocorrelation,
  postCausality,
  postRegimes,
  ForecastResult,
  CointResult,
  StationarityResult,
  DecompositionResult,
  RegressionResult,
  AutocorrResult,
  CausalityResult,
  RegimeResult
} from "../api/statlab";

type TabType = "forecast" | "coint" | "stationarity" | "decomposition" | "regression" | "autocorr" | "causality" | "regimes";

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

  // --- Regression State ---
  const [regTicker, setRegTicker] = useState("RELIANCE");
  const [regBenchmark, setRegBenchmark] = useState("^NSEI");
  const [regWindow, setRegWindow] = useState(63);

  // --- Autocorr State ---
  const [autoTicker, setAutoTicker] = useState("RELIANCE");
  const [autoLags, setAutoLags] = useState(30);
  const [autoUseReturns, setAutoUseReturns] = useState(true);

  // --- Causality State ---
  const [causTickerA, setCausTickerA] = useState("RELIANCE");
  const [causTickerB, setCausTickerB] = useState("HDFCBANK");
  const [causMaxLag, setCausMaxLag] = useState(5);

  // --- Regimes State ---
  const [regimesTicker, setRegimesTicker] = useState("RELIANCE");

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

  const regressionMutation = useMutation({
    mutationFn: postRegression,
  });

  const autocorrMutation = useMutation({
    mutationFn: postAutocorrelation,
  });

  const causalityMutation = useMutation({
    mutationFn: postCausality,
  });

  const regimesMutation = useMutation({
    mutationFn: postRegimes,
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
              Forecast · Cointegration · Stationarity · Decomposition · CAPM · Autocorrelation · Causality · Regimes (statsmodels)
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap border-b border-terminal-border bg-terminal-panel/30">
        {renderTabButton("forecast", "Forecast")}
        {renderTabButton("coint", "Pairs & Cointegration")}
        {renderTabButton("stationarity", "Stationarity")}
        {renderTabButton("decomposition", "Decomposition")}
        {renderTabButton("regression", "Factor / CAPM")}
        {renderTabButton("autocorr", "Autocorrelation")}
        {renderTabButton("causality", "Causality")}
        {renderTabButton("regimes", "Regimes")}
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

        {activeTab === "regression" && (
          <div className="space-y-4">
            <TerminalPanel title="Factor / CAPM Configuration">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-4 items-end">
                <div>
                  <label className="block text-[10px] uppercase text-terminal-muted mb-1">Ticker</label>
                  <input
                    type="text"
                    value={regTicker}
                    onChange={(e) => setRegTicker(e.target.value.toUpperCase())}
                    className="w-full bg-terminal-bg border border-terminal-border px-3 py-2 text-xs text-terminal-text focus:border-terminal-accent focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase text-terminal-muted mb-1">Benchmark</label>
                  <input
                    type="text"
                    value={regBenchmark}
                    onChange={(e) => setRegBenchmark(e.target.value)}
                    className="w-full bg-terminal-bg border border-terminal-border px-3 py-2 text-xs text-terminal-text focus:border-terminal-accent focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase text-terminal-muted mb-1">Rolling Window</label>
                  <input
                    type="number"
                    value={regWindow}
                    onChange={(e) => setRegWindow(parseInt(e.target.value))}
                    className="w-full bg-terminal-bg border border-terminal-border px-3 py-2 text-xs text-terminal-text focus:border-terminal-accent focus:outline-none"
                  />
                </div>
                <button
                  onClick={() => regressionMutation.mutate({ ticker: regTicker, benchmark: regBenchmark, rolling_window: regWindow })}
                  disabled={regressionMutation.isPending}
                  className="flex items-center justify-center bg-terminal-accent px-4 py-2 text-xs font-bold uppercase text-black hover:bg-terminal-accent/80 disabled:opacity-50"
                >
                  {regressionMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                  Run Regression
                </button>
              </div>
            </TerminalPanel>

            {renderError(regressionMutation)}

            {regressionMutation.data ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-7">
                  <StatCard label="Beta" value={regressionMutation.data.beta.toFixed(3)} />
                  <StatCard 
                    label="Alpha (Ann.)" 
                    value={`${(regressionMutation.data.alpha_annual * 100).toFixed(2)}%`}
                    color={regressionMutation.data.alpha_annual >= 0 ? "text-terminal-pos" : "text-terminal-neg"}
                  />
                  <StatCard label="R-Squared" value={regressionMutation.data.r_squared.toFixed(3)} />
                  <StatCard label="Correlation" value={regressionMutation.data.correlation.toFixed(3)} />
                  <StatCard label="Tracking Error" value={`${(regressionMutation.data.tracking_error * 100).toFixed(2)}%`} />
                  <StatCard label="Info Ratio" value={regressionMutation.data.information_ratio.toFixed(2)} />
                  <div className="rounded border border-terminal-border bg-terminal-panel p-3">
                    <div className="text-[10px] uppercase text-terminal-muted">T-Stats (B/A)</div>
                    <div className="text-xs font-bold">
                      {regressionMutation.data.beta_tstat.toFixed(1)} / {regressionMutation.data.alpha_tstat.toFixed(1)}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <TerminalPanel title={`Rolling Beta (window: ${regressionMutation.data.rolling_window})`}>
                    <div className="h-[300px] w-full pt-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={regressionMutation.data.rolling_beta}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" vertical={false} />
                          <XAxis dataKey="date" stroke="#4B5563" fontSize={10} tickFormatter={(val) => val.split("-").slice(1).join("-")} />
                          <YAxis stroke="#4B5563" fontSize={10} domain={["auto", "auto"]} />
                          <Tooltip contentStyle={{ backgroundColor: "#000", border: "1px solid #374151", fontSize: "12px" }} />
                          <ReferenceLine y={1} stroke="#4B5563" strokeDasharray="3 3" />
                          <Line type="monotone" dataKey="beta" stroke="#10B981" strokeWidth={1.5} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </TerminalPanel>

                  <TerminalPanel title="Returns vs Benchmark Scatter">
                    <div className="h-[300px] w-full pt-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" />
                          <XAxis type="number" dataKey="x" name="Benchmark" stroke="#4B5563" fontSize={10} unit="%" />
                          <YAxis type="number" dataKey="y" name="Asset" stroke="#4B5563" fontSize={10} unit="%" />
                          <ZAxis range={[20, 20]} />
                          <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ backgroundColor: "#000", border: "1px solid #374151", fontSize: "12px" }} />
                          <Scatter name="Returns" data={regressionMutation.data.scatter} fill="#3B82F6" opacity={0.6} />
                          <Line type="monotone" dataKey="y" data={regressionMutation.data.fit_line} stroke="#F59E0B" strokeWidth={2} dot={false} legendType="none" />
                        </ScatterChart>
                      </ResponsiveContainer>
                    </div>
                  </TerminalPanel>
                </div>
                
                <div className="rounded border border-terminal-border bg-terminal-panel/30 p-4">
                  <div className="text-[10px] uppercase text-terminal-muted mb-2">Interpretation</div>
                  <p className="text-xs text-terminal-text leading-relaxed">{regressionMutation.data.interpretation}</p>
                </div>
              </div>
            ) : (
              !regressionMutation.isPending && (
                <div className="flex h-64 items-center justify-center border-2 border-dashed border-terminal-border rounded">
                  <p className="text-terminal-muted uppercase tracking-widest text-xs">Run analysis to see results</p>
                </div>
              )
            )}
          </div>
        )}

        {activeTab === "causality" && (
          <div className="space-y-4">
            <TerminalPanel title="Granger Causality Configuration">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-4 items-end">
                <div>
                  <label className="block text-[10px] uppercase text-terminal-muted mb-1">Ticker A</label>
                  <input
                    type="text"
                    value={causTickerA}
                    onChange={(e) => setCausTickerA(e.target.value.toUpperCase())}
                    className="w-full bg-terminal-bg border border-terminal-border px-3 py-2 text-xs text-terminal-text focus:border-terminal-accent focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase text-terminal-muted mb-1">Ticker B</label>
                  <input
                    type="text"
                    value={causTickerB}
                    onChange={(e) => setCausTickerB(e.target.value.toUpperCase())}
                    className="w-full bg-terminal-bg border border-terminal-border px-3 py-2 text-xs text-terminal-text focus:border-terminal-accent focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase text-terminal-muted mb-1">Max Lag</label>
                  <input
                    type="number"
                    value={causMaxLag}
                    onChange={(e) => setCausMaxLag(parseInt(e.target.value))}
                    className="w-full bg-terminal-bg border border-terminal-border px-3 py-2 text-xs text-terminal-text focus:border-terminal-accent focus:outline-none"
                  />
                </div>
                <button
                  onClick={() => causalityMutation.mutate({ ticker_a: causTickerA, ticker_b: causTickerB, max_lag: causMaxLag })}
                  disabled={causalityMutation.isPending}
                  className="flex items-center justify-center bg-terminal-accent px-4 py-2 text-xs font-bold uppercase text-black hover:bg-terminal-accent/80 disabled:opacity-50"
                >
                  {causalityMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                  Test Causality
                </button>
              </div>
            </TerminalPanel>

            {renderError(causalityMutation)}

            {causalityMutation.data ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="rounded border border-terminal-border bg-terminal-panel p-4">
                    <div className="text-[10px] uppercase text-terminal-muted mb-2">{causalityMutation.data.name_a} → {causalityMutation.data.name_b}</div>
                    <div className="text-lg font-bold text-terminal-text">p={causalityMutation.data.a_to_b.min_pvalue.toFixed(4)}</div>
                    <div className="text-[10px] text-terminal-muted mb-2">Best lag: {causalityMutation.data.a_to_b.best_lag}</div>
                    <div className={`text-[10px] font-bold px-2 py-0.5 rounded inline-block ${causalityMutation.data.a_to_b.significant ? "bg-terminal-pos/20 text-terminal-pos" : "bg-terminal-muted/20 text-terminal-muted"}`}>
                      {causalityMutation.data.a_to_b.significant ? "CAUSAL" : "NO EFFECT"}
                    </div>
                  </div>
                  <div className="rounded border border-terminal-border bg-terminal-panel p-4">
                    <div className="text-[10px] uppercase text-terminal-muted mb-2">{causalityMutation.data.name_b} → {causalityMutation.data.name_a}</div>
                    <div className="text-lg font-bold text-terminal-text">p={causalityMutation.data.b_to_a.min_pvalue.toFixed(4)}</div>
                    <div className="text-[10px] text-terminal-muted mb-2">Best lag: {causalityMutation.data.b_to_a.best_lag}</div>
                    <div className={`text-[10px] font-bold px-2 py-0.5 rounded inline-block ${causalityMutation.data.b_to_a.significant ? "bg-terminal-pos/20 text-terminal-pos" : "bg-terminal-muted/20 text-terminal-muted"}`}>
                      {causalityMutation.data.b_to_a.significant ? "CAUSAL" : "NO EFFECT"}
                    </div>
                  </div>
                  <div className="rounded border border-terminal-border bg-terminal-panel p-4 flex flex-col justify-center items-center">
                    <div className="text-[10px] uppercase text-terminal-muted mb-1 text-center w-full">Relationship Lead</div>
                    <div className={`text-sm font-bold px-4 py-2 rounded text-center ${causalityMutation.data.lead.includes("leads") || causalityMutation.data.lead.includes("feedback") ? "bg-terminal-pos/20 text-terminal-pos" : "bg-terminal-muted/20 text-terminal-muted"}`}>
                      {causalityMutation.data.lead}
                    </div>
                  </div>
                </div>

                <TerminalPanel title="P-Value by Lag (lower is more significant)">
                  <div className="h-[300px] w-full pt-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" vertical={false} />
                        <XAxis dataKey="lag" type="number" stroke="#4B5563" fontSize={10} domain={[1, causalityMutation.data.max_lag]} />
                        <YAxis stroke="#4B5563" fontSize={10} domain={[0, 1]} />
                        <Tooltip contentStyle={{ backgroundColor: "#000", border: "1px solid #374151", fontSize: "12px" }} />
                        <Legend wrapperStyle={{ fontSize: "10px", paddingTop: "10px" }} />
                        <ReferenceLine y={0.05} stroke="#EF4444" strokeDasharray="3 3" label={{ value: "5%", position: "right", fill: "#EF4444", fontSize: 10 }} />
                        <Line
                          data={causalityMutation.data.a_to_b.curve}
                          type="monotone"
                          dataKey="pvalue"
                          stroke="#10B981"
                          strokeWidth={2}
                          name={`${causalityMutation.data.ticker_a} -> ${causalityMutation.data.ticker_b}`}
                        />
                        <Line
                          data={causalityMutation.data.b_to_a.curve}
                          type="monotone"
                          dataKey="pvalue"
                          stroke="#3B82F6"
                          strokeWidth={2}
                          name={`${causalityMutation.data.ticker_b} -> ${causalityMutation.data.ticker_a}`}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </TerminalPanel>

                <div className="rounded border border-terminal-border bg-terminal-panel/30 p-4">
                  <div className="text-[10px] uppercase text-terminal-muted mb-2">Interpretation</div>
                  <p className="text-xs text-terminal-text leading-relaxed">{causalityMutation.data.interpretation}</p>
                </div>
              </div>
            ) : (
              !causalityMutation.isPending && (
                <div className="flex h-64 items-center justify-center border-2 border-dashed border-terminal-border rounded">
                  <p className="text-terminal-muted uppercase tracking-widest text-xs">Run analysis to see results</p>
                </div>
              )
            )}
          </div>
        )}

        {activeTab === "autocorr" && (
          <div className="space-y-4">
            <TerminalPanel title="Autocorrelation Configuration">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-4 items-end">
                <div>
                  <label className="block text-[10px] uppercase text-terminal-muted mb-1">Ticker</label>
                  <input
                    type="text"
                    value={autoTicker}
                    onChange={(e) => setAutoTicker(e.target.value.toUpperCase())}
                    className="w-full bg-terminal-bg border border-terminal-border px-3 py-2 text-xs text-terminal-text focus:border-terminal-accent focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase text-terminal-muted mb-1">Lags</label>
                  <input
                    type="number"
                    value={autoLags}
                    onChange={(e) => setAutoLags(parseInt(e.target.value))}
                    className="w-full bg-terminal-bg border border-terminal-border px-3 py-2 text-xs text-terminal-text focus:border-terminal-accent focus:outline-none"
                  />
                </div>
                <div className="flex items-center space-x-2 h-9">
                  <input
                    type="checkbox"
                    checked={autoUseReturns}
                    onChange={(e) => setAutoUseReturns(e.target.checked)}
                    className="rounded border-terminal-border bg-terminal-bg text-terminal-accent focus:ring-terminal-accent"
                  />
                  <label className="text-[10px] uppercase text-terminal-muted">Use Returns</label>
                </div>
                <button
                  onClick={() => autocorrMutation.mutate({ ticker: autoTicker, nlags: autoLags, use_returns: autoUseReturns })}
                  disabled={autocorrMutation.isPending}
                  className="flex items-center justify-center bg-terminal-accent px-4 py-2 text-xs font-bold uppercase text-black hover:bg-terminal-accent/80 disabled:opacity-50"
                >
                  {autocorrMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                  Run Analysis
                </button>
              </div>
            </TerminalPanel>

            {renderError(autocorrMutation)}

            {autocorrMutation.data ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <TerminalPanel title="Autocorrelation Function (ACF)">
                    <div className="h-[250px] w-full pt-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={autocorrMutation.data.acf}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" vertical={false} />
                          <XAxis dataKey="lag" stroke="#4B5563" fontSize={10} />
                          <YAxis stroke="#4B5563" fontSize={10} domain={[-1, 1]} />
                          <Tooltip contentStyle={{ backgroundColor: "#000", border: "1px solid #374151", fontSize: "12px" }} />
                          <ReferenceLine y={autocorrMutation.data.conf_band} stroke="#EF4444" strokeDasharray="3 3" />
                          <ReferenceLine y={-autocorrMutation.data.conf_band} stroke="#EF4444" strokeDasharray="3 3" />
                          <ReferenceLine y={0} stroke="#4B5563" />
                          <Bar dataKey="value">
                            {autocorrMutation.data.acf.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.significant ? "#10B981" : "#4B5563"} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </TerminalPanel>

                  <TerminalPanel title="Partial Autocorrelation (PACF)">
                    <div className="h-[250px] w-full pt-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={autocorrMutation.data.pacf}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" vertical={false} />
                          <XAxis dataKey="lag" stroke="#4B5563" fontSize={10} />
                          <YAxis stroke="#4B5563" fontSize={10} domain={[-1, 1]} />
                          <Tooltip contentStyle={{ backgroundColor: "#000", border: "1px solid #374151", fontSize: "12px" }} />
                          <ReferenceLine y={autocorrMutation.data.conf_band} stroke="#EF4444" strokeDasharray="3 3" />
                          <ReferenceLine y={-autocorrMutation.data.conf_band} stroke="#EF4444" strokeDasharray="3 3" />
                          <ReferenceLine y={0} stroke="#4B5563" />
                          <Bar dataKey="value">
                            {autocorrMutation.data.pacf.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.significant ? "#10B981" : "#4B5563"} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </TerminalPanel>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  {autocorrMutation.data.ljung_box.map((lb) => (
                    <div key={lb.lag} className="rounded border border-terminal-border bg-terminal-panel p-3">
                      <div className="text-[10px] uppercase text-terminal-muted">LB (lag {lb.lag})</div>
                      <div className="text-xs font-bold text-terminal-text mb-1">p={lb.pvalue.toFixed(4)}</div>
                      <div className={`text-[8px] font-bold px-1.5 py-0.5 rounded inline-block ${lb.has_autocorr ? "bg-terminal-neg/20 text-terminal-neg" : "bg-terminal-pos/20 text-terminal-pos"}`}>
                        {lb.has_autocorr ? "AUTOCORR" : "WHITE NOISE"}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="rounded border border-terminal-border bg-terminal-panel/30 p-4">
                  <div className="text-[10px] uppercase text-terminal-muted mb-2">Interpretation</div>
                  <p className="text-xs text-terminal-text leading-relaxed">{autocorrMutation.data.interpretation}</p>
                </div>
              </div>
            ) : (
              !autocorrMutation.isPending && (
                <div className="flex h-64 items-center justify-center border-2 border-dashed border-terminal-border rounded">
                  <p className="text-terminal-muted uppercase tracking-widest text-xs">Run analysis to see results</p>
                </div>
              )
            )}
          </div>
        )}

        {activeTab === "regimes" && (
          <div className="space-y-4">
            <TerminalPanel title="Volatility Regime Configuration">
              <div className="flex space-x-4 items-end">
                <div className="flex-1">
                  <label className="block text-[10px] uppercase text-terminal-muted mb-1">Ticker</label>
                  <input
                    type="text"
                    value={regimesTicker}
                    onChange={(e) => setRegimesTicker(e.target.value.toUpperCase())}
                    className="w-full bg-terminal-bg border border-terminal-border px-3 py-2 text-xs text-terminal-text focus:border-terminal-accent focus:outline-none"
                  />
                </div>
                <button
                  onClick={() => regimesMutation.mutate({ ticker: regimesTicker })}
                  disabled={regimesMutation.isPending}
                  className="flex items-center justify-center bg-terminal-accent px-4 py-2 text-xs font-bold uppercase text-black hover:bg-terminal-accent/80 disabled:opacity-50"
                >
                  {regimesMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                  Identify Regimes
                </button>
              </div>
            </TerminalPanel>

            {renderError(regimesMutation)}

            {regimesMutation.data ? (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-4">
                  <div className="rounded border border-terminal-border bg-terminal-panel p-4 flex-1 min-w-[200px]">
                    <div className="text-[10px] uppercase text-terminal-muted mb-2 font-bold">Current State</div>
                    <div className="flex items-center justify-between">
                      <div className={`text-xl font-black px-3 py-1 rounded ${regimesMutation.data.current_regime === "HIGH-VOL" ? "bg-terminal-neg/20 text-terminal-neg" : "bg-terminal-pos/20 text-terminal-pos"}`}>
                        {regimesMutation.data.current_regime}
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] uppercase text-terminal-muted">High-Vol Prob</div>
                        <div className="text-xl font-bold">{(regimesMutation.data.current_high_vol_prob * 100).toFixed(0)}%</div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 flex-[2]">
                    <div className="rounded border border-terminal-border bg-terminal-panel p-4">
                      <div className="text-[10px] uppercase text-terminal-muted mb-1">Low-Vol Regime</div>
                      <div className="text-sm font-bold text-terminal-pos">{regimesMutation.data.low_vol_regime.ann_vol_pct.toFixed(1)}% Vol</div>
                      <div className="text-[10px] text-terminal-muted">Share: {(regimesMutation.data.low_vol_regime.share * 100).toFixed(0)}%</div>
                    </div>
                    <div className="rounded border border-terminal-border bg-terminal-panel p-4">
                      <div className="text-[10px] uppercase text-terminal-muted mb-1">High-Vol Regime</div>
                      <div className="text-sm font-bold text-terminal-neg">{regimesMutation.data.high_vol_regime.ann_vol_pct.toFixed(1)}% Vol</div>
                      <div className="text-[10px] text-terminal-muted">Share: {(regimesMutation.data.high_vol_regime.share * 100).toFixed(0)}%</div>
                    </div>
                  </div>
                </div>

                <TerminalPanel title="High-Volatility Regime Probability">
                  <div className="h-[300px] w-full pt-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={regimesMutation.data.series}>
                        <defs>
                          <linearGradient id="probGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#EF4444" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#EF4444" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" vertical={false} />
                        <XAxis dataKey="date" stroke="#4B5563" fontSize={10} tickFormatter={(val) => val.split("-").slice(1).join("-")} />
                        <YAxis stroke="#4B5563" fontSize={10} domain={[0, 1]} tickFormatter={(val) => `${(val * 100).toFixed(0)}%`} />
                        <Tooltip contentStyle={{ backgroundColor: "#000", border: "1px solid #374151", fontSize: "12px" }} />
                        <ReferenceLine y={0.5} stroke="#4B5563" strokeDasharray="3 3" />
                        <Area type="monotone" dataKey="high_vol_prob" stroke="#EF4444" fillOpacity={1} fill="url(#probGradient)" name="High-Vol Prob" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </TerminalPanel>

                <div className="rounded border border-terminal-border bg-terminal-panel/30 p-4">
                  <div className="text-[10px] uppercase text-terminal-muted mb-2">Interpretation</div>
                  <p className="text-xs text-terminal-text leading-relaxed">{regimesMutation.data.interpretation}</p>
                </div>
              </div>
            ) : (
              !regimesMutation.isPending && (
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
