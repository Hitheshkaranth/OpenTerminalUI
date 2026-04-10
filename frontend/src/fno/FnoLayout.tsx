import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useOutletContext, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { ErrorBoundary } from "../components/common/ErrorBoundary";
import { TerminalShell } from "../components/layout/TerminalShell";
import { TerminalBadge } from "../components/terminal/TerminalBadge";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { useSettingsStore } from "../store/settingsStore";
import { fetchExpiries } from "./api/fnoApi";
import type { FnoContextValue } from "./types/fno";
import { DEFAULT_FNO_SYMBOLS } from "./types/fno";

const LINKS = [
  { to: "/fno", label: "Option Chain", key: "F1" },
  { to: "/fno/greeks", label: "Greeks", key: "F2" },
  { to: "/fno/futures", label: "Futures", key: "F3" },
  { to: "/fno/oi", label: "OI Analysis", key: "F4" },
  { to: "/fno/strategy", label: "Strategy", key: "F5" },
  { to: "/fno/pcr", label: "PCR", key: "F6" },
  { to: "/fno/flow", label: "Flow", key: "F7" },
  { to: "/fno/expiry", label: "Expiry", key: "F8" },
  { to: "/fno/about", label: "About", key: "F9" },
] as const;

const POPULAR_FNO_INDICES = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50"] as const;
const FNO_SYMBOL_KEY = "fno:selectedSymbol";

function FnoRightRail({ symbol, expiry, expiries, market }: { symbol: string; expiry: string; expiries: string[]; market: "NSE" | "US" }) {
  const location = useLocation();

  return (
    <aside className="hidden xl:flex h-full w-72 shrink-0 flex-col border-l border-terminal-border bg-terminal-panel">
      <div className="border-b border-terminal-border px-3 py-2">
        <div className="ot-type-panel-title text-terminal-accent">F&O Context</div>
        <div className="ot-type-panel-subtitle text-terminal-muted">Derivatives workspace navigation</div>
      </div>
      <div className="flex-1 space-y-2 overflow-auto p-2">
        <TerminalPanel
          title="Active Contract"
          subtitle="Current routing context"
          actions={<TerminalBadge variant="accent">{market}</TerminalBadge>}
          bodyClassName="space-y-2"
        >
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-1">
              <div className="text-terminal-muted">Symbol</div>
              <div className="text-terminal-text">{symbol}</div>
            </div>
            <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-1">
              <div className="text-terminal-muted">Expiry</div>
              <div className="text-terminal-text">{expiry || "No expiry"}</div>
            </div>
          </div>
          <div className="text-[11px] text-terminal-muted">
            {expiries.length} expiry option{expiries.length === 1 ? "" : "s"} loaded for the current symbol.
          </div>
        </TerminalPanel>

        <TerminalPanel title="Navigation" subtitle="Match the main app shell" bodyClassName="space-y-1">
          <div className="space-y-1">
            <NavLink
              to="/"
              className="block rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-muted hover:text-terminal-text"
            >
              Home
            </NavLink>
            <NavLink
              to={`/equity/stocks?ticker=${encodeURIComponent(symbol)}`}
              className="block rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-muted hover:text-terminal-text"
            >
              Switch to Equity
            </NavLink>
          </div>
        </TerminalPanel>

        <TerminalPanel title="F&O Modules" subtitle="Workspace sections" bodyClassName="space-y-1">
          {LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === "/fno"}
              className={({ isActive }) =>
                `flex items-center justify-between rounded border px-2 py-1 text-[11px] ${
                  isActive
                    ? "border-terminal-accent text-terminal-accent"
                    : "border-terminal-border text-terminal-muted hover:text-terminal-text"
                }`
              }
            >
              <span>{link.label}</span>
              <span>{link.key}</span>
            </NavLink>
          ))}
        </TerminalPanel>

        <TerminalPanel title="Route" subtitle="Current page" bodyClassName="text-[11px] text-terminal-muted">
          {location.pathname}
        </TerminalPanel>
      </div>
    </aside>
  );
}

export function useFnoContext(): FnoContextValue {
  return useOutletContext<FnoContextValue>();
}

