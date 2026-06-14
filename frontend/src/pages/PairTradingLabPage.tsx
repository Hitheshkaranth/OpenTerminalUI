import { useEffect, useState, useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";

import {
  fetchPairTest,
  fetchPairSpread,
  fetchPairSignals,
  fetchPairScan,
  type PairTestResult,
  type PairSpreadResult,
  type PairSignalsResult,
  type PairScanResult,
} from "../api/client";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { TerminalInput } from "../components/terminal/TerminalInput";
import { terminalColors } from "../theme/terminal";

type LabTab = "test" | "spread" | "backtest" | "scan";
type PeriodOption = "1Y" | "2Y" | "3Y" | "5Y";

const DEFAULT_SYMBOL1 = "VOO";
const DEFAULT_SYMBOL2 = "SPY";
const DEFAULT_SCAN_UNIVERSE = ["VOO", "SPY", "KO", "PEP", "XOM", "CVX", "GLD", "IAU"];

export function PairTradingLabPage() {
  const [tab, setTab] = useState<LabTab>("test");
  const [symbol1, setSymbol1] = useState(DEFAULT_SYMBOL1);
  const [symbol2, setSymbol2] = useState(DEFAULT_SYMBOL2);
  const [period, setPeriod] = useState<PeriodOption>("2Y");
  const [entryZ, setEntryZ] = useState(2.0);
  const [exitZ, setExitZ] = useState(0.5);
  const [zWindow, setZWindow] = useState(60);

  const [testResult, setTestResult] = useState<PairTestResult | null>(null);
  const [spreadResult, setSpreadResult] = useState<PairSpreadResult | null>(null);
  const [signalsResult, setSignalsResult] = useState<PairSignalsResult | null>(null);
  const [scanResult, setScanResult] = useState<PairScanResult | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runAnalysis = async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === "test") {
        const res = await fetchPairTest({ symbol1, symbol2, period });
        setTestResult(res);
      } else if (tab === "spread") {
        const res = await fetchPairSpread({ symbol1, symbol2, period, zwindow: zWindow, entry_z: entryZ, exit_z: exitZ });
        setSpreadResult(res);
      } else if (tab === "backtest") {
        const res = await fetchPairSignals({ symbol1, symbol2, period, zwindow: zWindow, entry_z: entryZ, exit_z: exitZ });
        setSignalsResult(res);
      } else if (tab === "scan") {
        const res = await fetchPairScan({ symbols: DEFAULT_SCAN_UNIVERSE, period });
        setScanResult(res);
      }
    } catch (err: any) {
      setError(err?.message || "An error occurred during analysis");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runAnalysis();
  }, [tab]);

  const renderPairTest = () => {
    if (!testResult) return null;
    const isCoint = testResult.cointegrated;

    return (
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <TerminalPanel title="Verdict" bodyClassName="flex flex-col items-center justify-center py-6">
            <div
              className={`text-2xl font-bold uppercase ${
                isCoint ? "text-terminal-pos" : "text-terminal-neg"
              }`}
            >
              {isCoint ? "Cointegrated" : "Not Cointegrated"}
            </div>
            <div className="mt-2 text-center text-xs text-terminal-muted">{testResult.verdict}</div>
          </TerminalPanel>

          <div className="grid grid-cols-2 gap-3 md:col-span-1 lg:col-span-3">
            {[
              ["Beta (Hedge Ratio)", testResult.beta.toFixed(4)],
              ["Coint P-Value", testResult.coint_pvalue.toFixed(4)],
              ["ADF P-Value", testResult.adf_pvalue.toFixed(4)],
              ["Half-Life (Days)", testResult.half_life.toFixed(1)],
              ["Current Z-Score", testResult.zscore_current.toFixed(2)],
              ["Period Start", testResult.period_start],
              ["Period End", testResult.period_end],
              ["Residual Std", testResult.resid_std.toFixed(4)],
            ].map(([label, value]) => (
              <div key={label} className="rounded border border-terminal-border bg-terminal-bg p-3">
                <div className="text-[10px] uppercase text-terminal-muted">{label}</div>
                <div className="mt-1 text-lg font-semibold text-terminal-text">{value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderSpreadChart = () => {
    if (!spreadResult) return null;

    return (
      <div className="space-y-4">
        <TerminalPanel
          title="Spread & Z-Score Bands"
          subtitle={`Hedge Ratio (Beta): ${spreadResult.beta.toFixed(4)}`}
          bodyClassName="p-0"
        >
          <div className="h-[500px] w-full p-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={spreadResult.points}>
                <CartesianGrid strokeDasharray="3 3" stroke={terminalColors.border} />
                <XAxis dataKey="date" stroke={terminalColors.muted} fontSize={10} minTickGap={50} />
                <YAxis yAxisId="left" stroke={terminalColors.muted} fontSize={10} label={{ value: 'Spread', angle: -90, position: 'insideLeft', fill: terminalColors.muted }} />
                <YAxis yAxisId="right" orientation="right" stroke={terminalColors.muted} fontSize={10} label={{ value: 'Z-Score', angle: 90, position: 'insideRight', fill: terminalColors.muted }} />
                <Tooltip
                  contentStyle={{ backgroundColor: terminalColors.panel, border: `1px solid ${terminalColors.border}`, fontSize: "10px" }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} />
                <ReferenceLine yAxisId="right" y={0} stroke={terminalColors.muted} strokeDasharray="3 3" />
                <ReferenceLine yAxisId="right" y={entryZ} stroke={terminalColors.negative} strokeDasharray="3 3" label={{ value: `+${entryZ}`, fill: terminalColors.negative, fontSize: 10 }} />
                <ReferenceLine yAxisId="right" y={-entryZ} stroke={terminalColors.positive} strokeDasharray="3 3" label={{ value: `-${entryZ}`, fill: terminalColors.positive, fontSize: 10 }} />
                <ReferenceLine yAxisId="right" y={exitZ} stroke={terminalColors.warning} strokeDasharray="3 3" label={{ value: `+${exitZ}`, fill: terminalColors.warning, fontSize: 10 }} />
                <ReferenceLine yAxisId="right" y={-exitZ} stroke={terminalColors.warning} strokeDasharray="3 3" label={{ value: `-${exitZ}`, fill: terminalColors.warning, fontSize: 10 }} />
                
                <Line yAxisId="left" type="monotone" dataKey="spread" stroke={terminalColors.accent} dot={false} strokeWidth={1.5} name="Spread" />
                <Line yAxisId="right" type="monotone" dataKey="zscore" stroke={terminalColors.info} dot={false} strokeWidth={1.5} name="Z-Score" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </TerminalPanel>
      </div>
    );
  };

  const renderBacktest = () => {
    if (!signalsResult) return null;
    const { stats } = signalsResult;

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            ["Total Trades", stats.trades],
            ["Win Rate", `${(stats.win_rate * 100).toFixed(1)}%`],
            ["Sharpe Ratio", stats.sharpe.toFixed(2)],
            ["Max Drawdown", `${(stats.max_drawdown * 100).toFixed(1)}%`],
            ["Total Return", `${(stats.total_return * 100).toFixed(1)}%`, stats.total_return >= 0 ? "text-terminal-pos" : "text-terminal-neg"],
          ].map(([label, value, colorClass]) => (
            <div key={label} className="rounded border border-terminal-border bg-terminal-bg p-3 text-center">
              <div className="text-[10px] uppercase text-terminal-muted">{label}</div>
              <div className={`mt-1 text-lg font-semibold ${colorClass || "text-terminal-text"}`}>{value}</div>
            </div>
          ))}
        </div>

        <TerminalPanel title="Equity Curve" bodyClassName="p-0">
          <div className="h-[500px] w-full p-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={signalsResult.equity}>
                <CartesianGrid strokeDasharray="3 3" stroke={terminalColors.border} />
                <XAxis dataKey="date" stroke={terminalColors.muted} fontSize={10} minTickGap={50} />
                <YAxis stroke={terminalColors.muted} fontSize={10} />
                <Tooltip
                  contentStyle={{ backgroundColor: terminalColors.panel, border: `1px solid ${terminalColors.border}`, fontSize: "10px" }}
                />
                <ReferenceLine y={1} stroke={terminalColors.muted} strokeDasharray="3 3" />
                <Line type="monotone" dataKey="equity" stroke={terminalColors.positive} dot={false} strokeWidth={2} name="Equity" connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </TerminalPanel>
      </div>
    );
  };

  const renderScan = () => {
    if (!scanResult) return null;

    return (
      <TerminalPanel title="Pair Scan Results" subtitle={`Universe: ${DEFAULT_SCAN_UNIVERSE.join(", ")} | Period: ${scanResult.period}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="border-b border-terminal-border text-terminal-muted uppercase">
                <th className="px-3 py-2">Symbol 1</th>
                <th className="px-3 py-2">Symbol 2</th>
                <th className="px-3 py-2 text-right">Beta</th>
                <th className="px-3 py-2 text-right">Coint P</th>
                <th className="px-3 py-2 text-right">ADF P</th>
                <th className="px-3 py-2 text-right">Half-Life</th>
                <th className="px-3 py-2 text-right">Z-Score</th>
                <th className="px-3 py-2 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-terminal-border/40">
              {scanResult.results.map((item, idx) => (
                <tr key={`${item.symbol1}-${item.symbol2}-${idx}`} className="hover:bg-terminal-bg/50">
                  <td className="px-3 py-2 font-bold text-terminal-accent">{item.symbol1}</td>
                  <td className="px-3 py-2 font-bold text-terminal-accent">{item.symbol2}</td>
                  <td className="px-3 py-2 text-right">{item.beta.toFixed(4)}</td>
                  <td className="px-3 py-2 text-right">{item.coint_pvalue.toFixed(4)}</td>
                  <td className="px-3 py-2 text-right">{item.adf_pvalue.toFixed(4)}</td>
                  <td className="px-3 py-2 text-right">{item.half_life.toFixed(1)}</td>
                  <td className="px-3 py-2 text-right font-mono">{item.zscore_current.toFixed(2)}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`rounded-sm px-1.5 py-0.5 text-[9px] font-bold uppercase ${item.cointegrated ? "bg-terminal-pos/20 text-terminal-pos" : "bg-terminal-muted/20 text-terminal-muted"}`}>
                      {item.cointegrated ? "Coint" : "Fail"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TerminalPanel>
    );
  };

  return (
    <div className="space-y-4 p-4 font-mono">
      <TerminalPanel
        title="Pair Trading Lab"
        subtitle="Statistical arbitrage through cointegration analysis and mean reversion"
        actions={
          <div className="flex gap-2">
            <TerminalButton size="sm" onClick={runAnalysis} disabled={loading} variant="accent">
              {loading ? "Analyzing..." : "Analyze"}
            </TerminalButton>
          </div>
        }
      >
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <div className="space-y-1">
            <label className="text-[10px] uppercase text-terminal-muted">Symbol 1</label>
            <TerminalInput value={symbol1} onChange={(e) => setSymbol1(e.target.value.toUpperCase())} placeholder="e.g. VOO" />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase text-terminal-muted">Symbol 2</label>
            <TerminalInput value={symbol2} onChange={(e) => setSymbol2(e.target.value.toUpperCase())} placeholder="e.g. SPY" />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase text-terminal-muted">Period</label>
            <TerminalInput as="select" value={period} onChange={(e) => setPeriod(e.target.value as PeriodOption)}>
              <option value="1Y">1 Year</option>
              <option value="2Y">2 Years</option>
              <option value="3Y">3 Years</option>
              <option value="5Y">5 Years</option>
            </TerminalInput>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase text-terminal-muted">Entry Z</label>
            <TerminalInput type="number" step="0.1" value={entryZ} onChange={(e) => setEntryZ(Number(e.target.value))} />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase text-terminal-muted">Exit Z</label>
            <TerminalInput type="number" step="0.1" value={exitZ} onChange={(e) => setExitZ(Number(e.target.value))} />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase text-terminal-muted">Z Window</label>
            <TerminalInput type="number" value={zWindow} onChange={(e) => setZWindow(Number(e.target.value))} />
          </div>
        </div>
      </TerminalPanel>

      <div className="flex flex-wrap items-center gap-2">
        {( [
          ["test", "Pair Test"],
          ["spread", "Spread & Z-Score"],
          ["backtest", "Backtest"],
          ["scan", "Scan"],
        ] as Array<[LabTab, string]>).map(([tabKey, label]) => (
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

      {error ? (
        <div className="rounded border border-terminal-neg bg-terminal-neg/10 p-3 text-xs text-terminal-neg">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="flex h-[400px] items-center justify-center text-xs text-terminal-muted">
          Computing statistical metrics...
        </div>
      ) : (
        <>
          {tab === "test" && renderPairTest()}
          {tab === "spread" && renderSpreadChart()}
          {tab === "backtest" && renderBacktest()}
          {tab === "scan" && renderScan()}
        </>
      )}
    </div>
  );
}
