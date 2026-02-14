import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useOutletContext } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { fetchExpiries } from "./api/fnoApi";
import type { FnoContextValue } from "./types/fno";
import { DEFAULT_FNO_SYMBOLS } from "./types/fno";

const LINKS = [
  { to: "/fno", label: "Option Chain" },
  { to: "/fno/greeks", label: "Greeks" },
  { to: "/fno/futures", label: "Futures" },
  { to: "/fno/oi", label: "OI Analysis" },
  { to: "/fno/strategy", label: "Strategy" },
  { to: "/fno/pcr", label: "PCR" },
  { to: "/fno/heatmap", label: "Heatmap" },
  { to: "/fno/expiry", label: "Expiry" },
] as const;

export function useFnoContext(): FnoContextValue {
  return useOutletContext<FnoContextValue>();
}

export function FnoLayout() {
  const [symbol, setSymbol] = useState<string>("NIFTY");
  const [expiry, setExpiry] = useState<string>("");

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
    <div className="flex h-full min-h-0">
      <aside className="w-56 shrink-0 border-r border-terminal-border bg-terminal-panel">
        <div className="border-b border-terminal-border px-3 py-3">
          <NavLink to="/stocks" className="text-xs text-terminal-accent hover:underline">
            ? Back to Home
          </NavLink>
          <div className="mt-2 text-[10px] uppercase tracking-wide text-terminal-muted">F&O Trading Desk</div>
        </div>
        <nav className="space-y-1 p-2 text-xs">
          {LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === "/fno"}
              className={({ isActive }) =>
                `block rounded px-2 py-2 ${isActive ? "bg-terminal-accent/20 text-terminal-accent" : "text-terminal-muted hover:bg-terminal-bg hover:text-terminal-text"}`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-20 border-b border-terminal-border bg-terminal-panel px-3 py-2">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
            <label className="text-[11px]">
              <span className="mb-1 block uppercase tracking-wide text-terminal-muted">Symbol</span>
              <select
                className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs outline-none focus:border-terminal-accent"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              >
                {DEFAULT_FNO_SYMBOLS.map((item) => (
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
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          <Outlet context={ctx} />
        </div>
      </div>
    </div>
  );
}
