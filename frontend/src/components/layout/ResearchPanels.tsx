import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from "recharts";
import { fetchSectorAllocation, fetchPortfolioBenchmarkOverlay, fetchPortfolioRiskMetrics, fetchPeers, fetchMacroIndicators } from "../../api/client";
import { fetchGreeks, fetchOptionChain } from "../../fno/api/fnoApi";
import { GreeksHeatmap } from "../../fno/components/GreeksHeatmap";
import { OIChart } from "../../fno/components/OIChart";
import { useSettingsStore } from "../../store/settingsStore";
import type { LaunchpadPanelConfig } from "./LaunchpadContext";
import { ArtifactView } from "../../agent/components/artifacts";
import type { AgentArtifact } from "../../agent/types";

import { withinDateRange, type WorkspaceGroupContext } from "../../workspace/groupContext";

type Props = { panel: LaunchpadPanelConfig };
function State({ loading, error, empty, children }: { loading: boolean; error: boolean; empty?: boolean; children: ReactNode }) {
  if (loading) return <p role="status" className="p-4 text-sm text-terminal-muted">Loading data…</p>;
  if (error) return <div role="alert" className="p-4 text-sm"><p>Data is unavailable for this panel.</p><Link className="underline" to="/equity/settings?section=providers">Check data providers</Link></div>;
  if (empty) return <p className="p-4 text-sm text-terminal-muted">No observations available. Add holdings or select an instrument with coverage.</p>;
  return <div className="h-full overflow-auto p-3 text-sm">{children}</div>;
}
const fmt = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 3 }) : "Unavailable";

export function AllocationPanel() {
  const q = useQuery({ queryKey: ["launchpad-allocation"], queryFn: fetchSectorAllocation, staleTime: 60_000 });
  return <State loading={q.isLoading} error={q.isError} empty={!q.data?.sectors?.length}><table className="w-full"><thead><tr><th className="text-left">Sector</th><th>Weight</th></tr></thead><tbody>{q.data?.sectors.map((row) => <tr key={row.sector}><td className="py-2">{row.sector}</td><td className="text-right">{fmt(row.weight_pct)}%</td></tr>)}</tbody></table></State>;
}
export function PerformancePanel({ panel }: Props) {
  const benchmark = typeof panel.props?.benchmark === "string" && panel.props.benchmark ? panel.props.benchmark : undefined;
  const q = useQuery({ queryKey: ["launchpad-performance", benchmark], queryFn: () => fetchPortfolioBenchmarkOverlay({ benchmark }), staleTime: 60_000 });
  return <State loading={q.isLoading} error={q.isError} empty={!q.data?.equity_curve?.length}><p className="mb-2">Portfolio vs {q.data?.benchmark}</p><div className="h-64"><ResponsiveContainer><LineChart data={q.data?.equity_curve.filter((row) => withinDateRange(row.date, panel.props?.dateRange as WorkspaceGroupContext["dateRange"]))}><XAxis dataKey="date" /><YAxis /><Tooltip /><Line name="Portfolio" dataKey="portfolio" stroke="var(--ot-color-accent-primary)" dot={false} /><Line name="Benchmark" dataKey="benchmark" stroke="#638dcc" dot={false} /></LineChart></ResponsiveContainer></div></State>;
}
export function RiskMetricsPanel() {
  const q = useQuery({ queryKey: ["launchpad-risk-metrics"], queryFn: () => fetchPortfolioRiskMetrics(), staleTime: 60_000 });
  return <State loading={q.isLoading} error={q.isError} empty={!q.data}><dl>{Object.entries(q.data ?? {}).map(([key, value]) => <div key={key} className="flex justify-between gap-3 border-b border-terminal-border py-2"><dt className="capitalize">{key.replace(/_/g, " ")}</dt><dd>{fmt(value)}</dd></div>)}</dl><Link to="/equity/risk" className="mt-3 block underline">Open risk dashboard</Link></State>;
}
export function PeersPanel({ panel }: Props) {
  const symbol = panel.symbol || "";
  const q = useQuery({ queryKey: ["launchpad-peers", symbol], queryFn: () => fetchPeers(symbol), enabled: Boolean(symbol), staleTime: 60_000 });
  if (!symbol) return <p className="p-4 text-sm">Link or assign a company to compare peers.</p>;
  return <State loading={q.isLoading} error={q.isError} empty={!q.data?.metrics?.length}><p className="mb-2">{symbol} · {q.data?.universe}</p><table className="w-full"><thead><tr><th>Metric</th><th>Company</th><th>Peer median</th></tr></thead><tbody>{q.data?.metrics.map((row) => <tr key={row.metric}><td className="py-2">{row.metric}</td><td>{fmt(row.target_value)}</td><td>{fmt(row.peer_median)}</td></tr>)}</tbody></table></State>;
}
export function EconomicsPanel() {
  const country = useSettingsStore((state) => state.selectedCountry);
  const q = useQuery({ queryKey: ["launchpad-macro", country], queryFn: () => fetchMacroIndicators(country), staleTime: 600_000 });
  return <State loading={q.isLoading} error={q.isError} empty={!q.data || !Object.keys(q.data).length}>{Object.entries(q.data ?? {}).map(([region, indicators]) => <section key={region}><h3 className="font-semibold">{region}</h3><dl>{Object.entries(indicators).map(([key, item]) => <div key={key} className="border-b border-terminal-border py-2"><dt>{item.label || key}</dt><dd>{fmt(item.value)} {item.unit} <span className="text-terminal-muted">as of {item.date}</span></dd></div>)}</dl></section>)}</State>;
}
export function DerivativesPanel({ panel }: Props) {
  const symbol = panel.symbol || "NIFTY";
  const expiry = typeof panel.props?.expiry === "string" ? panel.props.expiry : undefined;
  const [side, setSide] = useState<"CE" | "PE">("CE");
  const q = useQuery({ queryKey: ["launchpad-derivatives", panel.type, symbol, expiry], queryFn: () => panel.type === "greeks" ? fetchGreeks(symbol, expiry, 30) : fetchOptionChain(symbol, expiry, 30), staleTime: 30_000 });
  const rows = q.data?.strikes ?? [];
  const validRows = panel.type === "greeks" ? rows.filter((row) => Boolean((side === "CE" ? row.ce : row.pe)?.greeks)) : rows;
  return <State loading={q.isLoading} error={q.isError} empty={!validRows.length}><p className="mb-2">{symbol} · {expiry || "Nearest available expiry"}</p>{panel.type === "greeks" ? <><label>Option side <select value={side} onChange={(event) => setSide(event.target.value as "CE" | "PE")} className="mb-2 bg-terminal-bg p-2"><option value="CE">Call</option><option value="PE">Put</option></select></label><GreeksHeatmap rows={validRows} side={side} /></> : <OIChart rows={validRows} />}</State>;
}
export function ResearchArtifactPanel({ panel }: Props) {
  const artifact = panel.props?.artifact as AgentArtifact | undefined;
  if (!artifact || typeof artifact.kind !== "string" || !artifact.data) return <p className="p-4 text-sm">Pin an agent result to save evidence in this workspace.</p>;
  return <div className="h-full overflow-auto p-3"><p className="mb-2 text-xs text-terminal-muted">Saved evidence snapshot · {String(panel.props?.savedAt || "")}. Rerun research for current data.</p><ArtifactView artifact={artifact} /></div>;
}
