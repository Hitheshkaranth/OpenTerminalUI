import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { TerminalBadge } from "../terminal/TerminalBadge";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { ScenarioBuilder, type StressAnalysisMode, type StressCustomParams, type StressScenarioDescriptor } from "./ScenarioBuilder";

type StressHoldingImpact = {
  symbol: string;
  sector: string;
  current_value: number;
  stressed_value: number;
  pnl: number;
  pnl_pct: number;
  contribution_pct: number;
};

type StressResult = {
  scenario: string;
  scenario_key: string;
  portfolio_id: string;
  portfolio_value: number;
  stressed_value: number;
  total_pnl: number;
  total_pnl_pct: number;
  holdings: StressHoldingImpact[];
  sector_summary: Array<{ sector: string; pnl: number; pnl_pct: number; weight_pct?: number }>;
};

type ReplayPoint = {
  date: string;
  portfolio_value: number;
  pnl: number;
  pnl_pct: number;
  drawdown_pct: number;
};

type ReplayResult = {
  scenario: string;
  scenario_key: string;
  portfolio_id: string;
  starting_value: number;
  ending_value: number;
  max_drawdown_pct: number;
  recovery_days: number;
  timeline: ReplayPoint[];
};

const DEFAULT_CUSTOM_PARAMS: StressCustomParams = {
  equity: -0.2,
  rates: 0.01,
  oil: -0.3,
  fx_usd: 0.05,
  credit_spread: 0.02,
};

const STRESS_COLORS = ["#26A65B", "#E84142", "#F39C12", "#5B8FF9", "#9B59B6", "#E67E22", "#1ABC9C"];

function buildAuthHeaders(): HeadersInit {
  const token = localStorage.getItem("ot-access-token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...buildAuthHeaders(),
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    let detail = text;
    try {
      const parsed = JSON.parse(text) as { detail?: unknown };
      detail = typeof parsed.detail === "string" ? parsed.detail : detail;
    } catch {
      // leave raw text in place
    }
    throw new Error(detail || `Request failed (${response.status})`);
  }
  return (text ? (JSON.parse(text) as T) : ({} as T));
}

