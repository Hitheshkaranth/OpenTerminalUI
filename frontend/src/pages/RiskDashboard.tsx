import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  ErrorBar,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  fetchFactorAttribution,
  fetchFactorExposures,
  fetchFactorHistory,
  fetchFactorReturns,
  fetchRiskCorrelation,
  fetchRiskExposures,
  fetchRiskSummary,
  fetchSectorConcentration,
} from "../api/quantClient";
import { StressTestPanel } from "../components/risk/StressTestPanel";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { useStockStore } from "../store/stockStore";

const COLORS = ["#26A65B", "#E84142", "#F39C12", "#5B8FF9", "#9B59B6", "#E67E22", "#1ABC9C"];
const FACTOR_ORDER = ["market", "size", "value", "momentum", "quality", "low_vol"] as const;
const FACTOR_LABELS: Record<(typeof FACTOR_ORDER)[number], string> = {
  market: "Market",
  size: "Size",
  value: "Value",
  momentum: "Momentum",
  quality: "Quality",
  low_vol: "Low Vol",
};
const FACTOR_LINE_COLORS: Record<string, string> = {
  market: "#5B8FF9",
  size: "#F39C12",
  value: "#26A65B",
  momentum: "#9B59B6",
  quality: "#1ABC9C",
  low_vol: "#E67E22",
};
const PERIODS = ["3M", "6M", "1Y", "3Y"] as const;