export function FnoLayout() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [symbol, setSymbol] = useState<string>(() => {
    try {
      const raw = localStorage.getItem(FNO_SYMBOL_KEY);
      const value = (raw || "NIFTY").trim().toUpperCase();
      return value || "NIFTY";
    } catch {
      return "NIFTY";
    }
  });
  const [expiry, setExpiry] = useState<string>("");
  const [market, setMarket] = useState<"NSE" | "US">("NSE");
  const symbolUniverse = useMemo(() => new Set((DEFAULT_FNO_SYMBOLS as readonly string[]).map((s) => s.toUpperCase())), []);
  const setSelectedCountry = useSettingsStore((s) => s.setSelectedCountry);

  useEffect(() => {
    if (symbol.endsWith(".NS") || symbolUniverse.has(symbol)) {
      setMarket("NSE");
      setSelectedCountry("IN");
    } else if (/^[A-Z]{1,5}$/.test(symbol)) {
      setMarket("US");
      setSelectedCountry("US");
    }
  }, [symbol, symbolUniverse, setSelectedCountry]);

  useEffect(() => {
    try {
      localStorage.setItem(FNO_SYMBOL_KEY, symbol.toUpperCase());
    } catch {
      // ignore local storage failures
    }
  }, [symbol]);

  useEffect(() => {
    const incoming = (searchParams.get("symbol") || searchParams.get("ticker") || "").trim().toUpperCase();
    if (!incoming) return;
    if (symbolUniverse.has(incoming)) {
      setSymbol(incoming);
      return;
    }
    if (/^[A-Z0-9_-]{2,20}$/.test(incoming)) {
      setSymbol(incoming);
      return;
    }
    setSymbol("NIFTY");
  }, [searchParams, symbolUniverse]);

  const expiryQuery = useQuery({
    queryKey: ["fno-expiries", symbol],
    queryFn: () => fetchExpiries(symbol),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const expiries = useMemo(() => (expiryQuery.data ?? []).filter(Boolean), [expiryQuery.data]);

  useEffect(() => {
    if (!expiries.length) {
      setExpiry("");
      return;
    }
    if (!expiry || !expiries.includes(expiry)) {
      setExpiry(expiries[0]);
    }
  }, [expiries, expiry]);

  const ctx: FnoContextValue = { symbol, setSymbol, expiry, setExpiry, expiries };

  return (
    <TerminalShell
      contentClassName="pb-16 md:pb-0"
      showInstallPrompt
      showMobileBottomNav
      workspacePresetStorageKey="ot:shell:fno:preset"
      rightRailStorageKey="ot:shell:fno:right-rail"
      rightRailContent={<FnoRightRail symbol={symbol} expiry={expiry} expiries={expiries} market={market} />}
      statusBarTickerOverride={symbol}
    >
      {!location.pathname.endsWith("/about") ? (
        <div className="sticky top-0 z-20 border-b border-terminal-border bg-terminal-panel px-3 py-2">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
            <label className="text-[11px]">
              <span className="mb-1 block uppercase tracking-wide text-terminal-muted">Symbol</span>
              <select
                className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs outline-none focus:border-terminal-accent"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              >
                {[...new Set([...(DEFAULT_FNO_SYMBOLS as readonly string[]), symbol])].map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-[11px]">
              <span className="mb-1 block uppercase tracking-wide text-terminal-muted">Expiry</span>
              <select
                className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs outline-none focus:border-terminal-accent"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
              >
                {expiries.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
                {!expiries.length ? <option value="">No expiry</option> : null}
              </select>
            </label>

            <div className="text-[11px]">
              <span className="mb-1 block uppercase tracking-wide text-terminal-muted">Data</span>
              <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs">
                {expiryQuery.isFetching ? "Refreshing..." : "Live cache 60s"}
              </div>
            </div>

            <div className="text-[11px]">
              <span className="mb-1 block uppercase tracking-wide text-terminal-muted">Universe</span>
              <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs">
                {market} F&O
              </div>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <span className="mr-1 text-[10px] uppercase tracking-wide text-terminal-muted">Popular Indices</span>
            {POPULAR_FNO_INDICES.map((idx) => (
              <button
                key={idx}
                className={`rounded border px-2 py-1 text-[11px] ${
                  symbol === idx ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted hover:text-terminal-text"
                }`}
                onClick={() => setSymbol(idx)}
              >
                {idx}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <ErrorBoundary>
          <Outlet context={ctx} />
        </ErrorBoundary>
      </div>
    </TerminalShell>
  );
}