function formatMoney(value: number) {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPct(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(2)}%`;
}

export function StressTestPanel() {
  const [portfolioId, setPortfolioId] = useState("current");
  const [analysisMode, setAnalysisMode] = useState<StressAnalysisMode>("stress");
  const [scenarioKey, setScenarioKey] = useState("2008_gfc");
  const [scenarios, setScenarios] = useState<StressScenarioDescriptor[]>([]);
  const [customParams, setCustomParams] = useState<StressCustomParams>(DEFAULT_CUSTOM_PARAMS);
  const [stressResult, setStressResult] = useState<StressResult | null>(null);
  const [replayResult, setReplayResult] = useState<ReplayResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [replayLoading, setReplayLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stressNonce, setStressNonce] = useState(0);
  const [replayNonce, setReplayNonce] = useState(0);
  const stressRequestRef = useRef(0);
  const replayRequestRef = useRef(0);

  useEffect(() => {
    void (async () => {
      try {
        const payload = await requestJson<{ items: StressScenarioDescriptor[] }>("/risk/stress-test/scenarios", { method: "GET" });
        const next = Array.isArray(payload.items) ? payload.items : [];
        setScenarios(next);
        if (next.length > 0 && !next.some((item) => item.key === scenarioKey)) {
          setScenarioKey(next[0].key);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load stress scenarios");
      }
    })();
    // We only want the initial load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedScenario = useMemo(() => {
    return scenarios.find((item) => item.key === scenarioKey) ?? null;
  }, [scenarios, scenarioKey]);

  const sortedHoldings = useMemo(() => {
    return [...(stressResult?.holdings || [])].sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
  }, [stressResult]);

  const sectorData = useMemo(() => {
    return [...(stressResult?.sector_summary || [])].sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
  }, [stressResult]);

  const replayTimeline = replayResult?.timeline ?? [];
  const replaySeries = useMemo(
    () =>
      replayTimeline.map((point) => ({
        date: point.date.slice(5),
        value: point.portfolio_value,
        drawdown: point.drawdown_pct * 100,
      })),
    [replayTimeline],
  );

  const runStress = async () => {
    const requestId = ++stressRequestRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await requestJson<StressResult>("/risk/stress-test", {
        method: "POST",
        body: JSON.stringify({
          portfolio_id: portfolioId.trim() || "current",
          scenario: scenarioKey,
          custom_params: customParams,
        }),
      });
      if (requestId !== stressRequestRef.current) return;
      setStressResult(result);
      setReplayResult(null);
    } catch (err) {
      if (requestId !== stressRequestRef.current) return;
      setStressResult(null);
      setError(err instanceof Error ? err.message : "Failed to run stress test");
    } finally {
      if (requestId === stressRequestRef.current) setLoading(false);
    }
  };

  const runReplay = async () => {
    const requestId = ++replayRequestRef.current;
    setReplayLoading(true);
    setError(null);
    try {
      const result = await requestJson<ReplayResult>("/risk/stress-test/replay", {
        method: "POST",
        body: JSON.stringify({
          portfolio_id: portfolioId.trim() || "current",
          scenario: scenarioKey,
        }),
      });
      if (requestId !== replayRequestRef.current) return;
      setReplayResult(result);
      setStressResult(null);
    } catch (err) {
      if (requestId !== replayRequestRef.current) return;
      setReplayResult(null);
      setError(err instanceof Error ? err.message : "Failed to run historical replay");
    } finally {
      if (requestId === replayRequestRef.current) setReplayLoading(false);
    }
  };

  useEffect(() => {
    if (analysisMode !== "stress") return;
    const timer = window.setTimeout(() => {
      void runStress();
    }, 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisMode, portfolioId, scenarioKey, customParams, stressNonce]);

  useEffect(() => {
    if (analysisMode !== "replay") return;
    const timer = window.setTimeout(() => {
      void runReplay();
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisMode, portfolioId, scenarioKey, replayNonce]);

  return (
    <div className="space-y-3">
      <ScenarioBuilder
        analysisMode={analysisMode}
        onAnalysisModeChange={setAnalysisMode}
        portfolioId={portfolioId}
        onPortfolioIdChange={setPortfolioId}
        scenarios={scenarios}
        selectedScenarioKey={scenarioKey}
        onScenarioKeyChange={setScenarioKey}
        customParams={customParams}
        onCustomParamsChange={setCustomParams}
        onRun={() => {
          setAnalysisMode("stress");
          setStressNonce((value) => value + 1);
        }}
        onReplay={() => {
          setAnalysisMode("replay");
          setReplayNonce((value) => value + 1);
        }}
        running={loading}
        replaying={replayLoading}
      />

      {error ? <div className="rounded border border-terminal-neg bg-terminal-neg/10 px-3 py-2 text-xs text-terminal-neg">{error}</div> : null}

      {analysisMode === "stress" ? (
        <div className="grid gap-3 xl:grid-cols-[1.2fr_0.8fr]">
          <TerminalPanel
            title="Stress Impact"
            subtitle={selectedScenario ? selectedScenario.name : "Portfolio stress preview"}
            actions={<TerminalBadge variant={loading ? "warn" : "live"}>{loading ? "RUNNING" : "READY"}</TerminalBadge>}
          >
            {stressResult ? (
              <div className="space-y-4 p-1">
                <div className="grid gap-2 md:grid-cols-4">
                  <div className="rounded border border-terminal-border bg-terminal-bg/60 p-2">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-terminal-muted">Portfolio Value</div>
                    <div className="text-sm text-terminal-text">{formatMoney(stressResult.portfolio_value)}</div>
                  </div>
                  <div className="rounded border border-terminal-border bg-terminal-bg/60 p-2">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-terminal-muted">Stressed Value</div>
                    <div className="text-sm text-terminal-text">{formatMoney(stressResult.stressed_value)}</div>
                  </div>
                  <div className="rounded border border-terminal-border bg-terminal-bg/60 p-2">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-terminal-muted">P&L</div>
                    <div className={`text-sm ${stressResult.total_pnl >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>{formatMoney(stressResult.total_pnl)}</div>
                  </div>
                  <div className="rounded border border-terminal-border bg-terminal-bg/60 p-2">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-terminal-muted">P&L %</div>
                    <div className={`text-sm ${stressResult.total_pnl_pct >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>{formatPct(stressResult.total_pnl_pct)}</div>
                  </div>
                </div>

                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={sectorData} layout="vertical" margin={{ top: 8, right: 12, left: 24, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#263040" horizontal={false} />
                      <XAxis type="number" stroke="#6E7681" tickFormatter={formatMoney} />
                      <YAxis type="category" dataKey="sector" stroke="#6E7681" width={100} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#0D1117", border: "1px solid #263040", borderRadius: 4, fontSize: 11 }}
                        formatter={(value: number | undefined) => formatMoney(Number(value ?? 0))}
                      />
                      <Bar dataKey="pnl" radius={[0, 4, 4, 0]}>
                        {sectorData.map((entry, index) => (
                          <Cell key={entry.sector} fill={STRESS_COLORS[index % STRESS_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : (
              <div className="p-4 text-xs text-terminal-muted">Run the stress test to populate sector and holding impacts.</div>
            )}
          </TerminalPanel>

          <TerminalPanel title="Holding Breakdown" subtitle="Per-position stress contribution">
            <div className="max-h-[32rem] overflow-auto">
              <table className="w-full border-collapse text-left text-[11px]">
                <thead className="sticky top-0 bg-terminal-panel text-[10px] uppercase tracking-[0.18em] text-terminal-muted">
                  <tr>
                    <th className="border-b border-terminal-border px-2 py-2">Symbol</th>
                    <th className="border-b border-terminal-border px-2 py-2">Sector</th>
                    <th className="border-b border-terminal-border px-2 py-2 text-right">Current</th>
                    <th className="border-b border-terminal-border px-2 py-2 text-right">Stressed</th>
                    <th className="border-b border-terminal-border px-2 py-2 text-right">P&L</th>
                    <th className="border-b border-terminal-border px-2 py-2 text-right">P&L %</th>
                    <th className="border-b border-terminal-border px-2 py-2 text-right">Contribution</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-terminal-border/50">
                  {sortedHoldings.map((item) => (
                    <tr key={item.symbol} className="hover:bg-terminal-bg/50">
                      <td className="px-2 py-2 font-semibold text-terminal-accent">{item.symbol}</td>
                      <td className="px-2 py-2 text-terminal-muted">{item.sector}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatMoney(item.current_value)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatMoney(item.stressed_value)}</td>
                      <td className={`px-2 py-2 text-right tabular-nums ${item.pnl >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>{formatMoney(item.pnl)}</td>
                      <td className={`px-2 py-2 text-right tabular-nums ${item.pnl_pct >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>{formatPct(item.pnl_pct)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-terminal-text">{formatPct(item.contribution_pct)}</td>
                    </tr>
                  ))}
                  {!sortedHoldings.length ? (
                    <tr>
                      <td className="px-2 py-4 text-center text-terminal-muted" colSpan={7}>
                        No result yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </TerminalPanel>
        </div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-[1fr_0.9fr]">
          <TerminalPanel
            title="Historical Replay"
            subtitle={replayResult ? replayResult.scenario : "Replay the scenario path across the crisis window"}
            actions={<TerminalBadge variant={replayLoading ? "warn" : "live"}>{replayLoading ? "REPLAYING" : "READY"}</TerminalBadge>}
          >
            {replayResult ? (
              <div className="space-y-4 p-1">
                <div className="grid gap-2 md:grid-cols-4">
                  <div className="rounded border border-terminal-border bg-terminal-bg/60 p-2">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-terminal-muted">Start</div>
                    <div className="text-sm text-terminal-text">{formatMoney(replayResult.starting_value)}</div>
                  </div>
                  <div className="rounded border border-terminal-border bg-terminal-bg/60 p-2">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-terminal-muted">End</div>
                    <div className="text-sm text-terminal-text">{formatMoney(replayResult.ending_value)}</div>
                  </div>
                  <div className="rounded border border-terminal-border bg-terminal-bg/60 p-2">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-terminal-muted">Max Drawdown</div>
                    <div className="text-sm text-terminal-neg">{formatPct(replayResult.max_drawdown_pct)}</div>
                  </div>
                  <div className="rounded border border-terminal-border bg-terminal-bg/60 p-2">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-terminal-muted">Recovery Days</div>
                    <div className="text-sm text-terminal-text">{replayResult.recovery_days}</div>
                  </div>
                </div>

                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={replaySeries} margin={{ top: 8, right: 12, left: -16, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#263040" vertical={false} />
                      <XAxis dataKey="date" stroke="#6E7681" tick={{ fontSize: 10 }} />
                      <YAxis yAxisId="left" stroke="#6E7681" tickFormatter={formatMoney} />
                      <YAxis yAxisId="right" orientation="right" stroke="#6E7681" tickFormatter={(value) => `${value.toFixed(0)}%`} domain={[-100, 0]} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#0D1117", border: "1px solid #263040", borderRadius: 4, fontSize: 11 }}
                        formatter={(value: number | undefined, name?: string) => {
                          const numeric = Number(value ?? 0);
                          return name === "drawdown" ? `${numeric.toFixed(2)}%` : formatMoney(numeric);
                        }}
                      />
                      <Line yAxisId="left" type="monotone" dataKey="value" stroke="#26A65B" strokeWidth={2} dot={false} name="Portfolio Value" />
                      <Area yAxisId="right" type="monotone" dataKey="drawdown" stroke="#E84142" fill="#E84142" fillOpacity={0.12} dot={false} name="Drawdown %" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : (
              <div className="p-4 text-xs text-terminal-muted">Run the replay to populate the crisis timeline.</div>
            )}
          </TerminalPanel>

          <TerminalPanel title="Replay Timeline" subtitle="Daily portfolio path and drawdown">
            <div className="max-h-[32rem] overflow-auto">
              <table className="w-full border-collapse text-left text-[11px]">
                <thead className="sticky top-0 bg-terminal-panel text-[10px] uppercase tracking-[0.18em] text-terminal-muted">
                  <tr>
                    <th className="border-b border-terminal-border px-2 py-2">Date</th>
                    <th className="border-b border-terminal-border px-2 py-2 text-right">Value</th>
                    <th className="border-b border-terminal-border px-2 py-2 text-right">P&L</th>
                    <th className="border-b border-terminal-border px-2 py-2 text-right">P&L %</th>
                    <th className="border-b border-terminal-border px-2 py-2 text-right">Drawdown</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-terminal-border/50">
                  {replayTimeline.map((item) => (
                    <tr key={item.date} className="hover:bg-terminal-bg/50">
                      <td className="px-2 py-2 text-terminal-text">{item.date}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatMoney(item.portfolio_value)}</td>
                      <td className={`px-2 py-2 text-right tabular-nums ${item.pnl >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>{formatMoney(item.pnl)}</td>
                      <td className={`px-2 py-2 text-right tabular-nums ${item.pnl_pct >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>{formatPct(item.pnl_pct)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-terminal-neg">{formatPct(item.drawdown_pct)}</td>
                    </tr>
                  ))}
                  {!replayTimeline.length ? (
                    <tr>
                      <td className="px-2 py-4 text-center text-terminal-muted" colSpan={5}>
                        No replay data yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </TerminalPanel>
        </div>
      )}
    </div>
  );
}
