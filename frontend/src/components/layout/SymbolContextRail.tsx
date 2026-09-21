import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { fetchPaperPortfolios, fetchPaperPositions } from "../../api/portfolio";
import { fetchAlertsFiltered } from "../../api/alerts";
import { addWatchlistItem } from "../../api/client";
import { useUpcomingEvents, daysUntil } from "../../api/eventsHub";
import { TerminalBadge } from "../terminal/TerminalBadge";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { TerminalButton } from "../terminal/TerminalButton";
import { ProvenanceChip } from "../common/ProvenanceChip";
import { useStockStore } from "../../store/stockStore";
import { useStock } from "../../hooks/useStocks";
import { useSettingsStore } from "../../store/settingsStore";
import type { PaperPosition } from "../../types";

function fmtPrice(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function fmtPnl(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function daysLabel(dateISO: string): string {
  const d = daysUntil(dateISO);
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d > 1) return `in ${d} d`;
  return `${Math.abs(d)} d ago`;
}

function eventBadgeVariant(type: string): "accent" | "success" | "warn" | "neutral" {
  switch (type) {
    case "earnings": return "accent";
    case "dividend": return "success";
    case "expiry": return "warn";
    default: return "neutral";
  }
}

function fmtEventDate(dateISO: string): string {
  const d = daysUntil(dateISO);
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d > 1) return `in ${d} d`;
  return `${Math.abs(d)} d ago`;
}

export function SymbolContextRail() {
  // Guard in a wrapper so the inner component's hooks always run in the same order
  // (an early return before useQuery/useMemo would break the Rules of Hooks).
  const ticker = useStockStore((s) => s.ticker);
  if (!ticker) return null;
  return <SymbolContextRailInner ticker={ticker} />;
}