function fmtSigned(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function fmtPct(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "-";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

export function RiskDashboardPage() {
  const storeTicker = useStockStore((s) => s.ticker);
  const [tab, setTab] = useState<"overview" | "factors" | "stress">("overview");
  const [mode, setMode] = useState<"portfolio" | "ticker">("portfolio");
  const [factorPeriod, setFactorPeriod] = useState<(typeof PERIODS)[number]>("1Y");
  const [summary, setSummary] = useState<any>(null);
  const [exposures, setExposures] = useState<any>(null);
  const [correlation, setCorrelation] = useState<any>(null);
  const [concentration, setConcentration] = useState<any>(null);
  const [factorExposures, setFactorExposures] = useState<any>(null);
  const [factorAttribution, setFactorAttribution] = useState<any>(null);
  const [factorHistory, setFactorHistory] = useState<any>(null);
  const [factorReturns, setFactorReturns] = useState<any>(null);
  const [hiddenFactors, setHiddenFactors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [factorLoading, setFactorLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeTicker = useMemo(() => (mode === "ticker" ? storeTicker : undefined), [mode, storeTicker]);

  async function loadOverview() {
    setLoading(true);
    setError(null);
    try {
      const [sumData, expData, corrData, concData] = await Promise.all([
        fetchRiskSummary(activeTicker),
        fetchRiskExposures(activeTicker),
        fetchRiskCorrelation(activeTicker),
        fetchSectorConcentration(activeTicker),
      ]);
      setSummary(sumData);
      setExposures(expData);
      setCorrelation(corrData);
      setConcentration(concData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load risk data");
    } finally {
      setLoading(false);
    }
  }

  async function loadFactors(period: (typeof PERIODS)[number]) {
    setFactorLoading(true);
    setError(null);
    try {
      const [expData, attrData, histData, retData] = await Promise.all([
        fetchFactorExposures("current"),
        fetchFactorAttribution("current", period),
        fetchFactorHistory("current", period, 60),
        fetchFactorReturns(period),
      ]);
      setFactorExposures(expData);
      setFactorAttribution(attrData);
      setFactorHistory(histData);
      setFactorReturns(retData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load factor analytics");
    } finally {
      setFactorLoading(false);
    }
  }

  useEffect(() => {
    if (tab === "overview") {
      void loadOverview();
    }
  }, [activeTicker, tab]);

  useEffect(() => {
    if (tab === "factors") {
      void loadFactors(factorPeriod);
    }
  }, [tab, factorPeriod]);

  const pcaData =
    exposures?.pca_factors?.map((f: any) => ({
      name: f.factor,
      variance: Number((f.variance_explained * 100).toFixed(1)),
    })) || [];

  const sectorData = Object.entries(concentration?.sectors || {}).map(([name, value]) => ({
    name,
    value: Number(value),
  }));

  const factorExposureData = useMemo(
    () =>
      FACTOR_ORDER.map((factor) => {
        const row = factorExposures?.exposures?.[factor] || {};
        const exposure = Number(row.exposure || 0);
        const confidence = Number(row.confidence || 0);
        const ci = Math.max(0.05, Math.abs(exposure) * (1 - Math.min(confidence, 0.95)));
        return {
          factor,
          label: FACTOR_LABELS[factor],
          exposure,
          tStat: Number(row.t_stat || 0),
          confidence,
          confidenceInterval: [ci, ci],
        };
      }),
    [factorExposures],
  );

  const factorHistoryData = useMemo(() => {
    const factorSeries = factorHistory?.series || {};
    const map = new Map<string, Record<string, string | number>>();
    FACTOR_ORDER.forEach((factor) => {
      const rows = factorSeries[factor] || [];
      rows.forEach((row: { date: string; exposure: number }) => {
        const current = map.get(row.date) || { date: row.date };
        current[factor] = Number(row.exposure || 0);
        map.set(row.date, current);
      });
    });
    return Array.from(map.values());
  }, [factorHistory]);

  const waterfallData = useMemo(() => {
    type WaterfallRow = {
      key: string;
      label: string;
      offset: number;
      contribution: number;
      signedContribution: number;
      runningTotal: number;
      fill: string;
    };
    const contributions = factorAttribution?.factor_contributions || {};
    let running = 0;
    const rows: WaterfallRow[] = FACTOR_ORDER.map((factor) => {
      const value = Number(contributions[factor] || 0);
      const start = running;
      running += value;
      return {
        key: factor,
        label: FACTOR_LABELS[factor],
        offset: Math.min(start, running),
        contribution: Math.abs(value),
        signedContribution: value,
        runningTotal: running,
        fill: value >= 0 ? "#26A65B" : "#E84142",
      };
    });
    const alpha = Number(factorAttribution?.alpha || 0);
    const alphaStart = running;
    running += alpha;
    rows.push({
      key: "alpha",
      label: "Alpha",
      offset: Math.min(alphaStart, running),
      contribution: Math.abs(alpha),
      signedContribution: alpha,
      runningTotal: running,
      fill: alpha >= 0 ? "#26A65B" : "#E84142",
    });
    rows.push({
      key: "total",
      label: "Total",
      offset: 0,
      contribution: Math.abs(Number(factorAttribution?.total_return || 0)),
      signedContribution: Number(factorAttribution?.total_return || 0),
      runningTotal: Number(factorAttribution?.total_return || 0),
      fill: "#5B8FF9",
    });
    return rows;
  }, [factorAttribution]);

  const styleBox = useMemo(() => {
    const sizeExposure = Number(factorExposures?.exposures?.size?.exposure || 0);
    const valueExposure = Number(factorExposures?.exposures?.value?.exposure || 0);
    const row = sizeExposure > 0.35 ? "Small" : sizeExposure < -0.35 ? "Large" : "Mid";
    const column = valueExposure > 0.35 ? "Value" : valueExposure < -0.35 ? "Growth" : "Blend";
    return { row, column };
  }, [factorExposures]);

  function toggleFactor(factor: string) {
    setHiddenFactors((current) =>
      current.includes(factor) ? current.filter((item) => item !== factor) : [...current, factor],
    );
  }

  return (
    <div className="space-y-3 p-4 font-mono">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-terminal-border bg-terminal-panel p-3">
        <div>
          <div className="text-sm font-semibold uppercase text-terminal-accent">RISK ENGINE CONTROL</div>
          <div className="text-[10px] uppercase text-terminal-muted">Multi-factor risk attribution & attribution analytics</div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded border border-terminal-border bg-terminal-bg p-0.5">
            <button
              className={`px-3 py-1 text-[10px] font-bold rounded-sm transition-colors ${tab === "overview" ? "bg-terminal-accent text-terminal-bg" : "text-terminal-muted hover:text-terminal-text"}`}
              onClick={() => setTab("overview")}
            >
              OVERVIEW
            </button>
            <button
              className={`px-3 py-1 text-[10px] font-bold rounded-sm transition-colors ${tab === "factors" ? "bg-terminal-accent text-terminal-bg" : "text-terminal-muted hover:text-terminal-text"}`}
              onClick={() => setTab("factors")}
            >
              FACTOR ATTRIBUTION
            </button>
            <button
              className={`px-3 py-1 text-[10px] font-bold rounded-sm transition-colors ${tab === "stress" ? "bg-terminal-accent text-terminal-bg" : "text-terminal-muted hover:text-terminal-text"}`}
              onClick={() => setTab("stress")}
            >
              STRESS TEST
            </button>
          </div>

          {tab === "overview" ? (
            <div className="flex rounded border border-terminal-border bg-terminal-bg p-0.5">
              <button
                className={`px-3 py-1 text-[10px] font-bold rounded-sm transition-colors ${mode === "portfolio" ? "bg-terminal-accent text-terminal-bg" : "text-terminal-muted hover:text-terminal-text"}`}
                onClick={() => setMode("portfolio")}
              >
                PORTFOLIO
              </button>
              <button
                className={`px-3 py-1 text-[10px] font-bold rounded-sm transition-colors ${mode === "ticker" ? "bg-terminal-accent text-terminal-bg" : "text-terminal-muted hover:text-terminal-text"}`}
                onClick={() => setMode("ticker")}
              >
                TICKER: {storeTicker}
              </button>
            </div>
          ) : null}

          {tab === "factors" ? (
            <div className="flex rounded border border-terminal-border bg-terminal-bg p-0.5">
              {PERIODS.map((period) => (
                <button
                  key={period}
                  className={`px-3 py-1 text-[10px] font-bold rounded-sm transition-colors ${factorPeriod === period ? "bg-terminal-accent text-terminal-bg" : "text-terminal-muted hover:text-terminal-text"}`}
                  onClick={() => setFactorPeriod(period)}
                >
                  {period}
                </button>
              ))}
            </div>
          ) : null}

          {tab === "overview" ? (
            <TerminalButton size="sm" onClick={() => void loadOverview()} disabled={loading}>
              {loading ? "SYNCING..." : "RELOAD ANALYTICS"}
            </TerminalButton>
          ) : null}

          {tab === "factors" ? (
            <TerminalButton size="sm" onClick={() => void loadFactors(factorPeriod)} disabled={factorLoading}>
              {factorLoading ? "SYNCING..." : "RELOAD FACTORS"}
            </TerminalButton>
          ) : null}
        </div>
      </div>

      {error && tab !== "stress" ? (
        <div className="rounded border border-terminal-neg bg-terminal-neg/10 p-2 text-xs text-terminal-neg">{error}</div>
      ) : null}

      {tab === "overview" ? (
        <>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <TerminalPanel title="STATISTICAL RISK METRICS" subtitle={mode === "ticker" ? `Analysis for ${storeTicker} + Peers` : "Total Portfolio Attribution"}>
              <div className="space-y-4 p-1 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded border border-terminal-border/50 bg-terminal-bg p-2">
                    <div className="mb-1 text-[10px] text-terminal-muted">EWMA VOLATILITY</div>
                    <div className="text-lg font-bold text-terminal-pos">{(Number(summary?.ewma_vol || 0) * 100).toFixed(2)}%</div>
                  </div>
                  <div className="rounded border border-terminal-border/50 bg-terminal-bg p-2">
                    <div className="mb-1 text-[10px] text-terminal-muted">SYSTEMATIC BETA</div>
                    <div className="text-lg font-bold text-terminal-accent">{Number(summary?.beta || 0).toFixed(2)}</div>
                  </div>
                </div>

                <div>
                  <div className="mb-2 border-b border-terminal-border pb-1 text-[10px] font-bold uppercase text-terminal-accent">Marginal Contribution to Risk (MCTR)</div>
                  <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
                    {Object.entries(summary?.marginal_contribution || {}).map(([asset, val]) => (
                      <div key={asset} className="flex items-center justify-between border-b border-terminal-border/20 py-1">
                        <span className="font-bold text-[10px]">{asset}</span>
                        <div className="flex items-center gap-2">
                          <div className="h-1 w-20 overflow-hidden rounded-full bg-terminal-border">
                            <div className="h-full bg-terminal-accent" style={{ width: `${Math.min(100, Number(val) * 1000)}%` }} />
                          </div>
                          <span className="w-10 text-right tabular-nums">{Number(val).toFixed(4)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </TerminalPanel>

            <TerminalPanel title="FACTOR EXPOSURES (PCA)" subtitle="Variance decomposition by latent factors">
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={pcaData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid stroke="#333" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" axisLine={{ stroke: "#333" }} stroke="#666" tick={{ fill: "#888" }} fontSize={10} />
                    <YAxis axisLine={{ stroke: "#333" }} stroke="#666" tick={{ fill: "#888" }} fontSize={10} unit="%" />
                    <Tooltip contentStyle={{ backgroundColor: "#0a0a0a", border: "1px solid #333", fontSize: "10px", borderRadius: "2px" }} itemStyle={{ color: "#26A65B" }} cursor={{ fill: "#ffffff11" }} />
                    <Bar dataKey="variance" fill="#26A65B" name="Variance Explained" barSize={30}>
                      {pcaData.map((_entry: any, index: number) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} opacity={0.8} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </TerminalPanel>

            <TerminalPanel title="EXPOSURE CLUSTERING" subtitle={mode === "ticker" ? "Regional/Industry Breakdown" : "Sector Concentration (%)"}>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={sectorData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                      label={({ name, percent }: any) => `${name} ${(Number(percent || 0) * 100).toFixed(0)}%`}
                      labelLine={false}
                      stroke="#000"
                      strokeWidth={2}
                    >
                      {sectorData.map((_entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: "#0a0a0a", border: "1px solid #333", fontSize: "10px", borderRadius: "2px" }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </TerminalPanel>
          </div>

          <TerminalPanel title="CORRELATION DYNAMICS" subtitle="Rolling pairwise correlation matrix (60D window)">
            <div className="overflow-x-auto p-1">
              <table className="w-full border-collapse text-right text-[10px]">
                <thead>
                  <tr>
                    <th className="border border-terminal-border bg-terminal-panel p-2 text-left font-bold uppercase tracking-wider">ASSET</th>
                    {correlation?.assets?.map((a: string) => (
                      <th key={a} className="border border-terminal-border bg-terminal-panel p-2 font-bold tabular-nums uppercase">{a}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {correlation?.matrix?.map((row: number[], idx: number) => (
                    <tr key={idx} className="transition-colors hover:bg-terminal-border/10">
                      <td className="border border-terminal-border bg-terminal-panel p-2 text-left font-bold uppercase">{correlation.assets[idx]}</td>
                      {row.map((val, cIdx) => {
                        const absVal = Math.abs(val);
                        const color = val > 0.7 ? "#26A65B" : val < -0.7 ? "#E84142" : "inherit";
                        const opacity = absVal < 0.2 ? 0.3 : absVal < 0.5 ? 0.6 : 1;
                        return (
                          <td key={cIdx} className="border border-terminal-border p-2 tabular-nums" style={{ color, opacity }}>
                            {val.toFixed(2)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TerminalPanel>
        </>
      ) : null}

      {tab === "factors" ? (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            <TerminalPanel title="FACTOR EXPOSURES" subtitle={`Portfolio factor loadings (${factorPeriod})`} className="xl:col-span-2">
              <div className="h-80 w-full" data-testid="factor-exposure-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={factorExposureData} layout="vertical" margin={{ top: 12, right: 24, left: 12, bottom: 12 }}>
                    <CartesianGrid stroke="#333" strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" stroke="#666" tick={{ fill: "#888" }} fontSize={10} />
                    <YAxis type="category" dataKey="label" width={80} stroke="#666" tick={{ fill: "#d8dde7" }} fontSize={11} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#0a0a0a", border: "1px solid #333", fontSize: "10px", borderRadius: "2px" }}
                      formatter={(value, key, item: any) => {
                        if (key === "exposure") return [fmtSigned(Number(value), 2), "Exposure"];
                        return [String(value), item?.payload?.label || key || "Value"];
                      }}
                    />
                    <ReferenceLine x={0} stroke="#5c6677" />
                    <Bar dataKey="exposure" radius={[0, 4, 4, 0]}>
                      <LabelList dataKey="exposure" position="right" formatter={(value: any) => fmtSigned(Number(value), 2)} fill="#d8dde7" fontSize={10} />
                      <ErrorBar dataKey="confidenceInterval" width={4} strokeWidth={1.5} stroke="#d8dde7" />
                      {factorExposureData.map((row) => (
                        <Cell key={row.factor} fill={row.exposure >= 0 ? "#5B8FF9" : "#F39C12"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </TerminalPanel>

            <TerminalPanel title="STYLE BOX" subtitle="Size vs value positioning">
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center text-[10px]" data-testid="factor-style-box">
                  {["Small", "Mid", "Large"].map((row) =>
                    ["Value", "Blend", "Growth"].map((column) => {
                      const active = styleBox.row === row && styleBox.column === column;
                      return (
                        <div
                          key={`${row}-${column}`}
                          className={`rounded border p-4 ${active ? "border-terminal-accent bg-terminal-accent/15 text-terminal-accent" : "border-terminal-border bg-terminal-bg text-terminal-muted"}`}
                        >
                          <div className="font-bold uppercase">{row}</div>
                          <div className="mt-1 uppercase">{column}</div>
                        </div>
                      );
                    }),
                  )}
                </div>
                <div className="rounded border border-terminal-border bg-terminal-bg p-2 text-xs">
                  <div className="text-terminal-muted">Current positioning</div>
                  <div className="mt-1 text-terminal-accent">{styleBox.row} / {styleBox.column}</div>
                  <div className="mt-2 text-[11px] text-terminal-muted">
                    Size {fmtSigned(factorExposures?.exposures?.size?.exposure || 0, 2)} | Value {fmtSigned(factorExposures?.exposures?.value?.exposure || 0, 2)}
                  </div>
                </div>
              </div>
            </TerminalPanel>
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-5">
            <TerminalPanel title="RETURN ATTRIBUTION" subtitle="Waterfall decomposition of realized return" className="xl:col-span-3">
              <div className="h-80 w-full" data-testid="factor-waterfall-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={waterfallData} margin={{ top: 12, right: 24, left: 8, bottom: 12 }}>
                    <CartesianGrid stroke="#333" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" stroke="#666" tick={{ fill: "#888" }} fontSize={10} />
                    <YAxis stroke="#666" tick={{ fill: "#888" }} fontSize={10} tickFormatter={(value) => `${(Number(value) * 100).toFixed(1)}%`} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#0a0a0a", border: "1px solid #333", fontSize: "10px", borderRadius: "2px" }}
                      formatter={(_value, key, item: any) => {
                        if (key === "signedContribution") return [fmtPct(item?.payload?.signedContribution || 0), item?.payload?.label || "Contribution"];
                        if (key === "runningTotal") return [fmtPct(item?.payload?.runningTotal || 0), "Running Total"];
                        return [String(_value), key || "Value"];
                      }}
                    />
                    <ReferenceLine y={0} stroke="#5c6677" />
                    <Bar dataKey="offset" stackId="waterfall" fill="transparent" isAnimationActive={false} />
                    <Bar dataKey="contribution" stackId="waterfall" radius={[4, 4, 0, 0]}>
                      {waterfallData.map((row) => (
                        <Cell key={row.key} fill={row.fill} />
                      ))}
                    </Bar>
                    <Line type="monotone" dataKey="runningTotal" stroke="#d8dde7" strokeWidth={2} dot={{ r: 2, fill: "#d8dde7" }} activeDot={{ r: 4 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </TerminalPanel>

            <TerminalPanel title="FACTOR SNAPSHOT" subtitle="Contribution and model fit" className="xl:col-span-2">
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-1">
                <div className="rounded border border-terminal-border bg-terminal-bg p-2">
                  <div className="text-[10px] uppercase text-terminal-muted">Total Return</div>
                  <div className={`mt-1 text-lg font-bold ${Number(factorAttribution?.total_return || 0) >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>
                    {fmtPct(factorAttribution?.total_return || 0)}
                  </div>
                </div>
                <div className="rounded border border-terminal-border bg-terminal-bg p-2">
                  <div className="text-[10px] uppercase text-terminal-muted">Alpha</div>
                  <div className={`mt-1 text-lg font-bold ${Number(factorAttribution?.alpha || 0) >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>
                    {fmtPct(factorAttribution?.alpha || 0)}
                  </div>
                </div>
                <div className="rounded border border-terminal-border bg-terminal-bg p-2">
                  <div className="text-[10px] uppercase text-terminal-muted">R-Squared</div>
                  <div className="mt-1 text-lg font-bold text-terminal-accent">{(Number(factorAttribution?.r_squared || 0) * 100).toFixed(1)}%</div>
                </div>
                <div className="rounded border border-terminal-border bg-terminal-bg p-2">
                  <div className="text-[10px] uppercase text-terminal-muted">Market Factor Return</div>
                  <div className="mt-1 text-lg font-bold text-terminal-text">
                    {fmtPct((factorReturns?.factors?.market || []).reduce((sum: number, row: { return: number }) => sum + Number(row.return || 0), 0), 2)}
                  </div>
                </div>
              </div>
            </TerminalPanel>
          </div>

          <TerminalPanel title="ROLLING FACTOR EXPOSURES" subtitle="60-day rolling portfolio betas">
            <div className="h-96 w-full" data-testid="factor-history-chart">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={factorHistoryData} margin={{ top: 12, right: 24, left: 8, bottom: 12 }}>
                  <CartesianGrid stroke="#333" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" stroke="#666" tick={{ fill: "#888" }} fontSize={10} minTickGap={24} />
                  <YAxis stroke="#666" tick={{ fill: "#888" }} fontSize={10} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#0a0a0a", border: "1px solid #333", fontSize: "10px", borderRadius: "2px" }}
                      formatter={(value, name) => [
                        fmtSigned(Number(value), 2),
                        FACTOR_LABELS[(name || "") as keyof typeof FACTOR_LABELS] || name || "Factor",
                      ]}
                    />
                  <Legend onClick={(entry: any) => toggleFactor(String(entry.dataKey || ""))} />
                  <ReferenceLine y={0} stroke="#d8dde7" strokeWidth={1.5} />
                  {FACTOR_ORDER.map((factor) =>
                    hiddenFactors.includes(factor) ? null : (
                      <Line
                        key={factor}
                        type="monotone"
                        dataKey={factor}
                        name={FACTOR_LABELS[factor]}
                        stroke={FACTOR_LINE_COLORS[factor]}
                        strokeWidth={2}
                        dot={false}
                      />
                    ),
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </TerminalPanel>
        </div>
      ) : null}

      {tab === "stress" ? <StressTestPanel /> : null}
    </div>
  );
}
