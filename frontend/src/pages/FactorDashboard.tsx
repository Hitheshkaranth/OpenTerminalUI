import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip } from "recharts";

import { fetchStockIdeas, fetchSymbolFactors, type BackendFactorScores, type FactorMarket, type FactorScores, type StockIdea } from "../api/client";
import { TerminalPanel } from "../components/terminal/TerminalPanel";

const SECTORS = ["All", "Technology", "Financials", "Consumer", "Industrials", "Healthcare", "Energy", "Materials"];

function score(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n > 1 ? n : n * 100;
}

// Standard normal CDF (Abramowitz-Stegun 7.1.26) — maps a factor z-score to a 0-1 percentile.
function zToUnit(z: unknown): number | undefined {
  const n = Number(z);
  if (z == null || !Number.isFinite(n)) return undefined;
  const t = 1 / (1 + 0.3275911 * Math.abs(n) / Math.SQRT2);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(n * n) / 2);
  return n >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

function fromBackendScores(scores?: BackendFactorScores): FactorScores | undefined {
  if (!scores) return undefined;
  return {
    value: zToUnit(scores.value),
    momentum: zToUnit(scores.momentum),
    quality: zToUnit(scores.quality),
    low_vol: zToUnit(scores.low_volatility),
    composite: scores.percentile ?? zToUnit(scores.composite),
  };
}

function normalizeFactors(row?: StockIdea | null, override?: FactorScores): FactorScores {
  return override || row?.factors || fromBackendScores(row?.scores) || {};
}

function compositeOf(row: StockIdea): number {
  if (row.percentile != null) return score(row.percentile);
  return score(normalizeFactors(row).composite);
}

function factorChips(row?: StockIdea | null, factors?: FactorScores): string[] {
  if (row?.chips?.length) return row.chips;
  const active = normalizeFactors(row, factors);
  return Object.entries(active)
    .filter(([name, value]) => name !== "composite" && score(value) >= 60)
    .map(([name]) => name.replace("_", " ").toUpperCase());
}

export function FactorDashboardPage() {
  const [market, setMarket] = useState<FactorMarket>("India");
  const [sector, setSector] = useState("All");
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

  const ideasQuery = useQuery({
    queryKey: ["stock-picking", "ideas", market, sector],
    queryFn: () => fetchStockIdeas({ market, sector: sector === "All" ? undefined : sector, quintile: 5, limit: 75 }),
  });

  const ideas = ideasQuery.data || [];
  const activeIdea = useMemo(() => {
    if (selectedSymbol) return ideas.find((row) => row.symbol === selectedSymbol) || null;
    return ideas[0] || null;
  }, [ideas, selectedSymbol]);

  const factorQuery = useQuery({
    queryKey: ["stock-picking", "factors", market, activeIdea?.symbol],
    queryFn: () => fetchSymbolFactors(activeIdea?.symbol || "", market),
    enabled: Boolean(activeIdea?.symbol),
  });

  const activeFactors = normalizeFactors(activeIdea, factorQuery.data?.factors || fromBackendScores(factorQuery.data?.scores));
  const radarRows = [
    { factor: "Value", score: score(activeFactors.value) },
    { factor: "Momentum", score: score(activeFactors.momentum) },
    { factor: "Quality", score: score(activeFactors.quality) },
    { factor: "Low-Vol", score: score(activeFactors.low_vol) },
    { factor: "Composite", score: activeIdea ? compositeOf(activeIdea) : score(activeFactors.composite) },
  ];
  const whyRanked = factorQuery.data?.why_ranked || activeIdea?.why_ranked || [];

  return (
    <div className="space-y-3 p-3">
      <TerminalPanel title="Factor Dashboard" subtitle="Top-quintile stock-picking ideas">
        <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-[220px_260px_1fr]">
          <div className="flex gap-1">
            {(["India", "US"] as const).map((item) => (
              <button key={item} type="button" className={`rounded border px-3 py-1 ${market === item ? "border-terminal-accent bg-terminal-accent/10 text-terminal-accent" : "border-terminal-border text-terminal-muted"}`} onClick={() => { setMarket(item); setSelectedSymbol(null); }}>
                {item}
              </button>
            ))}
          </div>
          <select className="rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={sector} onChange={(event) => { setSector(event.target.value); setSelectedSymbol(null); }}>
            {SECTORS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <div className="text-terminal-muted">Market and sector filters are passed through to the stock-picking API.</div>
        </div>
      </TerminalPanel>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.15fr_0.85fr]">
        <TerminalPanel title="Idea List" subtitle={`${market} / ${sector} / top quintile`}>
          <div className="max-h-[62vh] overflow-auto">
            <table className="min-w-full text-[11px]">
              <thead>
                <tr className="border-b border-terminal-border/50 text-terminal-muted">
                  {["Rank", "Symbol", "Name", "Sector", "Composite", "Factors"].map((header) => <th key={header} className="px-2 py-1 text-left">{header}</th>)}
                </tr>
              </thead>
              <tbody>
                {ideas.map((row, index) => (
                  <tr key={`${row.symbol}-${index}`} className={`cursor-pointer border-b border-terminal-border/30 hover:bg-terminal-bg ${activeIdea?.symbol === row.symbol ? "bg-terminal-accent/10" : ""}`} onClick={() => setSelectedSymbol(row.symbol)}>
                    <td className="px-2 py-1">{row.rank ?? index + 1}</td>
                    <td className="px-2 py-1 font-semibold text-terminal-accent">{row.symbol}</td>
                    <td className="px-2 py-1">{row.name || row.company_name || "-"}</td>
                    <td className="px-2 py-1 text-terminal-muted">{row.sector || "-"}</td>
                    <td className="px-2 py-1 text-right" title="Composite factor percentile within the universe">{compositeOf(row).toFixed(1)}</td>
                    <td className="px-2 py-1">
                      <div className="flex flex-wrap gap-1">
                        {factorChips(row).slice(0, 4).map((chip) => <span key={`${row.symbol}-${chip}`} className="rounded border border-terminal-border px-1 py-0.5 text-[10px] text-terminal-muted">{chip}</span>)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!ideas.length && <div className="p-3 text-xs text-terminal-muted">{ideasQuery.isLoading ? "Loading ideas..." : "No ideas returned."}</div>}
          </div>
        </TerminalPanel>

        <TerminalPanel title={activeIdea?.symbol || "Factor Radar"} subtitle={activeIdea?.name || activeIdea?.company_name || "Select an idea"}>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarRows} outerRadius="72%">
                <PolarGrid />
                <PolarAngleAxis dataKey="factor" />
                <PolarRadiusAxis domain={[0, 100]} />
                <Tooltip />
                <Radar dataKey="score" stroke="#22c55e" fill="#22c55e" fillOpacity={0.22} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {factorChips(activeIdea, activeFactors).map((chip) => <span key={chip} className="rounded border border-terminal-accent/50 bg-terminal-accent/10 px-2 py-0.5 text-[10px] text-terminal-accent">{chip}</span>)}
          </div>
          <div className="mt-3 rounded border border-terminal-border bg-terminal-bg p-2 text-xs text-terminal-muted">
            <div className="mb-1 font-semibold uppercase tracking-wide text-terminal-text">Why Ranked</div>
            {whyRanked.length ? whyRanked.map((item) => <div key={String(item)}>{String(item)}</div>) : <div>Composite factor score ranks in the top quintile for the selected market universe.</div>}
          </div>
        </TerminalPanel>
      </div>
    </div>
  );
}