function SymbolContextRailInner({ ticker }: { ticker: string }) {
  // Same react-query key as the Security Hub, so the rail shares its cache instead of
  // depending on useStockStore.stock (which only the Market page populates).
  const stockQuery = useStock(ticker);
  const storeStock = useStockStore((s) => s.stock);
  const stock = stockQuery.data ?? (storeStock && storeStock.ticker === ticker ? storeStock : null);
  const selectedMarket = useSettingsStore((s) => s.selectedMarket);
  const navigate = useNavigate();

  // --- Quote ---
  const quotePanel = (
    <TerminalPanel title="Quote" subtitle={selectedMarket} bodyClassName="space-y-1">
      {stock ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-mono text-xs text-terminal-text">{stock.ticker}</span>
            <TerminalBadge variant="neutral" size="sm">{stock.exchange || selectedMarket}</TerminalBadge>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-lg font-mono font-semibold text-terminal-text">
              {fmtPrice(stock.current_price)}
            </span>
            <TerminalBadge
              variant={(stock.change_pct ?? 0) >= 0 ? "success" : "danger"}
              size="sm"
              dot
            >
              {fmtPct(stock.change_pct)}
            </TerminalBadge>
          </div>
          <ProvenanceChip provenance={stock.provenance ?? undefined} compact />
        </>
      ) : (
        <div className="text-[11px] text-terminal-muted">Loading…</div>
      )}
    </TerminalPanel>
  );

  // --- Position (paper) ---
  const portfolioQuery = useQuery({
    queryKey: ["paper", "portfolios"],
    queryFn: fetchPaperPortfolios,
    staleTime: 30_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const activePortfolioId = useMemo(
    () => (portfolioQuery.data?.[0]?.id ?? "") as string,
    [portfolioQuery.data],
  );

  const positionsQuery = useQuery({
    queryKey: ["paper", "positions", activePortfolioId],
    queryFn: () => fetchPaperPositions(activePortfolioId),
    enabled: Boolean(activePortfolioId),
    staleTime: 30_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const matchedPosition = useMemo((): PaperPosition | null => {
    const positions = positionsQuery.data ?? [];
    const upperTicker = ticker.toUpperCase();
    for (const p of positions) {
      const sym = (p.symbol || "").toUpperCase();
      if (sym === `${selectedMarket}:${upperTicker}` || sym.endsWith(`:${upperTicker}`) || sym === upperTicker) {
        return p;
      }
    }
    return null;
  }, [positionsQuery.data, ticker, selectedMarket]);

  const positionPanel = (
    <TerminalPanel title="Position" subtitle="Paper" bodyClassName="space-y-1">
      {matchedPosition ? (
        <>
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="text-terminal-text">Qty {matchedPosition.quantity}</span>
            <span className="text-terminal-muted">Avg {fmtPrice(matchedPosition.avg_entry_price)}</span>
          </div>
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="text-terminal-muted">Mark</span>
            <span className={matchedPosition.unrealized_pnl >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>
              {fmtPnl(matchedPosition.unrealized_pnl)}
            </span>
          </div>
        </>
      ) : (
        <>
          <div className="text-[11px] text-terminal-muted">No paper position</div>
          <div className="grid grid-cols-2 gap-1">
            <TerminalButton
              size="sm"
              variant="success"
              onClick={() => {
                window.dispatchEvent(new CustomEvent("ot:hotkey-panel:open", { detail: { symbol: ticker, side: "buy" } }));
              }}
            >
              Paper Buy
            </TerminalButton>
            <TerminalButton
              size="sm"
              variant="danger"
              onClick={() => {
                window.dispatchEvent(new CustomEvent("ot:hotkey-panel:open", { detail: { symbol: ticker, side: "sell" } }));
              }}
            >
              Paper Sell
            </TerminalButton>
          </div>
        </>
      )}
    </TerminalPanel>
  );

  // --- Alerts ---
  const alertsQuery = useQuery({
    queryKey: ["alerts", "symbol", ticker],
    queryFn: () => fetchAlertsFiltered({ symbol: ticker }),
    staleTime: 30_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const alertsPanel = (
    <TerminalPanel title="Alerts" subtitle="Rules" bodyClassName="space-y-1">
      {(() => {
        const rules = (alertsQuery.data ?? []) as Array<{ id: string; condition: string; status?: string; threshold?: number; note?: string }>;
        if (alertsQuery.isLoading) {
          return <div className="text-[11px] text-terminal-muted">Loading alerts…</div>;
        }
        if (rules.length === 0) {
          return (
            <>
              <div className="text-[11px] text-terminal-muted">No alerts for {ticker}</div>
              <Link
                to={`/equity/alerts?symbol=${ticker}`}
                className="text-[11px] text-terminal-accent hover:underline"
              >
                Create alert →
              </Link>
            </>
          );
        }
        return (
          <>
            {rules.slice(0, 3).map((rule) => (
              <div key={rule.id} className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-[11px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-terminal-text">{rule.condition} {rule.threshold ?? ""}</span>
                  <TerminalBadge variant={rule.status === "active" ? "success" : "neutral"} size="sm">
                    {rule.status ?? "active"}
                  </TerminalBadge>
                </div>
                {rule.note ? <div className="truncate text-terminal-muted">{rule.note}</div> : null}
              </div>
            ))}
            <Link
              to={`/equity/alerts?symbol=${ticker}`}
              className="text-[11px] text-terminal-accent hover:underline"
            >
              Create alert →
            </Link>
          </>
        );
      })()}
    </TerminalPanel>
  );

  // --- Next events ---
  const eventsQuery = useUpcomingEvents([ticker], 45, ["earnings", "dividend", "corporate", "expiry"]);

  const eventsPanel = (
    <TerminalPanel title="Next events" subtitle="45-day view" bodyClassName="space-y-1">
      {(() => {
        if (eventsQuery.isLoading) {
          return <div className="text-[11px] text-terminal-muted">Loading events…</div>;
        }
        if (eventsQuery.error) {
          return <div className="text-[11px] text-terminal-muted">Failed to load events</div>;
        }
        const items = eventsQuery.data?.items ?? [];
        const errors = eventsQuery.data?.errors ?? [];
        if (errors.length > 0) {
          return (
            <>
              {items.slice(0, 4).map((item) => (
                <div key={item.id} className="rounded border border-terminal-border bg-terminal-bg px-2 py-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] text-terminal-text">{item.title}</span>
                    <TerminalBadge variant={eventBadgeVariant(item.type)} size="sm">
                      {item.type}
                    </TerminalBadge>
                  </div>
                  <div className="text-[10px] text-terminal-muted">{fmtEventDate(item.date)}</div>
                </div>
              ))}
              <div className="text-[11px] text-terminal-muted">
                Some sources unavailable
              </div>
            </>
          );
        }
        if (items.length === 0) {
          return <div className="text-[11px] text-terminal-muted">Nothing scheduled in 45 days</div>;
        }
        return (
          <>
            {items.slice(0, 4).map((item) => (
              <div key={item.id} className="rounded border border-terminal-border bg-terminal-bg px-2 py-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] text-terminal-text">{item.title}</span>
                  <TerminalBadge variant={eventBadgeVariant(item.type)} size="sm">
                    {item.type}
                  </TerminalBadge>
                </div>
                <div className="text-[10px] text-terminal-muted">{fmtEventDate(item.date)}</div>
              </div>
            ))}
          </>
        );
      })()}
    </TerminalPanel>
  );

  // --- Actions ---
  const actionsPanel = (
    <TerminalPanel title="Actions" subtitle="Quick links" bodyClassName="grid grid-cols-2 gap-1">
      <TerminalButton size="sm" variant="default" onClick={() => navigate(`/equity/security/${ticker}?tab=chart`)}>
        Chart
      </TerminalButton>
      <TerminalButton size="sm" variant="default" onClick={() => navigate(`/fno?symbol=${ticker}`)}>
        Options
      </TerminalButton>
      <TerminalButton size="sm" variant="default" onClick={() => navigate(`/backtesting?symbol=${ticker}`)}>
        Backtest
      </TerminalButton>
      <TerminalButton
        size="sm"
        variant="default"
        onClick={() => {
          void addWatchlistItem({ watchlist_name: "Default", ticker: ticker.toUpperCase() });
        }}
      >
        Add to Watchlist
      </TerminalButton>
      <TerminalButton
        size="sm"
        variant="success"
        onClick={() => {
          window.dispatchEvent(new CustomEvent("ot:hotkey-panel:open", { detail: { symbol: ticker, side: "buy" } }));
        }}
      >
        Paper Buy
      </TerminalButton>
      <TerminalButton
        size="sm"
        variant="danger"
        onClick={() => {
          window.dispatchEvent(new CustomEvent("ot:hotkey-panel:open", { detail: { symbol: ticker, side: "sell" } }));
        }}
      >
        Paper Sell
      </TerminalButton>
    </TerminalPanel>
  );

  return (
    <>
      {quotePanel}
      {positionPanel}
      {alertsPanel}
      {eventsPanel}
      {actionsPanel}
    </>
  );
}