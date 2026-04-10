import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  fetchPredefinedStressScenarios,
  fetchStressScenarioHistory,
  runStressMonteCarlo,
  runStressScenario,
} from "../../api/quantClient";
import { TerminalBadge } from "../terminal/TerminalBadge";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalPanel } from "../terminal/TerminalPanel";

type ScenarioDescriptor = {
  id: string;
  name: string;
  description: string;
  severity: "medium" | "high" | "extreme";
  shocks: Record<string, number>;
};

type ScenarioResult = {
  scenario_name: string;
  total_impact_pct: number;
  total_impact_value: number;
  by_holding: Array<{
    symbol: string;
    sector: string;
    weight: number;
    current_value: number;
    impact_pct: number;
    impact_value: number;
    new_value: number;
  }>;
  by_sector: Array<{
    sector: string;
    weight: number;
    impact_pct: number;
    impact_value: number;
  }>;
  worst_holdings: Array<{
    symbol: string;
    sector: string;
    current_value: number;
    impact_pct: number;
    impact_value: number;
  }>;
};

type MonteCarloResult = {
  percentiles: { p5: number; p25: number; p50: number; p75: number; p95: number };
  worst_case: number;
  best_case: number;
  paths: number[][];
};

type HistoryRow = {
  id: string;
  scenario_name: string;
  run_date: string;
  total_impact_pct: number;
};

type CustomShocks = {
  equity: number;
  rates: number;
  volatility: number;
  fx_inr: number;
  gold: number;
  crude_oil: number;
};

const DEFAULT_CUSTOM_SHOCKS: CustomShocks = {
  equity: -0.2,
  rates: 0,
  volatility: 0.1,
  fx_inr: 0,
  gold: 0,
  crude_oil: 0,
};

const HOLDING_COLORS = ["#E84142", "#F39C12", "#F7D154", "#26A65B", "#5B8FF9", "#9B59B6", "#1ABC9C"];
const PIE_COLORS = ["#E84142", "#F39C12", "#F7D154", "#5B8FF9", "#26A65B", "#9B59B6", "#1ABC9C"];

const FACTOR_SLIDERS: Array<{
  key: keyof CustomShocks;
  label: string;
  min: number;
  max: number;
  step: number;
  toStored: (value: number) => number;
  fromStored: (value: number) => number;
  format: (value: number) => string;
}> = [
  {
    key: "equity",
    label: "Equity",
    min: -50,
    max: 50,
    step: 1,
    toStored: (value) => value / 100,
    fromStored: (value) => value * 100,
    format: (value) => `${value > 0 ? "+" : ""}${value.toFixed(0)}%`,
  },
  {
    key: "rates",
    label: "Interest Rates",
    min: -500,
    max: 500,
    step: 25,
    toStored: (value) => value / 10000,
    fromStored: (value) => value * 10000,
    format: (value) => `${value > 0 ? "+" : ""}${value.toFixed(0)} bps`,
  },
  {
    key: "volatility",
    label: "Volatility",
    min: -50,
    max: 50,
    step: 1,
    toStored: (value) => value / 100,
    fromStored: (value) => value * 100,
    format: (value) => `${value > 0 ? "+" : ""}${value.toFixed(0)}%`,
  },
  {
    key: "fx_inr",
    label: "FX",
    min: -50,
    max: 50,
    step: 1,
    toStored: (value) => value / 100,
    fromStored: (value) => value * 100,
    format: (value) => `${value > 0 ? "+" : ""}${value.toFixed(0)}%`,
  },
  {
    key: "gold",
    label: "Gold",
    min: -50,
    max: 50,
    step: 1,
    toStored: (value) => value / 100,
    fromStored: (value) => value * 100,
    format: (value) => `${value > 0 ? "+" : ""}${value.toFixed(0)}%`,
  },
  {
    key: "crude_oil",
    label: "Crude",
    min: -50,
    max: 50,
    step: 1,
    toStored: (value) => value / 100,
    fromStored: (value) => value * 100,
    format: (value) => `${value > 0 ? "+" : ""}${value.toFixed(0)}%`,
  },
];

