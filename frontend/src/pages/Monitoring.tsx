
import { ResearchInbox } from "../components/research/ResearchInbox";
import { PortfolioResearchImpact } from "../components/research/PortfolioResearchImpact";
import { Link, useSearchParams } from "react-router-dom";
import { LaunchpadAlertsPanel, LaunchpadWatchlistPanel } from "../components/layout/LaunchpadPanels";
import type { LaunchpadPanelConfig } from "../components/layout/LaunchpadContext";

const panel: LaunchpadPanelConfig = { id: "mobile-monitor", type: "watchlist", title: "Monitoring", x: 0, y: 0, w: 12, h: 8 };
export function MonitoringPage() {
  const [params, setParams] = useSearchParams();
  const tab = (["today", "impact", "watchlist", "alerts"] as const).find(value => value === params.get("view")) ?? "today";
  const setTab = (value: string) => { const next = new URLSearchParams(params); next.set("view", value); next.delete("event"); setParams(next, { preventScrollReset: true }); };
  return <main className="mx-auto w-full max-w-6xl p-3 pb-24 sm:p-6">
    <div className="mb-5 flex items-center justify-between gap-3"><h1 className="text-xl font-semibold">Today</h1><Link to="/equity/launchpad" className="text-sm underline">Open workspace</Link></div>
    <p className="mb-4 text-sm text-terminal-muted">Review research changes, upcoming decisions and shared portfolio risks.</p>
    <nav aria-label="Monitoring views" className="mb-4 flex gap-2">{(["today", "impact", "watchlist", "alerts"] as const).map((item) => <button type="button" key={item} aria-pressed={tab === item} onClick={() => setTab(item)} className={`min-h-11 flex-1 rounded border px-4 py-2 capitalize ${tab === item ? "border-terminal-accent text-terminal-accent" : "border-terminal-border"}`}>{item === "impact" ? "Portfolio impact" : item}</button>)}</nav>
    <section aria-label={tab} className="min-h-[400px] rounded border border-terminal-border bg-terminal-panel p-3 sm:p-5">{tab === "today" ? <ResearchInbox /> : tab === "impact" ? <PortfolioResearchImpact /> : tab === "watchlist" ? <LaunchpadWatchlistPanel panel={panel} /> : <LaunchpadAlertsPanel panel={{ ...panel, type: "alerts" }} />}</section>
    <div className="mt-4 flex flex-wrap gap-4 text-sm"><Link to="/equity/watchlist" className="underline">Manage watchlist</Link><Link to="/equity/alerts" className="underline">Manage alerts</Link></div>
  </main>;
}
