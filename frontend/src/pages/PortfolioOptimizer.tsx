import React, { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  PieChart,
  Play,
  Loader2,
  AlertCircle,
  TrendingUp,
} from "lucide-react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ZAxis,
} from "recharts";

import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { extractApiErrorMessage } from "../api/base";
import {
  fetchOptimizerMethods,
  runOptimize,
  OptimizeRequest,
  OptimizeResult,
} from "../api/portfolioOptimizer";

export function PortfolioOptimizer() {
  // --- Form State ---
  const [tickers, setTickers] = useState("RELIANCE,TCS,INFY,HDFCBANK,ICICIBANK,SBIN");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [model, setModel] = useState("");
  const [objective, setObjective] = useState("");
  const [riskMeasure, setRiskMeasure] = useState("");
  const [covMethod, setCovMethod] = useState("sample");
  const [confidence, setConfidence] = useState(0.95);
  const [riskFreeRate, setRiskFreeRate] = useState(0.0);
  const [riskAversion, setRiskAversion] = useState(2);
  const [minWeight, setMinWeight] = useState(0);
  const [maxWeight, setMaxWeight] = useState(1);

  // --- Data Fetching ---
  const { data: methods, isPending: isPendingMethods } = useQuery({
    queryKey: ["optimizer-methods"],
    queryFn: fetchOptimizerMethods,
  });

  const optimizeMutation = useMutation({
    mutationFn: (req: OptimizeRequest) => runOptimize(req),
  });

  // --- Initialize Defaults ---
  useEffect(() => {
    if (methods) {
      if (!model && methods.models.length > 0) setModel(methods.models[0].id);
      if (!objective && methods.objectives.length > 0) setObjective(methods.objectives[0].id);
      if (!riskMeasure && methods.risk_measures.length > 0) setRiskMeasure(methods.risk_measures[0].id);
      if (!covMethod && methods.covariance_methods.length > 0) setCovMethod(methods.covariance_methods[0].id);
    }
  }, [methods, model, objective, riskMeasure, covMethod]);

  const handleRunOptimize = () => {
    const req: OptimizeRequest = {
      tickers: tickers.split(",").map((s) => s.trim()).filter(Boolean),
      start: startDate || null,
      end: endDate || null,
      model,
      objective,
      risk_measure: riskMeasure,
      cov_method: covMethod,
      confidence,
      risk_free_rate: riskFreeRate,
      risk_aversion: riskAversion,
      min_weight: minWeight,
      max_weight: maxWeight,
    };
    optimizeMutation.mutate(req);
  };

  if (isPendingMethods) {
    return (
      <div className="flex h-full items-center justify-center bg-terminal-bg text-terminal-accent">
        <Loader2 className="animate-spin mr-2" />
        <span className="ot-type-label uppercase tracking-widest">Initializing Optimizer...</span>
      </div>
    );
  }

  const result = optimizeMutation.data;
  const isHRP = model === "HRP" || model === "HERC";
  const isRP = model === "RP";

  return (
    <div className="flex h-full flex-col overflow-auto bg-terminal-bg text-terminal-text p-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-terminal-border pb-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="bg-terminal-accent/10 p-2 rounded border border-terminal-accent/30">
            <PieChart className="text-terminal-accent" size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-terminal-accent uppercase tracking-wider">Portfolio Optimizer</h1>
            <p className="text-xs text-terminal-muted">Mean-Risk · HRP · Black-Litterman optimization</p>
          </div>
        </div>

        <button
          onClick={handleRunOptimize}
          disabled={optimizeMutation.isPending}
          className="flex items-center gap-2 bg-terminal-accent text-terminal-bg px-4 py-2 rounded font-bold text-sm hover:bg-terminal-accent-bright disabled:opacity-50 transition-colors"
        >
          {optimizeMutation.isPending ? <Loader2 className="animate-spin" size={16} /> : <Play size={16} />}
          RUN OPTIMIZE
        </button>
      </div>

      {optimizeMutation.isError && (
        <div className="mb-4 p-3 bg-terminal-neg/10 border border-terminal-neg/30 rounded flex items-center gap-2 text-terminal-neg text-xs">
          <AlertCircle size={14} />
          {extractApiErrorMessage(optimizeMutation.error, "Optimization failed")}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1">
        {/* Left Column: Config */}
        <div className="lg:col-span-1 space-y-4">
          <TerminalPanel title="Universe" subtitle="Assets & Timeframe">
            <div className="space-y-3 p-1">
              <div className="flex flex-col">
                <label className="text-[10px] text-terminal-muted uppercase">Universe (Tickers)</label>
                <textarea
                  className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-xs text-terminal-text focus:border-terminal-accent outline-none min-h-[80px]"
                  value={tickers}
                  onChange={(e) => setTickers(e.target.value)}
                  placeholder="AAPL,MSFT,..."
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col">
                  <label className="text-[10px] text-terminal-muted uppercase">Start Date</label>
                  <input
                    type="date"
                    className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-xs text-terminal-text focus:border-terminal-accent outline-none"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div className="flex flex-col">
                  <label className="text-[10px] text-terminal-muted uppercase">End Date</label>
                  <input
                    type="date"
                    className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-xs text-terminal-text focus:border-terminal-accent outline-none"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </TerminalPanel>

          <TerminalPanel title="Model & Objective" subtitle="Optimization Logic">
            <div className="space-y-3 p-1">
              <div className="flex flex-col">
                <label className="text-[10px] text-terminal-muted uppercase">Model</label>
                <select
                  className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-xs text-terminal-text focus:border-terminal-accent outline-none"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                >
                  {methods?.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col">
                <label className="text-[10px] text-terminal-muted uppercase">Covariance Estimator</label>
                <select
                  className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-xs text-terminal-text focus:border-terminal-accent outline-none"
                  value={covMethod}
                  onChange={(e) => setCovMethod(e.target.value)}
                >
                  {methods?.covariance_methods.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col">
                <label className="text-[10px] text-terminal-muted uppercase">Objective</label>
                <select
                  disabled={isHRP || isRP}
                  className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-xs text-terminal-text focus:border-terminal-accent outline-none disabled:opacity-50"
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                >
                  {methods?.objectives.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col">
                <label className="text-[10px] text-terminal-muted uppercase">Risk Measure</label>
                <select
                  disabled={isHRP || isRP}
                  className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-xs text-terminal-text focus:border-terminal-accent outline-none disabled:opacity-50"
                  value={riskMeasure}
                  onChange={(e) => setRiskMeasure(e.target.value)}
                >
                  {methods?.risk_measures.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              {isHRP && (
                <div className="text-[10px] text-terminal-accent italic">
                  * Objective & Risk Measure are auto-managed by {model}
                </div>
              )}
              {isRP && (
                <div className="text-[10px] text-terminal-accent italic">
                  * Risk Parity equalizes risk contributions across assets.
                </div>
              )}
            </div>
          </TerminalPanel>

          <TerminalPanel title="Constraints" subtitle="Risk & Weights">
            <div className="space-y-3 p-1">
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col">
                  <label className="text-[10px] text-terminal-muted uppercase">Min Weight</label>
                  <input
                    type="number"
                    step="0.01"
                    className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-xs text-terminal-text focus:border-terminal-accent outline-none"
                    value={minWeight}
                    onChange={(e) => setMinWeight(parseFloat(e.target.value))}
                  />
                </div>
                <div className="flex flex-col">
                  <label className="text-[10px] text-terminal-muted uppercase">Max Weight</label>
                  <input
                    type="number"
                    step="0.01"
                    className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-xs text-terminal-text focus:border-terminal-accent outline-none"
                    value={maxWeight}
                    onChange={(e) => setMaxWeight(parseFloat(e.target.value))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col">
                  <label className="text-[10px] text-terminal-muted uppercase">Confidence</label>
                  <input
                    type="number"
                    step="0.01"
                    className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-xs text-terminal-text focus:border-terminal-accent outline-none"
                    value={confidence}
                    onChange={(e) => setConfidence(parseFloat(e.target.value))}
                  />
                </div>
                <div className="flex flex-col">
                  <label className="text-[10px] text-terminal-muted uppercase">Risk-Free Rate</label>
                  <input
                    type="number"
                    step="0.001"
                    className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-xs text-terminal-text focus:border-terminal-accent outline-none"
                    value={riskFreeRate}
                    onChange={(e) => setRiskFreeRate(parseFloat(e.target.value))}
                  />
                </div>
              </div>

              <div className="flex flex-col">
                <label className="text-[10px] text-terminal-muted uppercase">Risk Aversion</label>
                <input
                  type="number"
                  step="0.1"
                  className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-xs text-terminal-text focus:border-terminal-accent outline-none"
                  value={riskAversion}
                  onChange={(e) => setRiskAversion(parseFloat(e.target.value))}
                />
              </div>
            </div>
          </TerminalPanel>
        </div>

        {/* Right Column: Results */}
        <div className="lg:col-span-2 space-y-4">
          {!result && !optimizeMutation.isPending && (
            <div className="h-full flex flex-col items-center justify-center border-2 border-dashed border-terminal-border rounded-lg p-12 text-terminal-muted text-center">
              <TrendingUp size={48} className="mb-4 opacity-20" />
              <div className="text-lg font-bold mb-1 uppercase tracking-tighter">No Optimization Data</div>
              <div className="text-xs max-w-xs">Configure and click RUN OPTIMIZE to generate efficient frontier and weights.</div>
            </div>
          )}

          {optimizeMutation.isPending && (
            <div className="h-full flex flex-col items-center justify-center bg-terminal-panel/30 rounded-lg p-12 text-terminal-accent text-center">
              <Loader2 size={48} className="mb-4 animate-spin" />
              <div className="text-lg font-bold mb-1 uppercase tracking-tighter">Optimizing...</div>
              <div className="text-xs animate-pulse">Computing covariance matrices and solving convex objective</div>
            </div>
          )}

          {result && (
            <>
              {/* Metrics Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {[
                  { label: "Expected Return", val: result.metrics.expected_return, fmt: "%", color: "text-terminal-accent" },
                  { label: "Volatility", val: result.metrics.volatility, fmt: "%" },
                  { label: "Sharpe Ratio", val: result.metrics.sharpe, fmt: "" },
                  { label: "Sortino Ratio", val: result.metrics.sortino, fmt: "" },
                  { label: "Max Drawdown", val: result.metrics.max_drawdown, fmt: "%", color: "text-terminal-neg" },
                  { label: "CVaR (95%)", val: result.metrics.cvar, fmt: "%", color: "text-terminal-neg" },
                  { label: "Ulcer Index", val: result.metrics.ulcer_index, fmt: "" },
                  { label: "CDaR", val: result.metrics.cdar, fmt: "%" },
                ].map((m, i) => (
                  <div key={i} className="bg-terminal-panel border border-terminal-border p-2 rounded">
                    <div className="text-[10px] text-terminal-muted uppercase">{m.label}</div>
                    <div className={`text-sm font-mono font-bold ${m.color || "text-terminal-text"}`}>
                      {m.val != null ? (m.fmt === "%" ? (m.val * 100).toFixed(2) : m.val.toFixed(2)) : "N/A"}{m.fmt}
                    </div>
                  </div>
                ))}
              </div>

              {/* Efficient Frontier */}
              <TerminalPanel title="Efficient Frontier" subtitle="Risk vs Return">
                <div className="h-[300px] w-full mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" vertical={false} />
                      <XAxis
                        type="number"
                        dataKey="risk"
                        name="Volatility"
                        stroke="#4B5563"
                        fontSize={10}
                        tickFormatter={(v) => (v * 100).toFixed(0) + "%"}
                      />
                      <YAxis
                        type="number"
                        dataKey="return"
                        name="Return"
                        stroke="#4B5563"
                        fontSize={10}
                        tickFormatter={(v) => (v * 100).toFixed(0) + "%"}
                      />
                      <ZAxis type="number" range={[50, 400]} />
                      <Tooltip
                        cursor={{ strokeDasharray: "3 3" }}
                        contentStyle={{ backgroundColor: "#000", borderColor: "#374151", fontSize: "10px" }}
                      />
                      <Scatter name="Frontier" data={result.frontier} fill="#4B5563" line shape="circle" />
                      <Scatter name="Optimal" data={[result.selected_point]} fill="#3B82F6">
                        <Cell fill="#3B82F6" stroke="#fff" strokeWidth={2} />
                      </Scatter>
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </TerminalPanel>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Optimal Allocation */}
                <TerminalPanel title="Optimal Allocation" subtitle="Portfolio Weights">
                  <div className="space-y-2 p-1 overflow-auto max-h-[300px]">
                    {Object.entries(result.weights)
                      .filter(([_, w]) => w > 0.0001)
                      .sort((a, b) => b[1] - a[1])
                      .map(([sym, w]) => (
                        <div key={sym} className="flex items-center gap-2">
                          <div className="w-16 font-bold text-[10px]">{sym}</div>
                          <div className="flex-1 h-2 bg-terminal-bg border border-terminal-border rounded-full overflow-hidden">
                            <div className="h-full bg-terminal-accent" style={{ width: `${w * 100}%` }} />
                          </div>
                          <div className="w-12 text-right font-mono text-[10px]">{(w * 100).toFixed(1)}%</div>
                        </div>
                      ))}
                  </div>
                </TerminalPanel>

                {/* Risk Contribution */}
                <TerminalPanel title="Risk Contribution" subtitle="Component Risk">
                  <div className="space-y-2 p-1 overflow-auto max-h-[300px]">
                    {Object.entries(result.risk_contributions)
                      .sort((a, b) => b[1] - a[1])
                      .map(([sym, r]) => (
                        <div key={sym} className="flex items-center gap-2">
                          <div className="w-16 font-bold text-[10px]">{sym}</div>
                          <div className="flex-1 h-2 bg-terminal-bg border border-terminal-border rounded-full overflow-hidden">
                            <div className="h-full bg-orange-500" style={{ width: `${r * 100}%` }} />
                          </div>
                          <div className="w-12 text-right font-mono text-[10px]">{(r * 100).toFixed(1)}%</div>
                        </div>
                      ))}
                  </div>
                </TerminalPanel>
              </div>

              {/* Cluster Structure */}
              {!!result?.clusters?.groups?.length && (
                <TerminalPanel title="Cluster Structure" subtitle="Hierarchical asset grouping">
                  <div className="space-y-3 p-1">
                    {result.clusters.groups.map((group, i) => {
                      const accents = [
                        "text-terminal-accent border-terminal-accent",
                        "text-orange-500 border-orange-500",
                        "text-terminal-pos border-terminal-pos",
                        "text-terminal-neg border-terminal-neg",
                      ];
                      const accentClass = accents[i % accents.length];
                      
                      const sortedSymbols = [...group.symbols].sort((a, b) => {
                        const idxA = result.clusters?.leaf_order.indexOf(a) ?? 0;
                        const idxB = result.clusters?.leaf_order.indexOf(b) ?? 0;
                        return idxA - idxB;
                      });

                      return (
                        <div key={group.id} className="flex items-center gap-3">
                          <div className={`w-8 font-bold text-[10px] uppercase ${accentClass.split(' ')[0]}`}>C{group.id}</div>
                          <div className="flex flex-wrap gap-1">
                            {sortedSymbols.map((sym) => (
                              <span
                                key={sym}
                                className="px-2 py-0.5 border border-terminal-border rounded text-[10px] bg-terminal-bg text-terminal-text"
                              >
                                {sym}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </TerminalPanel>
              )}

              {/* Asset Metrics Table */}
              <TerminalPanel title="Per-Asset Metrics" subtitle="Individual Performance">
                <div className="overflow-auto -m-1">
                  <table className="w-full text-[10px] text-left">
                    <thead className="sticky top-0 bg-terminal-bg text-terminal-muted border-b border-terminal-border">
                      <tr>
                        <th className="p-2 uppercase">Symbol</th>
                        <th className="p-2 uppercase text-right">Ann. Return</th>
                        <th className="p-2 uppercase text-right">Ann. Vol</th>
                        <th className="p-2 uppercase text-right">Weight</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-terminal-border/40">
                      {result.asset_metrics.map((row, i) => (
                        <tr key={i} className="hover:bg-terminal-accent/5">
                          <td className="p-2 font-bold">{row.symbol}</td>
                          <td className="p-2 text-right font-mono">{(row.annual_return * 100).toFixed(2)}%</td>
                          <td className="p-2 text-right font-mono">{(row.annual_vol * 100).toFixed(2)}%</td>
                          <td className="p-2 text-right font-mono font-bold text-terminal-accent">
                            {(row.weight * 100).toFixed(2)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </TerminalPanel>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
