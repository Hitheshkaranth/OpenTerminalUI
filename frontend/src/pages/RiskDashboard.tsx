import { useEffect, useState, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell, PieChart, Pie, Legend
} from 'recharts';

import {
  fetchRiskSummary, fetchRiskExposures, fetchRiskCorrelation, fetchSectorConcentration
} from "../api/quantClient";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { useStockStore } from "../store/stockStore";
import { TerminalBadge } from "../components/terminal/TerminalBadge";
import { TerminalButton } from "../components/terminal/TerminalButton";

const COLORS = ['#26A65B', '#E84142', '#F39C12', '#5B8FF9', '#9B59B6', '#E67E22', '#1ABC9C'];

export function RiskDashboardPage() {
  const storeTicker = useStockStore((s) => s.ticker);
  const [mode, setMode] = useState<"portfolio" | "ticker">("portfolio");
  const [summary, setSummary] = useState<any>(null);
  const [exposures, setExposures] = useState<any>(null);
  const [correlation, setCorrelation] = useState<any>(null);
  const [concentration, setConcentration] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeTicker = useMemo(() => (mode === "ticker" ? storeTicker : undefined), [mode, storeTicker]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [sumData, expData, corrData, concData] = await Promise.all([
        fetchRiskSummary(activeTicker),
        fetchRiskExposures(activeTicker),
        fetchRiskCorrelation(activeTicker),
        fetchSectorConcentration(activeTicker)
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

  useEffect(() => {
    void load();
  }, [activeTicker]);

  const pcaData = exposures?.pca_factors?.map((f: any) => ({
    name: f.factor,
    variance: Number((f.variance_explained * 100).toFixed(1))
  })) || [];

  const sectorData = Object.entries(concentration?.sectors || {}).map(([name, value]) => ({
    name, value: Number(value)
  }));

  return (
    <div className="space-y-3 p-4 font-mono">
      <div className="flex flex-wrap justify-between items-center gap-3 rounded border border-terminal-border bg-terminal-panel p-3">
        <div>
          <div className="text-sm font-semibold text-terminal-accent uppercase">RISK ENGINE CONTROL</div>
          <div className="text-[10px] text-terminal-muted uppercase">Multi-factor risk attribution & attribution analytics</div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded border border-terminal-border p-0.5 bg-terminal-bg">
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

          <TerminalButton size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? "SYNCING..." : "RELOAD ANALYTICS"}
          </TerminalButton>
        </div>
      </div>

      {error && <div className="rounded border border-terminal-neg bg-terminal-neg/10 p-2 text-xs text-terminal-neg">{error}</div>}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <TerminalPanel title="STATISTICAL RISK METRICS" subtitle={mode === "ticker" ? `Analysis for ${storeTicker} + Peers` : "Total Portfolio Attribution"}>
          <div className="space-y-4 p-1 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded bg-terminal-bg p-2 border border-terminal-border/50">
                <div className="text-terminal-muted mb-1 text-[10px]">EWMA VOLATILITY</div>
                <div className="text-lg text-terminal-pos font-bold">{(Number(summary?.ewma_vol || 0) * 100).toFixed(2)}%</div>
              </div>
              <div className="rounded bg-terminal-bg p-2 border border-terminal-border/50">
                <div className="text-terminal-muted mb-1 text-[10px]">SYSTEMATIC BETA</div>
                <div className="text-lg text-terminal-accent font-bold">{Number(summary?.beta || 0).toFixed(2)}</div>
              </div>
            </div>

            <div>
              <div className="mb-2 font-bold text-terminal-accent border-b border-terminal-border pb-1 uppercase text-[10px]">Marginal Contribution to Risk (MCTR)</div>
              <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                {Object.entries(summary?.marginal_contribution || {}).map(([asset, val]) => (
                  <div key={asset} className="flex justify-between items-center border-b border-terminal-border/20 py-1">
                    <span className="font-bold text-[10px]">{asset}</span>
                    <div className="flex items-center gap-2">
                      <div className="h-1 w-20 bg-terminal-border rounded-full overflow-hidden">
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
                <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                <XAxis dataKey="name" stroke="#666" fontSize={10} tick={{fill: '#888'}} axisLine={{stroke: '#333'}} />
                <YAxis stroke="#666" fontSize={10} unit="%" tick={{fill: '#888'}} axisLine={{stroke: '#333'}} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0a0a0a', border: '1px solid #333', fontSize: '10px', borderRadius: '2px' }}
                  itemStyle={{ color: '#26A65B' }}
                  cursor={{fill: '#ffffff11'}}
                />
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
                  label={({ name, percent }: any) =>
                    `${name} ${(Number(percent || 0) * 100).toFixed(0)}%`
                  }
                  labelLine={false}
                  stroke="#000"
                  strokeWidth={2}
                >
                  {sectorData.map((_entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                   contentStyle={{ backgroundColor: '#0a0a0a', border: '1px solid #333', fontSize: '10px', borderRadius: '2px' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </TerminalPanel>
      </div>

      <TerminalPanel title="CORRELATION DYNAMICS" subtitle="Rolling pairwise correlation matrix (60D window)">
        <div className="overflow-x-auto p-1">
          <table className="w-full text-right border-collapse text-[10px]">
            <thead>
              <tr>
                <th className="p-2 border border-terminal-border text-left bg-terminal-panel font-bold uppercase tracking-wider">ASSET</th>
                {correlation?.assets?.map((a: string) => (
                  <th key={a} className="p-2 border border-terminal-border bg-terminal-panel font-bold tabular-nums uppercase">{a}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {correlation?.matrix?.map((row: number[], idx: number) => (
                <tr key={idx} className="hover:bg-terminal-border/10 transition-colors">
                  <td className="p-2 border border-terminal-border text-left font-bold bg-terminal-panel uppercase">{correlation.assets[idx]}</td>
                  {row.map((val, cIdx) => {
                    const absVal = Math.abs(val);
                    const color = val > 0.7 ? '#26A65B' : val < -0.7 ? '#E84142' : 'inherit';
                    const opacity = absVal < 0.2 ? 0.3 : absVal < 0.5 ? 0.6 : 1;
                    return (
                      <td key={cIdx} className="p-2 border border-terminal-border tabular-nums" style={{ color, opacity }}>
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
    </div>
  );
}
