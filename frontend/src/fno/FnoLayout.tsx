import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useOutletContext, useSearchParams, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { ErrorBoundary } from "../components/common/ErrorBoundary";
import { StatusBar } from "../components/layout/StatusBar";
import { TopBar } from "../components/layout/TopBar";
import { UserAccountPanel } from "../components/layout/UserAccountPanel";
import { useSettingsStore } from "../store/settingsStore";
import { fetchExpiries } from "./api/fnoApi";
import type { FnoContextValue } from "./types/fno";
import { DEFAULT_FNO_SYMBOLS } from "./types/fno";
import logo from "../assets/logo.png";

const LINKS = [
  { to: "/fno", label: "Option Chain", key: "F1" },
  { to: "/fno/greeks", label: "Greeks", key: "F2" },
  { to: "/fno/futures", label: "Futures", key: "F3" },
  { to: "/fno/oi", label: "OI Analysis", key: "F4" },
  { to: "/fno/strategy", label: "Strategy", key: "F5" },
  { to: "/fno/pcr", label: "PCR", key: "F6" },
  { to: "/fno/heatmap", label: "Heatmap", key: "F7" },
  { to: "/fno/expiry", label: "Expiry", key: "F8" },
  { to: "/fno/about", label: "About", key: "F9" },
] as const;
const POPULAR_FNO_INDICES = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50"] as const;
const FNO_SYMBOL_KEY = "fno:selectedSymbol";

export function useFnoContext(): FnoContextValue {
  return useOutletContext<FnoContextValue>();
}

export function FnoLayout() {
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
  const symbolUniverse = useMemo(() => new Set((DEFAULT_FNO_SYMBOLS as readonly string[]).map((s) => s.toUpperCase())), []);
  const setSelectedCountry = useSettingsStore((s) => s.setSelectedCountry);

  useEffect(() => {
    setSelectedCountry("IN");
  }, [setSelectedCountry]);

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
    <div className="flex h-screen min-h-screen bg-terminal-bg text-terminal-text">
      <aside className="flex h-full w-56 shrink-0 flex-col border-r border-terminal-border bg-terminal-panel p-0">
        <div className="border-b border-terminal-border bg-terminal-panel px-3 py-2">
          <img src={logo} alt="OpenTerminalUI" className="h-8 w-auto object-contain" />
        </div>
        <div className="border-b border-terminal-border px-3 py-2 text-[11px] text-terminal-muted">
          NSE F&O ANALYTICS
        </div>
        <div className="space-y-1 border-b border-terminal-border px-2 py-2">
          <NavLink to="/" className="block rounded px-2 py-1.5 text-xs text-terminal-accent hover:underline">
            Back to Home
          </NavLink>
          <div>
            <NavLink
              to={`/equity/stocks?ticker=${encodeURIComponent(symbol)}`}
              className="block rounded px-2 py-1.5 text-xs text-terminal-muted hover:bg-terminal-bg hover:text-terminal-text"
            >
              Switch to Equity {"->"}
            </NavLink>
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-auto p-2 text-xs">
          {LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === "/fno"}
              className={({ isActive }) =>
                `flex items-center justify-between rounded px-2 py-2 ${isActive ? "bg-terminal-accent/20 text-terminal-accent" : "text-terminal-muted hover:bg-terminal-bg hover:text-terminal-text"
                }`
              }
            >
              <span>{link.label}</span>
              <span className="text-[10px]">{link.key}</span>
            </NavLink>
          ))}
        </nav>
        <UserAccountPanel />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        {/* F&O specific header - hide on about page */}
        {!location.pathname.endsWith("/about") && (
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
                    <option key={item} value={item}>{item}</option>
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
                    <option key={item} value={item}>{item}</option>
                  ))}
                  {!expiries.length && <option value="">No expiry</option>}
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
                <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs">NSE F&O</div>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1">
              <span className="mr-1 text-[10px] uppercase tracking-wide text-terminal-muted">Popular Indices</span>
              {POPULAR_FNO_INDICES.map((idx) => (
                <button
                  key={idx}
                  className={`rounded border px-2 py-1 text-[11px] ${symbol === idx ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted hover:text-terminal-text"}`}
                  onClick={() => setSymbol(idx)}
                >
                  {idx}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto p-3">
          <ErrorBoundary>
            <Outlet context={ctx} />
          </ErrorBoundary>
        </div>
        <StatusBar tickerOverride={symbol} />
      </div>
    </div>
  );
}
