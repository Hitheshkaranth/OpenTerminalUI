import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Workflow,
  Boxes,
  Play,
  Loader2,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  CheckCircle2,
  AlertCircle
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from "recharts";

import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { extractApiErrorMessage } from "../api/base";
import {
  fetchFrameworkModels,
  runFrameworkBacktest,
  FrameworkBacktestRequest,
  ModelDef
} from "../api/framework";

export function AlgorithmFrameworkLab() {
  // --- Form State ---
  const [tickers, setTickers] = useState("RELIANCE,TCS,INFY,HDFCBANK,ICICIBANK");
  const [benchmark, setBenchmark] = useState("^NSEI");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [rebalanceFreq, setRebalanceFreq] = useState("ME");
  const [initialCash, setInitialCash] = useState(1000000);
  const [transactionCostBps, setTransactionCostBps] = useState(10);
  const [topN, setTopN] = useState(10);
  const [longOnly, setLongOnly] = useState(true);

  const [selectedAlphaId, setSelectedAlphaId] = useState("");
  const [alphaParams, setAlphaParams] = useState<Record<string, number>>({});

  const [selectedPCId, setSelectedPCId] = useState("");
  const [pcParams, setPcParams] = useState<Record<string, number>>({});

  const [enabledRiskModelIds, setEnabledRiskModelIds] = useState<Set<string>>(new Set());
  const [riskParams, setRiskParams] = useState<Record<string, Record<string, number>>>({});

  // --- Data Fetching ---
  const { data: models, isPending: isPendingModels } = useQuery({
    queryKey: ["framework-models"],
    queryFn: fetchFrameworkModels,
  });

  const backtestMutation = useMutation({
    mutationFn: (req: FrameworkBacktestRequest) => runFrameworkBacktest(req),
  });

  // --- Effects to initialize defaults ---
  useEffect(() => {
    if (models?.alpha?.length && !selectedAlphaId) {
      const first = models.alpha[0];
      setSelectedAlphaId(first.id);
      const defaults: Record<string, number> = {};
      first.params.forEach(p => defaults[p.key] = p.default);
      setAlphaParams(defaults);
    }
    if (models?.portfolio_construction?.length && !selectedPCId) {
      const first = models.portfolio_construction[0];
      setSelectedPCId(first.id);
      const defaults: Record<string, number> = {};
      first.params.forEach(p => defaults[p.key] = p.default);
      setPcParams(defaults);
    }
  }, [models, selectedAlphaId, selectedPCId]);

  // --- Handlers ---
  const handleAlphaChange = (id: string) => {
    setSelectedAlphaId(id);
    const model = models?.alpha.find(m => m.id === id);
    if (model) {
      const defaults: Record<string, number> = {};
      model.params.forEach(p => defaults[p.key] = p.default);
      setAlphaParams(defaults);
    }
  };

  const handlePCChange = (id: string) => {
    setSelectedPCId(id);
    const model = models?.portfolio_construction.find(m => m.id === id);
    if (model) {
      const defaults: Record<string, number> = {};
      model.params.forEach(p => defaults[p.key] = p.default);
      setPcParams(defaults);
    }
  };

  const toggleRiskModel = (id: string) => {
    setEnabledRiskModelIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        // Initialize params if not already set
        if (!riskParams[id]) {
          const model = models?.risk.find(m => m.id === id);
          if (model) {
            const defaults: Record<string, number> = {};
            model.params.forEach(p => defaults[p.key] = p.default);
            setRiskParams(prevRisk => ({ ...prevRisk, [id]: defaults }));
          }
        }
      }
      return next;
    });
  };

  const handleRunBacktest = () => {
    const req: FrameworkBacktestRequest = {
      tickers: tickers.split(",").map(s => s.trim()).filter(Boolean),
      start: startDate || null,
      end: endDate || null,
      benchmark: benchmark || null,
      rebalance_freq: rebalanceFreq,
      initial_cash: initialCash,
      transaction_cost_bps: transactionCostBps,
      top_n: topN,
      long_only: longOnly,
      alpha: { id: selectedAlphaId, params: alphaParams },
      portfolio_construction: { id: selectedPCId, params: pcParams },
      risk: Array.from(enabledRiskModelIds).map(id => ({
        id,
        params: riskParams[id] || {}
      }))
    };
    backtestMutation.mutate(req);
  };

  // --- Rendering Helpers ---
  const renderParamInputs = (
    model: ModelDef | undefined,
    currentParams: Record<string, number>,
    updateFn: (key: string, val: number) => void
  ) => {
    if (!model) return null;
    return (
      <div className="grid grid-cols-2 gap-2 mt-2">
        {model.params.map(p => (
          <div key={p.key} className="flex flex-col">
            <label className="text-[10px] text-terminal-muted uppercase">{p.label}</label>
            <input
              type="number"
              step={p.type === "float" ? "0.01" : "1"}
              className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-xs text-terminal-text focus:border-terminal-accent outline-none"
              value={currentParams[p.key] ?? p.default}
              onChange={(e) => updateFn(p.key, parseFloat(e.target.value))}
            />
          </div>
        ))}
      </div>
    );
  };

  if (isPendingModels) {
    return (
      <div className="flex h-full items-center justify-center bg-terminal-bg text-terminal-accent">
        <Loader2 className="animate-spin mr-2" />
        <span className="ot-type-label">INITIALIZING FRAMEWORK...</span>
      </div>
    );
  }

  const result = backtestMutation.data;

  return (
    <div className="flex h-full flex-col overflow-auto bg-terminal-bg text-terminal-text p-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-terminal-border pb-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="bg-terminal-accent/10 p-2 rounded border border-terminal-accent/30">
            <Boxes className="text-terminal-accent" size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-terminal-accent uppercase tracking-wider">Algorithm Framework Lab</h1>
            <p className="text-xs text-terminal-muted">Compose Alpha → Portfolio Construction → Risk → Execution</p>
          </div>
        </div>

        <button
          onClick={handleRunBacktest}
          disabled={backtestMutation.isPending}
          className="flex items-center gap-2 bg-terminal-accent text-terminal-bg px-4 py-2 rounded font-bold text-sm hover:bg-terminal-accent-bright disabled:opacity-50 transition-colors"
        >
          {backtestMutation.isPending ? <Loader2 className="animate-spin" size={16} /> : <Play size={16} />}
          RUN BACKTEST
        </button>
      </div>

      {backtestMutation.isError && (
        <div className="mb-4 p-3 bg-terminal-neg/10 border border-terminal-neg/30 rounded flex items-center gap-2 text-terminal-neg text-xs">
          <AlertCircle size={14} />
          {extractApiErrorMessage(backtestMutation.error, "Failed to run backtest")}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1">
        {/* Left Column: Config */}
        <div className="lg:col-span-1 space-y-4">
          <TerminalPanel title="Universe & Parameters" subtitle="Core settings">
            <div className="space-y-3 p-1">
              <div className="flex flex-col">
                <label className="text-[10px] text-terminal-muted uppercase">Universe (Tickers)</label>
                <textarea
                  className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-xs text-terminal-text focus:border-terminal-accent outline-none min-h-[60px]"
                  value={tickers}
                  onChange={(e) => setTickers(e.target.value)}
                  placeholder="AAPL,MSFT,..."
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col">
                  <label className="text-[10px] text-terminal-muted uppercase">Benchmark</label>
                  <input
                    className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-xs text-terminal-text focus:border-terminal-accent outline-none"
                    value={benchmark}
                    onChange={(e) => setBenchmark(e.target.value)}
                  />
                </div>
                <div className="flex flex-col">
                  <label className="text-[10px] text-terminal-muted uppercase">Rebalance</label>
                  <select
                    className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-xs text-terminal-text focus:border-terminal-accent outline-none"
                    value={rebalanceFreq}
                    onChange={(e) => setRebalanceFreq(e.target.value)}
                  >
                    <option value="W">Weekly</option>
                    <option value="ME">Monthly (End)</option>
                    <option value="QE">Quarterly (End)</option>
                  </select>
                </div>
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

              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col">
                  <label className="text-[10px] text-terminal-muted uppercase">Initial Cash</label>
                  <input
                    type="number"
                    className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-xs text-terminal-text focus:border-terminal-accent outline-none"
                    value={initialCash}
                    onChange={(e) => setInitialCash(parseInt(e.target.value))}
                  />
                </div>
                <div className="flex flex-col">
                  <label className="text-[10px] text-terminal-muted uppercase">Costs (bps)</label>
                  <input
                    type="number"
                    className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-xs text-terminal-text focus:border-terminal-accent outline-none"
                    value={transactionCostBps}
                    onChange={(e) => setTransactionCostBps(parseInt(e.target.value))}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center gap-4">
                  <div className="flex flex-col">
                    <label className="text-[10px] text-terminal-muted uppercase">Top N</label>
                    <input
                      type="number"
                      className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-xs text-terminal-text focus:border-terminal-accent outline-none w-20"
                      value={topN}
                      onChange={(e) => setTopN(parseInt(e.target.value))}
                    />
                  </div>
                  <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={longOnly}
                      onChange={(e) => setLongOnly(e.target.checked)}
                      className="accent-terminal-accent"
                    />
                    Long Only
                  </label>
                </div>
              </div>
            </div>
          </TerminalPanel>

          <TerminalPanel title="Alpha Strategy" subtitle="Generation model">
            <div className="space-y-3">
              <select
                className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-xs text-terminal-text focus:border-terminal-accent outline-none"
                value={selectedAlphaId}
                onChange={(e) => handleAlphaChange(e.target.value)}
              >
                {models?.alpha.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>

              {renderParamInputs(
                models?.alpha.find(m => m.id === selectedAlphaId),
                alphaParams,
                (key, val) => setAlphaParams(prev => ({ ...prev, [key]: val }))
              )}
            </div>
          </TerminalPanel>

          <TerminalPanel title="Portfolio Construction" subtitle="Weighting logic">
            <div className="space-y-3">
              <select
                className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-xs text-terminal-text focus:border-terminal-accent outline-none"
                value={selectedPCId}
                onChange={(e) => handlePCChange(e.target.value)}
              >
                {models?.portfolio_construction.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>

              {renderParamInputs(
                models?.portfolio_construction.find(m => m.id === selectedPCId),
                pcParams,
                (key, val) => setPcParams(prev => ({ ...prev, [key]: val }))
              )}
            </div>
          </TerminalPanel>

          <TerminalPanel title="Risk Overlay" subtitle="Constraint models">
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {models?.risk.map(m => (
                  <button
                    key={m.id}
                    onClick={() => toggleRiskModel(m.id)}
                    className={`px-2 py-1 rounded text-[10px] font-bold border transition-colors ${
                      enabledRiskModelIds.has(m.id)
                        ? "bg-terminal-accent/20 border-terminal-accent text-terminal-accent"
                        : "bg-terminal-bg border-terminal-border text-terminal-muted hover:border-terminal-muted"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {Array.from(enabledRiskModelIds).map(id => {
                const model = models?.risk.find(m => m.id === id);
                if (!model || model.params.length === 0) return null;
                return (
                  <div key={id} className="border-t border-terminal-border pt-2">
                    <div className="text-[10px] font-bold text-terminal-accent uppercase mb-1">{model.label} Params</div>
                    {renderParamInputs(
                      model,
                      riskParams[id] || {},
                      (key, val) => setRiskParams(prev => ({
                        ...prev,
                        [id]: { ...(prev[id] || {}), [key]: val }
                      }))
                    )}
                  </div>
                );
              })}
            </div>
          </TerminalPanel>
        </div>

        {/* Right Column: Results */}
        <div className="lg:col-span-2 space-y-4">
          {!result && !backtestMutation.isPending && (
            <div className="h-full flex flex-col items-center justify-center border-2 border-dashed border-terminal-border rounded-lg p-12 text-terminal-muted text-center">
              <Workflow size={48} className="mb-4 opacity-20" />
              <div className="text-lg font-bold mb-1">NO SIMULATION DATA</div>
              <div className="text-xs max-w-xs">Configure your framework components and click "RUN BACKTEST" to begin simulation.</div>
            </div>
          )}

          {backtestMutation.isPending && (
            <div className="h-full flex flex-col items-center justify-center bg-terminal-panel/30 rounded-lg p-12 text-terminal-accent text-center">
              <Loader2 size={48} className="mb-4 animate-spin" />
              <div className="text-lg font-bold mb-1 uppercase tracking-tighter">Running Engine...</div>
              <div className="text-xs animate-pulse">Calculating path dependencies and risk overlays</div>
            </div>
          )}

          {result && (
            <>
              {/* Summary Metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {[
                  { label: "Total Return", val: result.summary.strategy.total_return, fmt: "%", color: "text-terminal-accent" },
                  { label: "CAGR", val: result.summary.strategy.cagr, fmt: "%" },
                  { label: "Sharpe Ratio", val: result.summary.strategy.sharpe, fmt: "" },
                  { label: "Alpha Total", val: result.summary.alpha_total_return, fmt: "%", color: result.summary.alpha_total_return == null ? undefined : result.summary.alpha_total_return >= 0 ? "text-terminal-pos" : "text-terminal-neg" },
                  { label: "Volatility", val: result.summary.strategy.volatility, fmt: "%" },
                  { label: "Max Drawdown", val: result.summary.strategy.max_drawdown, fmt: "%", color: "text-terminal-neg" },
                  { label: "Benchmark Ret", val: result.summary.benchmark?.total_return, fmt: "%", color: "text-terminal-muted" },
                  { label: "Holdings Count", val: Object.keys(result.holdings[result.holdings.length - 1]?.weights || {}).length, fmt: "int" },
                ].map((m, i) => (
                  <div key={i} className="bg-terminal-panel border border-terminal-border p-2 rounded">
                    <div className="text-[10px] text-terminal-muted uppercase">{m.label}</div>
                    <div className={`text-sm font-mono font-bold ${m.color || "text-terminal-text"}`}>
                      {m.val != null ? (typeof m.val === 'number' ? (m.fmt === "%" ? (m.val * 100).toFixed(2) : m.fmt === "int" ? String(Math.round(m.val)) : m.val.toFixed(2)) : m.val) : "N/A"}{m.fmt === "%" ? "%" : ""}
                    </div>
                  </div>
                ))}
              </div>

              {/* Equity Curve */}
              <TerminalPanel title="Equity Curve Simulation" subtitle="Strategy vs Benchmark">
                <div className="h-[300px] w-full mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={result.equity_curve} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" vertical={false} />
                      <XAxis
                        dataKey="date"
                        stroke="#4B5563"
                        fontSize={8}
                        tickFormatter={(v) => v.split('-')[0]} // Just year for brevity
                      />
                      <YAxis stroke="#4B5563" fontSize={10} domain={['auto', 'auto']} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#000', borderColor: '#374151', fontSize: '10px' }}
                        itemStyle={{ padding: '0px' }}
                      />
                      <Legend iconType="rect" wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} />
                      <Line
                        type="monotone"
                        dataKey="strategy"
                        stroke="#3B82F6"
                        strokeWidth={2}
                        dot={false}
                        name="Strategy"
                      />
                      {result.equity_curve[0]?.benchmark !== null && (
                        <Line
                          type="monotone"
                          dataKey="benchmark"
                          stroke="#6B7280"
                          strokeWidth={1}
                          strokeDasharray="4 4"
                          dot={false}
                          name="Benchmark"
                        />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </TerminalPanel>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Insights Table */}
                <TerminalPanel title="Strategy Insights" subtitle="Recent signals">
                  <div className="overflow-auto max-h-[300px] -m-1">
                    <table className="w-full text-[10px] text-left">
                      <thead className="sticky top-0 bg-terminal-bg text-terminal-muted border-b border-terminal-border">
                        <tr>
                          <th className="p-2 uppercase">Date</th>
                          <th className="p-2 uppercase">Symbol</th>
                          <th className="p-2 uppercase">Dir</th>
                          <th className="p-2 uppercase text-right">Conf</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-terminal-border/40">
                        {result.insights.slice(0, 200).map((row, i) => (
                          <tr key={i} className="hover:bg-terminal-accent/5">
                            <td className="p-2 text-terminal-muted">{row.date}</td>
                            <td className="p-2 font-bold">{row.symbol}</td>
                            <td className="p-2">
                              {row.direction > 0 ? <ArrowUpRight size={12} className="text-terminal-pos" /> :
                               row.direction < 0 ? <ArrowDownRight size={12} className="text-terminal-neg" /> :
                               <Minus size={12} className="text-terminal-muted" />}
                            </td>
                            <td className="p-2 text-right font-mono">{(row.confidence * 100).toFixed(1)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </TerminalPanel>

                {/* Latest Holdings */}
                <TerminalPanel title="Current Portfolio" subtitle="Latest rebalance weights">
                  <div className="space-y-2 p-1">
                    {result.holdings.length > 0 ? (
                      (() => {
                        const latest = result.holdings[result.holdings.length - 1];
                        const weights = Object.entries(latest.weights).sort((a, b) => b[1] - a[1]);
                        return (
                          <div className="space-y-1">
                            <div className="text-[9px] text-terminal-muted mb-2 italic">Rebalanced on {latest.rebalance_date} (Turnover: {(latest.turnover * 100).toFixed(1)}%)</div>
                            {weights.map(([sym, w]) => (
                              <div key={sym} className="flex items-center gap-2">
                                <div className="w-16 font-bold text-[10px]">{sym}</div>
                                <div className="flex-1 h-2 bg-terminal-bg border border-terminal-border rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-terminal-accent"
                                    style={{ width: `${w * 100}%` }}
                                  />
                                </div>
                                <div className="w-10 text-right font-mono text-[10px]">{(w * 100).toFixed(1)}%</div>
                              </div>
                            ))}
                          </div>
                        );
                      })()
                    ) : (
                      <div className="text-center py-8 text-terminal-muted italic text-xs">No holdings data</div>
                    )}
                  </div>
                </TerminalPanel>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
