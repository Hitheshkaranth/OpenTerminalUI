import { useEffect } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import {
  fetchAlerts,
  fetchFeedHealth,
  fetchKillSwitches,
  fetchAuditEvents,
  fetchOmsOrders,
  fetchPaperOrders,
  fetchPaperPerformance,
  fetchPaperPortfolios,
  fetchPaperPositions,
  fetchWatchlist,
} from "../api/client";
import { fetchRiskExposures, fetchRiskSummary } from "../api/quantClient";
import { TerminalShell, useTerminalShellWorkspace } from "../components/layout/TerminalShell";
import { TerminalBadge } from "../components/terminal/TerminalBadge";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { getSymbolNews } from "../providers/newsProvider";
import { useAlertsStore } from "../store/alertsStore";
import { useSettingsStore } from "../store/settingsStore";
import { useStockStore } from "../store/stockStore";
import type { AlertRule, AuditEvent, KillSwitch, OmsOrder, PaperOrder, PaperPerformance, PaperPortfolio, PaperPosition, WatchlistItem } from "../types";

function EquityRightRail() {
  const location = useLocation();
  const { preset, rightRailOpen } = useTerminalShellWorkspace();
  const ticker = useStockStore((s) => s.ticker);
  const unreadCount = useAlertsStore((s) => s.unreadCount);
  const selectedMarket = useSettingsStore((s) => s.selectedMarket);
  const isPaperRoute = location.pathname.includes("/equity/paper");
  const isRiskRoute = location.pathname.includes("/equity/risk");
  const isOpsRoute = location.pathname.includes("/equity/ops");
  const isOmsRoute = location.pathname.includes("/equity/oms");

  const watchlistQuery = useQuery({
    queryKey: ["right-rail", "watchlist"],
    queryFn: fetchWatchlist,
    staleTime: 60_000,
    refetchInterval: 120_000,
    refetchOnWindowFocus: false,
  });

  const alertsQuery = useQuery({
    queryKey: ["right-rail", "alerts"],
    queryFn: fetchAlerts,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });

  const newsQuery = useQuery({
    queryKey: ["right-rail", "news", selectedMarket, ticker],
    queryFn: () => getSymbolNews({ symbol: (ticker || "RELIANCE").toUpperCase(), market: selectedMarket, limit: 5 }),
    enabled: Boolean(ticker),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });

  const paperPortfoliosQuery = useQuery({
    queryKey: ["right-rail", "paper", "portfolios"],
    queryFn: fetchPaperPortfolios,
    enabled: isPaperRoute,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
  const activePaperPortfolioId = (paperPortfoliosQuery.data?.[0]?.id ?? "") as string;
  const paperPositionsQuery = useQuery({
    queryKey: ["right-rail", "paper", "positions", activePaperPortfolioId],
    queryFn: () => fetchPaperPositions(activePaperPortfolioId),
    enabled: isPaperRoute && Boolean(activePaperPortfolioId),
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });
  const paperOrdersQuery = useQuery({
    queryKey: ["right-rail", "paper", "orders", activePaperPortfolioId],
    queryFn: () => fetchPaperOrders(activePaperPortfolioId),
    enabled: isPaperRoute && Boolean(activePaperPortfolioId),
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });
  const paperPerfQuery = useQuery({
    queryKey: ["right-rail", "paper", "perf", activePaperPortfolioId],
    queryFn: () => fetchPaperPerformance(activePaperPortfolioId),
    enabled: isPaperRoute && Boolean(activePaperPortfolioId),
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });

  const riskSummaryQuery = useQuery({
    queryKey: ["right-rail", "risk", "summary"],
    queryFn: fetchRiskSummary,
    enabled: isRiskRoute,
    staleTime: 20_000,
    refetchInterval: 45_000,
    refetchOnWindowFocus: false,
  });
  const riskExposuresQuery = useQuery({
    queryKey: ["right-rail", "risk", "exposures"],
    queryFn: fetchRiskExposures,
    enabled: isRiskRoute,
    staleTime: 20_000,
    refetchInterval: 45_000,
    refetchOnWindowFocus: false,
  });

  const opsFeedQuery = useQuery({
    queryKey: ["right-rail", "ops", "feed-health"],
    queryFn: fetchFeedHealth,
    enabled: isOpsRoute,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });
  const opsSwitchesQuery = useQuery({
    queryKey: ["right-rail", "ops", "kill-switches"],
    queryFn: fetchKillSwitches,
    enabled: isOpsRoute,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });

  const omsOrdersQuery = useQuery({
    queryKey: ["right-rail", "oms", "orders"],
    queryFn: () => fetchOmsOrders(),
    enabled: isOmsRoute,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });
  const omsAuditQuery = useQuery({
    queryKey: ["right-rail", "oms", "audit"],
    queryFn: () => fetchAuditEvents(),
    enabled: isOmsRoute,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });

  const watchlistItems = (watchlistQuery.data ?? []) as WatchlistItem[];
  const activeAlerts = ((alertsQuery.data ?? []) as AlertRule[]).filter((a) => (a.status || "active") !== "deleted");
  const symbolNews = newsQuery.data ?? [];
  const paperPortfolios = (paperPortfoliosQuery.data ?? []) as PaperPortfolio[];
  const paperPositions = (paperPositionsQuery.data ?? []) as PaperPosition[];
  const paperOrders = (paperOrdersQuery.data ?? []) as PaperOrder[];
  const paperPerf = (paperPerfQuery.data ?? null) as PaperPerformance | null;
  const riskSummary = (riskSummaryQuery.data ?? null) as Record<string, unknown> | null;
  const riskExposures = (riskExposuresQuery.data ?? {}) as Record<string, unknown>;
  const opsFeed = (opsFeedQuery.data ?? {}) as Record<string, unknown>;
  const opsSwitches = (opsSwitchesQuery.data ?? []) as KillSwitch[];
  const omsOrders = (omsOrdersQuery.data ?? []) as OmsOrder[];
  const omsAudit = (omsAuditQuery.data ?? []) as AuditEvent[];

  const routeLabel = (() => {
    if (location.pathname.includes("/equity/stocks")) return "Market / Stock Detail";
    if (location.pathname.includes("/equity/screener")) return "Equity Screener";
    if (location.pathname.includes("/equity/portfolio")) return "Portfolio";
    if (location.pathname.includes("/equity/paper")) return "Paper Trading";
    if (location.pathname.includes("/equity/risk")) return "Risk Dashboard";
    if (location.pathname.includes("/equity/ops")) return "Ops Dashboard";
    if (location.pathname.includes("/equity/oms")) return "OMS / Compliance";
    if (location.pathname.includes("/equity/news")) return "News";
    if (location.pathname.includes("/equity/watchlist")) return "Watchlist";
    return "Equity Workspace";
  })();

  const quickLinks = [
    { to: "/equity/stocks", label: "Chart" },
    { to: "/equity/screener", label: "Screener" },
    { to: "/equity/portfolio", label: "Portfolio" },
    { to: "/equity/paper", label: "Paper" },
    { to: "/equity/risk", label: "Risk" },
    { to: "/equity/ops", label: "Ops" },
  ];

  const presetHintTitle = preset === "trader" ? "Trader Flow" : preset === "quant" ? "Quant Flow" : preset === "pm" ? "PM Flow" : preset === "risk" ? "Risk Flow" : "Ops Flow";

  return (
    <aside className="hidden xl:flex h-full w-72 shrink-0 flex-col border-l border-terminal-border bg-terminal-panel">
      <div className="border-b border-terminal-border px-3 py-2">
        <div className="ot-type-panel-title text-terminal-accent">Market Context</div>
        <div className="ot-type-panel-subtitle text-terminal-muted">{routeLabel}</div>
      </div>
      <div className="flex-1 space-y-2 overflow-auto p-2">
        <TerminalPanel
          title="Workspace"
          subtitle="Preset + Session"
          actions={<TerminalBadge variant="accent">{preset.toUpperCase()}</TerminalBadge>}
          bodyClassName="space-y-2"
        >
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-1">
              <div className="text-terminal-muted">Ticker</div>
              <div className="text-terminal-text">{(ticker || "RELIANCE").toUpperCase()}</div>
            </div>
            <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-1">
              <div className="text-terminal-muted">Alerts</div>
              <div className={unreadCount > 0 ? "text-terminal-accent" : "text-terminal-muted"}>{unreadCount}</div>
            </div>
          </div>
          <div className="text-[11px] text-terminal-muted">
            Context rail is {rightRailOpen ? "open" : "closed"} for the current workspace and persists per module.
          </div>
        </TerminalPanel>

        <TerminalPanel title="Quick Jump" subtitle="Role-aware links" bodyClassName="space-y-1">
          <div className="grid grid-cols-2 gap-1">
            {quickLinks.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={`rounded-sm border px-2 py-1 ot-type-label ${
                  location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
                    ? "border-terminal-accent text-terminal-accent"
                    : "border-terminal-border text-terminal-muted hover:text-terminal-text"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </TerminalPanel>

        <TerminalPanel title="Watchlist" subtitle="Live summary" bodyClassName="space-y-1">
          {watchlistQuery.isLoading ? (
            <div className="text-[11px] text-terminal-muted">Loading watchlist...</div>
          ) : watchlistItems.length === 0 ? (
            <div className="text-[11px] text-terminal-muted">No watchlist items found.</div>
          ) : (
            <div className="space-y-1">
              {watchlistItems.slice(0, 6).map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-[11px]">
                  <span className="truncate text-terminal-text">{item.ticker}</span>
                  <span className="text-terminal-muted">{item.watchlist_name}</span>
                </div>
              ))}
            </div>
          )}
        </TerminalPanel>

        <TerminalPanel
          title="Alerts"
          subtitle="Active rules"
          actions={<TerminalBadge variant={unreadCount > 0 ? "accent" : "neutral"}>{unreadCount} unread</TerminalBadge>}
          bodyClassName="space-y-1"
        >
          {alertsQuery.isLoading ? (
            <div className="text-[11px] text-terminal-muted">Loading alerts...</div>
          ) : activeAlerts.length === 0 ? (
            <div className="text-[11px] text-terminal-muted">No active alerts.</div>
          ) : (
            activeAlerts.slice(0, 5).map((alert) => (
              <div key={alert.id} className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-[11px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-terminal-text">{alert.ticker}</span>
                  <span className="text-terminal-muted uppercase">{alert.alert_type}</span>
                </div>
                <div className="truncate text-terminal-muted">
                  {alert.condition} {alert.threshold ?? "-"} {alert.note ? `| ${alert.note}` : ""}
                </div>
              </div>
            ))
          )}
        </TerminalPanel>

        <TerminalPanel title="News" subtitle={`Latest for ${(ticker || "RELIANCE").toUpperCase()}`} bodyClassName="space-y-1">
          {newsQuery.isLoading ? (
            <div className="text-[11px] text-terminal-muted">Loading news...</div>
          ) : symbolNews.length === 0 ? (
            <div className="text-[11px] text-terminal-muted">No recent symbol news.</div>
          ) : (
            symbolNews.slice(0, 4).map((item) => (
              <button
                key={item.id}
                type="button"
                className="block w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-left hover:border-terminal-accent/60"
                onClick={() => window.open(item.url, "_blank", "noopener,noreferrer")}
              >
                <div className="truncate text-[11px] text-terminal-text">{item.headline}</div>
                <div className="truncate text-[10px] text-terminal-muted">{item.source}</div>
              </button>
            ))
          )}
        </TerminalPanel>

        {isPaperRoute ? (
          <>
            <TerminalPanel title="Paper Portfolio" subtitle="Quick status" bodyClassName="space-y-1">
              {paperPortfoliosQuery.isLoading ? (
                <div className="text-[11px] text-terminal-muted">Loading paper portfolios...</div>
              ) : !paperPortfolios.length ? (
                <div className="text-[11px] text-terminal-muted">No paper portfolios found.</div>
              ) : (
                <>
                  <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-[11px]">
                    <div className="truncate text-terminal-text">{paperPortfolios[0].name}</div>
                    <div className="text-terminal-muted">
                      Cash: {Number(paperPortfolios[0].current_cash || 0).toLocaleString()}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-[11px]">
                    <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-1">
                      <div className="text-terminal-muted">Positions</div>
                      <div>{paperPositions.length}</div>
                    </div>
                    <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-1">
                      <div className="text-terminal-muted">Open Orders</div>
                      <div>{paperOrders.filter((o) => String(o.status).toLowerCase() !== "filled").length}</div>
                    </div>
                  </div>
                </>
              )}
            </TerminalPanel>
            <TerminalPanel title="Paper Performance" subtitle="P&L snapshot" bodyClassName="space-y-1 text-[11px]">
              {paperPerfQuery.isLoading ? (
                <div className="text-terminal-muted">Loading performance...</div>
              ) : !paperPerf ? (
                <div className="text-terminal-muted">No performance data available.</div>
              ) : (
                <>
                  <div className="flex justify-between"><span className="text-terminal-muted">Equity</span><span>{Number(paperPerf.equity || 0).toLocaleString()}</span></div>
                  <div className="flex justify-between"><span className="text-terminal-muted">PnL</span><span className={Number(paperPerf.pnl || 0) >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>{Number(paperPerf.pnl || 0).toLocaleString()}</span></div>
                  <div className="flex justify-between"><span className="text-terminal-muted">Return</span><span>{Number(paperPerf.cumulative_return || 0).toFixed(2)}%</span></div>
                </>
              )}
            </TerminalPanel>
          </>
        ) : null}

        {isRiskRoute ? (
          <>
            <TerminalPanel title="Risk Snapshot" subtitle="Summary metrics" bodyClassName="space-y-1 text-[11px]">
              {riskSummaryQuery.isLoading ? (
                <div className="text-terminal-muted">Loading risk summary...</div>
              ) : !riskSummary ? (
                <div className="text-terminal-muted">No risk summary available.</div>
              ) : (
                <>
                  <div className="flex justify-between"><span className="text-terminal-muted">EWMA Vol</span><span>{Number(riskSummary.ewma_vol || 0).toFixed(4)}</span></div>
                  <div className="flex justify-between"><span className="text-terminal-muted">Beta</span><span>{Number(riskSummary.beta || 0).toFixed(4)}</span></div>
                  <div className="flex justify-between"><span className="text-terminal-muted">MCR Assets</span><span>{Object.keys((riskSummary.marginal_contribution as Record<string, unknown>) || {}).length}</span></div>
                </>
              )}
            </TerminalPanel>
            <TerminalPanel title="Exposures" subtitle="Top entries" bodyClassName="space-y-1 text-[11px]">
              {riskExposuresQuery.isLoading ? (
                <div className="text-terminal-muted">Loading exposures...</div>
              ) : Object.keys(riskExposures).length === 0 ? (
                <div className="text-terminal-muted">No exposure rows.</div>
              ) : (
                Object.entries(riskExposures)
                  .slice(0, 5)
                  .map(([k, v]) => (
                    <div key={k} className="flex justify-between rounded border border-terminal-border bg-terminal-bg px-2 py-1">
                      <span className="truncate text-terminal-muted">{k}</span>
                      <span>{typeof v === "number" ? v.toFixed(4) : String(v)}</span>
                    </div>
                  ))
              )}
            </TerminalPanel>
          </>
        ) : null}

        {isOpsRoute ? (
          <>
            <TerminalPanel title="Feed Health" subtitle="Ops snapshot" bodyClassName="space-y-1 text-[11px]">
              {opsFeedQuery.isLoading ? (
                <div className="text-terminal-muted">Loading feed health...</div>
              ) : (
                <>
                  <div className="flex justify-between"><span className="text-terminal-muted">State</span><span>{String(opsFeed.feed_state || "-")}</span></div>
                  <div className="flex justify-between"><span className="text-terminal-muted">Kite Stream</span><span>{String(opsFeed.kite_stream_status || "-")}</span></div>
                  <div className="flex justify-between"><span className="text-terminal-muted">WS Clients</span><span>{String(opsFeed.ws_connected_clients || 0)}</span></div>
                </>
              )}
            </TerminalPanel>
            <TerminalPanel title="Kill Switches" subtitle="Quick audit" bodyClassName="space-y-1">
              {opsSwitchesQuery.isLoading ? (
                <div className="text-[11px] text-terminal-muted">Loading switches...</div>
              ) : !opsSwitches.length ? (
                <div className="text-[11px] text-terminal-muted">No kill switches returned.</div>
              ) : (
                opsSwitches.slice(0, 5).map((sw) => (
                  <div key={sw.id} className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-[11px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-terminal-text">{sw.scope}</span>
                      <TerminalBadge variant={sw.enabled ? "danger" : "neutral"}>{sw.enabled ? "ENABLED" : "DISABLED"}</TerminalBadge>
                    </div>
                    <div className="truncate text-terminal-muted">{sw.reason || "No reason"}</div>
                  </div>
                ))
              )}
            </TerminalPanel>
          </>
        ) : null}

        {isOmsRoute ? (
          <>
            <TerminalPanel title="OMS Orders" subtitle="Execution summary" bodyClassName="space-y-1 text-[11px]">
              {omsOrdersQuery.isLoading ? (
                <div className="text-terminal-muted">Loading OMS orders...</div>
              ) : !omsOrders.length ? (
                <div className="text-terminal-muted">No OMS orders found.</div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-1">
                    <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-1">
                      <div className="text-terminal-muted">Total</div>
                      <div>{omsOrders.length}</div>
                    </div>
                    <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-1">
                      <div className="text-terminal-muted">Rejected</div>
                      <div className="text-terminal-neg">
                        {omsOrders.filter((o) => String(o.status).toLowerCase().includes("reject")).length}
                      </div>
                    </div>
                  </div>
                  {omsOrders.slice(0, 4).map((o) => (
                    <div key={o.id} className="rounded border border-terminal-border bg-terminal-bg px-2 py-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-terminal-text">
                          {o.symbol} {o.side} {o.quantity}
                        </span>
                        <TerminalBadge
                          variant={String(o.status).toLowerCase().includes("reject") ? "danger" : "neutral"}
                        >
                          {String(o.status)}
                        </TerminalBadge>
                      </div>
                      {o.rejection_reason ? <div className="truncate text-terminal-neg">{o.rejection_reason}</div> : null}
                    </div>
                  ))}
                </>
              )}
            </TerminalPanel>
            <TerminalPanel title="Audit Log" subtitle="Latest events" bodyClassName="space-y-1">
              {omsAuditQuery.isLoading ? (
                <div className="text-[11px] text-terminal-muted">Loading audit events...</div>
              ) : !omsAudit.length ? (
                <div className="text-[11px] text-terminal-muted">No audit events found.</div>
              ) : (
                omsAudit.slice(0, 5).map((a) => (
                  <div key={a.id} className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-[11px]">
                    <div className="truncate text-terminal-text">{a.event_type}</div>
                    <div className="truncate text-terminal-muted">
                      {a.entity_type}:{a.entity_id || "-"}
                    </div>
                  </div>
                ))
              )}
              <div className="text-[10px] text-terminal-muted">
                Restricted-list read API not yet exposed in `client.ts`; rail currently summarizes orders + audit.
              </div>
            </TerminalPanel>
          </>
        ) : null}

        <TerminalPanel title={presetHintTitle} subtitle="Keyboard-first workflow" bodyClassName="space-y-1 text-[11px] text-terminal-muted">
          {location.pathname.includes("/equity/screener") ? (
            <>
              <div>Use table sorting on key columns (MCap / PE / ROE / ROCE).</div>
              <div>Arrow keys navigate selected rows; Enter opens focused item context.</div>
              <div>Compact density is enabled for high-row throughput.</div>
            </>
          ) : location.pathname.includes("/equity/news") ? (
            <>
              <div>`/` focuses search in News panel.</div>
              <div>`R` refreshes feed; Arrow keys move selection; Enter opens story.</div>
              <div>Use symbol/market scope toggle for breadth vs depth.</div>
            </>
          ) : (
            <>
              <div>`Ctrl/Cmd+K` is reserved for command palette rollout (shell foundation now in place).</div>
              <div>Workspace presets persist and will drive role-specific layouts in next iterations.</div>
              <div>Right rail content is route-aware and can be expanded per page without shell rewrites.</div>
            </>
          )}
        </TerminalPanel>
      </div>
    </aside>
  );
}

export function EquityLayout() {
  const setTicker = useStockStore((s) => s.setTicker);
  const location = useLocation();

  useEffect(() => {
    const p = new URLSearchParams(location.search);
    const t = (p.get("ticker") || p.get("symbol") || "").trim().toUpperCase();
    if (t) {
      setTicker(t);
    }
  }, [location.search, setTicker]);

  return (
    <TerminalShell
      contentClassName="pb-16 md:pb-0"
      showInstallPrompt
      showMobileBottomNav
      hideSidebarOnMobile
      workspacePresetStorageKey="ot:shell:equity:preset"
      rightRailStorageKey="ot:shell:equity:right-rail"
      rightRailContent={<EquityRightRail />}
    >
      <Outlet />
    </TerminalShell>
  );
}