function formatPct(value: number) {
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function formatCurrency(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function severityVariant(severity: ScenarioDescriptor["severity"]) {
  if (severity === "extreme") return "danger";
  if (severity === "high") return "warn";
  return "accent";
}

function buildFanChart(paths: number[][]) {
  if (!paths.length) return [];
  const maxLength = Math.max(...paths.map((path) => path.length));
  const rows = [];
  for (let index = 0; index < maxLength; index += 1) {
    const points = paths.map((path) => path[index] ?? path[path.length - 1] ?? 0).sort((left, right) => left - right);
    const percentile = (ratio: number) => {
      const position = Math.max(0, Math.min(points.length - 1, Math.floor((points.length - 1) * ratio)));
      return points[position] ?? 0;
    };
    const p5 = percentile(0.05);
    const p25 = percentile(0.25);
    const p50 = percentile(0.5);
    const p75 = percentile(0.75);
    const p95 = percentile(0.95);
    rows.push({
      step: index,
      p5,
      p25,
      p50,
      p75,
      p95,
      band95Base: p5,
      band95Range: p95 - p5,
      band75Base: p25,
      band75Range: p75 - p25,
    });
  }
  return rows;
}

export function StressTestPanel() {
  const [portfolioId] = useState("current");
  const [scenarios, setScenarios] = useState<ScenarioDescriptor[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>("gfc_2008");
  const [customShocks, setCustomShocks] = useState<CustomShocks>(DEFAULT_CUSTOM_SHOCKS);
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [monteCarlo, setMonteCarlo] = useState<MonteCarloResult | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [monteCarloLoading, setMonteCarloLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCustomSelected = selectedScenarioId === "custom";

  const holdingChartData = useMemo(
    () =>
      [...(result?.by_holding ?? [])]
        .sort((left, right) => left.impact_pct - right.impact_pct)
        .slice(0, 10)
        .map((holding) => ({
          symbol: holding.symbol,
          impactPct: Number((holding.impact_pct * 100).toFixed(2)),
        })),
    [result],
  );

  const sectorChartData = useMemo(
    () =>
      [...(result?.by_sector ?? [])]
        .sort((left, right) => Math.abs(right.impact_value) - Math.abs(left.impact_value))
        .map((sector) => ({
          name: sector.sector,
          value: Math.abs(sector.impact_value),
          impactPct: sector.impact_pct,
        })),
    [result],
  );

  const fanChartData = useMemo(() => buildFanChart(monteCarlo?.paths ?? []), [monteCarlo]);

  async function refreshHistory() {
    const items = await fetchStressScenarioHistory();
    setHistory(Array.isArray(items) ? items : []);
  }

  useEffect(() => {
    void (async () => {
      try {
        const [scenarioItems] = await Promise.all([fetchPredefinedStressScenarios(), refreshHistory()]);
        const nextScenarios = Array.isArray(scenarioItems) ? scenarioItems : [];
        setScenarios(nextScenarios);
        if (nextScenarios.length > 0 && !nextScenarios.some((scenario) => scenario.id === selectedScenarioId)) {
          setSelectedScenarioId(nextScenarios[0].id);
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load stress-test data");
      }
    })();
  }, []);

  async function runSelectedScenario() {
    setLoading(true);
    setMonteCarloLoading(true);
    setError(null);
    try {
      const [scenarioResult, monteCarloResult] = await Promise.all([
        runStressScenario({
          portfolio_id: portfolioId,
          ...(isCustomSelected
            ? { custom_shocks: customShocks }
            : { scenario_id: selectedScenarioId }),
        }),
        runStressMonteCarlo({ portfolio_id: portfolioId, n_simulations: 1000 }),
      ]);
      setResult(scenarioResult);
      setMonteCarlo(monteCarloResult);
      await refreshHistory();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Failed to run scenario analysis");
    } finally {
      setLoading(false);
      setMonteCarloLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <TerminalPanel
        title="Scenario Library"
        subtitle="Predefined crisis templates, custom factor shocks, and portfolio stress outcomes"
        actions={<TerminalBadge variant={loading ? "warn" : "live"}>{loading ? "RUNNING" : "READY"}</TerminalBadge>}
      >
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {scenarios.map((scenario) => (
              <div
                key={scenario.id}
                role="button"
                tabIndex={0}
                className={`rounded border p-3 text-left transition-colors ${
                  selectedScenarioId === scenario.id
                    ? "border-terminal-accent bg-terminal-accent/10"
                    : "border-terminal-border bg-terminal-bg/40 hover:border-terminal-accent/60"
                }`}
                onClick={() => setSelectedScenarioId(scenario.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedScenarioId(scenario.id);
                  }
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm text-terminal-text">{scenario.name}</div>
                  <TerminalBadge variant={severityVariant(scenario.severity)}>{scenario.severity}</TerminalBadge>
                </div>
                <p className="mt-2 text-xs text-terminal-muted">{scenario.description}</p>
                <div className="mt-3">
                  <TerminalButton
                    size="sm"
                    variant={selectedScenarioId === scenario.id ? "accent" : "default"}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedScenarioId(scenario.id);
                      void runSelectedScenario();
                    }}
                  >
                    Run
                  </TerminalButton>
                </div>
              </div>
            ))}

            <div
              role="button"
              tabIndex={0}
              className={`rounded border p-3 text-left transition-colors ${
                isCustomSelected
                  ? "border-terminal-accent bg-terminal-accent/10"
                  : "border-dashed border-terminal-border bg-terminal-bg/30 hover:border-terminal-accent/60"
              }`}
              onClick={() => setSelectedScenarioId("custom")}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelectedScenarioId("custom");
                }
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm text-terminal-text">Custom Scenario</div>
                <div className="text-lg leading-none text-terminal-accent">+</div>
              </div>
              <p className="mt-2 text-xs text-terminal-muted">Build your own factor shock mix across equity, rates, vol, FX, gold, and crude.</p>
              <div className="mt-3">
                <TerminalButton
                  size="sm"
                  variant={isCustomSelected ? "accent" : "default"}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedScenarioId("custom");
                  }}
                >
                  Configure
                </TerminalButton>
              </div>
            </div>
          </div>

          {isCustomSelected ? (
            <div className="rounded border border-terminal-border bg-terminal-bg/30 p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-terminal-muted">Custom Scenario Builder</div>
                  <div className="text-xs text-terminal-text">Adjust factor shocks and run a portfolio stress projection.</div>
                </div>
                <TerminalButton size="sm" variant="accent" onClick={() => void runSelectedScenario()} loading={loading}>
                  Run Custom Scenario
                </TerminalButton>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {FACTOR_SLIDERS.map((slider) => {
                  const sliderValue = slider.fromStored(customShocks[slider.key]);
                  return (
                    <label key={slider.key} className="rounded border border-terminal-border/60 bg-terminal-panel/40 p-3">
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-terminal-muted">{slider.label}</span>
                        <span className="text-terminal-text">{slider.format(sliderValue)}</span>
                      </div>
                      <input
                        aria-label={`${slider.label} shock`}
                        className="mt-3 w-full accent-terminal-accent"
                        type="range"
                        min={slider.min}
                        max={slider.max}
                        step={slider.step}
                        value={sliderValue}
                        onChange={(event) => {
                          const nextValue = Number(event.target.value);
                          setCustomShocks((current) => ({
                            ...current,
                            [slider.key]: slider.toStored(nextValue),
                          }));
                        }}
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </TerminalPanel>

      {error ? <div className="rounded border border-terminal-neg bg-terminal-neg/10 px-3 py-2 text-xs text-terminal-neg">{error}</div> : null}

      {result ? (
        <div className="grid gap-3 xl:grid-cols-[1.2fr_0.8fr]">
          <TerminalPanel
            title="Results Panel"
            subtitle={result.scenario_name}
            actions={<TerminalBadge variant={result.total_impact_pct <= 0 ? "danger" : "success"}>{formatPct(result.total_impact_pct)}</TerminalBadge>}
          >
            <div className="space-y-4">
              <div className="rounded border border-terminal-border bg-terminal-bg/40 p-4">
                <div className="text-[10px] uppercase tracking-[0.2em] text-terminal-muted">Total Portfolio Impact</div>
                <div className={`mt-2 text-3xl font-semibold ${result.total_impact_pct <= 0 ? "text-terminal-neg" : "text-terminal-pos"}`}>
                  {formatPct(result.total_impact_pct)}
                </div>
                <div className={`mt-1 text-sm ${result.total_impact_value <= 0 ? "text-terminal-neg" : "text-terminal-pos"}`}>
                  {result.total_impact_value > 0 ? "+" : ""}
                  {formatCurrency(result.total_impact_value)}
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded border border-terminal-border bg-terminal-bg/30 p-3">
                  <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-terminal-muted">Impact By Holding</div>
                  <div className="h-80" data-testid="impact-by-holding-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={holdingChartData} layout="vertical" margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#24303F" horizontal={false} />
                        <XAxis type="number" stroke="#6E7681" tickFormatter={(value) => `${value}%`} />
                        <YAxis type="category" dataKey="symbol" stroke="#6E7681" width={70} />
                        <Tooltip
                          contentStyle={{ backgroundColor: "#0D1117", border: "1px solid #263040", borderRadius: 4, fontSize: 11 }}
                          formatter={(value) => `${Number(value ?? 0).toFixed(2)}%`}
                        />
                        <Bar dataKey="impactPct" radius={[0, 4, 4, 0]}>
                          {holdingChartData.map((entry, index) => (
                            <Cell key={entry.symbol} fill={HOLDING_COLORS[index % HOLDING_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="rounded border border-terminal-border bg-terminal-bg/30 p-3">
                  <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-terminal-muted">Impact By Sector</div>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={sectorChartData}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={60}
                          outerRadius={92}
                          paddingAngle={3}
                          stroke="#0D1117"
                          strokeWidth={2}
                        >
                          {sectorChartData.map((entry, index) => (
                            <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{ backgroundColor: "#0D1117", border: "1px solid #263040", borderRadius: 4, fontSize: 11 }}
                          formatter={(value) => formatCurrency(Number(value ?? 0))}
                        />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              <div className="rounded border border-terminal-border bg-terminal-bg/30 p-3">
                <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-terminal-muted">Monte Carlo Fan Chart</div>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={fanChartData} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#24303F" vertical={false} />
                      <XAxis dataKey="step" stroke="#6E7681" />
                      <YAxis stroke="#6E7681" tickFormatter={(value) => `${Number(value * 100).toFixed(0)}%`} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#0D1117", border: "1px solid #263040", borderRadius: 4, fontSize: 11 }}
                        formatter={(value) => formatPct(Number(value ?? 0))}
                      />
                      <Area type="monotone" dataKey="band95Base" stackId="fan95" stroke="none" fill="transparent" />
                      <Area type="monotone" dataKey="band95Range" stackId="fan95" stroke="none" fill="#5B8FF9" fillOpacity={0.12} />
                      <Area type="monotone" dataKey="band75Base" stackId="fan75" stroke="none" fill="transparent" />
                      <Area type="monotone" dataKey="band75Range" stackId="fan75" stroke="none" fill="#26A65B" fillOpacity={0.2} />
                      <Line type="monotone" dataKey="p50" stroke="#F7D154" strokeWidth={2} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-terminal-muted">
                  <TerminalBadge variant="info">5-95: {monteCarloLoading ? "..." : formatPct(monteCarlo?.percentiles.p5 ?? 0)} / {monteCarloLoading ? "..." : formatPct(monteCarlo?.percentiles.p95 ?? 0)}</TerminalBadge>
                  <TerminalBadge variant="info">25-75: {monteCarloLoading ? "..." : formatPct(monteCarlo?.percentiles.p25 ?? 0)} / {monteCarloLoading ? "..." : formatPct(monteCarlo?.percentiles.p75 ?? 0)}</TerminalBadge>
                  <TerminalBadge variant="accent">Median: {monteCarloLoading ? "..." : formatPct(monteCarlo?.percentiles.p50 ?? 0)}</TerminalBadge>
                </div>
              </div>
            </div>
          </TerminalPanel>

          <div className="space-y-3">
            <TerminalPanel title="Worst 5 Holdings" subtitle="Largest contributors to drawdown">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px]">
                  <thead className="text-[10px] uppercase tracking-[0.18em] text-terminal-muted">
                    <tr>
                      <th className="border-b border-terminal-border px-2 py-2">Symbol</th>
                      <th className="border-b border-terminal-border px-2 py-2 text-right">Current Value</th>
                      <th className="border-b border-terminal-border px-2 py-2 text-right">Impact %</th>
                      <th className="border-b border-terminal-border px-2 py-2 text-right">Impact Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.worst_holdings.map((holding) => (
                      <tr key={holding.symbol}>
                        <td className="border-b border-terminal-border/40 px-2 py-2 text-terminal-text">{holding.symbol}</td>
                        <td className="border-b border-terminal-border/40 px-2 py-2 text-right text-terminal-text">{formatCurrency(holding.current_value)}</td>
                        <td className="border-b border-terminal-border/40 px-2 py-2 text-right text-terminal-neg">{formatPct(holding.impact_pct)}</td>
                        <td className="border-b border-terminal-border/40 px-2 py-2 text-right text-terminal-neg">{formatCurrency(holding.impact_value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TerminalPanel>

            <TerminalPanel title="Run History" subtitle="Recent scenario runs">
              <div className="max-h-72 overflow-auto">
                <table className="w-full text-left text-[11px]">
                  <thead className="text-[10px] uppercase tracking-[0.18em] text-terminal-muted">
                    <tr>
                      <th className="border-b border-terminal-border px-2 py-2">Date</th>
                      <th className="border-b border-terminal-border px-2 py-2">Scenario</th>
                      <th className="border-b border-terminal-border px-2 py-2 text-right">Impact %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((row) => (
                      <tr key={row.id}>
                        <td className="border-b border-terminal-border/40 px-2 py-2 text-terminal-muted">
                          {new Date(row.run_date).toLocaleString("en-US", {
                            month: "short",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="border-b border-terminal-border/40 px-2 py-2 text-terminal-text">{row.scenario_name}</td>
                        <td className={`border-b border-terminal-border/40 px-2 py-2 text-right ${row.total_impact_pct <= 0 ? "text-terminal-neg" : "text-terminal-pos"}`}>
                          {formatPct(row.total_impact_pct)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TerminalPanel>
          </div>
        </div>
      ) : (
        <TerminalPanel title="Results Panel" subtitle="Run a scenario to populate holding, sector, and Monte Carlo analysis">
          <div className="p-4 text-xs text-terminal-muted">Select a predefined scenario or build a custom shock profile, then run it to view portfolio impacts.</div>
        </TerminalPanel>
      )}
    </div>
  );
}
