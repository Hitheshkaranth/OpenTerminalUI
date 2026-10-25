import { useState } from "react";
import { Link } from "react-router-dom";
import { LaunchpadAlertsPanel, LaunchpadWatchlistPanel } from "../components/layout/LaunchpadPanels";
import type { LaunchpadPanelConfig } from "../components/layout/LaunchpadContext";

const panel: LaunchpadPanelConfig = { id: "mobile-monitor", type: "watchlist", title: "Monitoring", x: 0, y: 0, w: 12, h: 8 };
export function MonitoringPage() {
  const [tab, setTab] = useState<"watchlist" | "alerts">("watchlist");
  return <main className="mx-auto w-full max-w-3xl p-3 pb-24 sm:p-6">
    <div className="mb-5 flex items-center justify-between gap-3"><h1 className="text-xl font-semibold">Monitoring</h1><Link to="/equity/launchpad" className="text-sm underline">Open workspace</Link></div>
    <p className="mb-4 text-sm text-terminal-muted">Review the instruments you follow and your alert rules.</p>
    <nav aria-label="Monitoring views" className="mb-4 flex gap-2">{(["watchlist", "alerts"] as const).map((item) => <button type="button" key={item} aria-pressed={tab === item} onClick={() => setTab(item)} className={`min-h-11 flex-1 rounded border px-4 py-2 capitalize ${tab === item ? "border-terminal-accent text-terminal-accent" : "border-terminal-border"}`}>{item}</button>)}</nav>
    <section aria-label={tab} className="min-h-[400px] overflow-auto rounded border border-terminal-border bg-terminal-panel">{tab === "watchlist" ? <LaunchpadWatchlistPanel panel={panel} /> : <LaunchpadAlertsPanel panel={{ ...panel, type: "alerts" }} />}</section>
    <div className="mt-4 flex flex-wrap gap-4 text-sm"><Link to="/equity/watchlist" className="underline">Manage watchlist</Link><Link to="/alerts" className="underline">Manage alerts</Link></div>
  </main>;
}
