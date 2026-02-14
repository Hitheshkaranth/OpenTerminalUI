import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { fetchOptionChain, fetchStrategyPayoff, fetchStrategyPresets, fetchStrategyFromPreset } from "../api/fnoApi";
import { useFnoContext } from "../FnoLayout";
import type { StrategyLeg } from "../types/fno";
import { formatCurrencyINR } from "../types/fno";

const STORAGE_KEY = "fno_strategy_pending_legs";

export function StrategyPage() {
  const { symbol, expiry } = useFnoContext();
  const [legs, setLegs] = useState<StrategyLeg[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<string>("bull_call_spread");

  const chainQuery = useQuery({
    queryKey: ["fno-strategy-chain", symbol, expiry],
    queryFn: () => fetchOptionChain(symbol, expiry || undefined, 25),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const presetsQuery = useQuery({
    queryKey: ["fno-strategy-presets"],
    queryFn: fetchStrategyPresets,
    staleTime: 5 * 60_000,
  });

  const payoffQuery = useQuery({
    queryKey: ["fno-payoff", legs],
    queryFn: () => fetchStrategyPayoff(legs),
    enabled: legs.length > 0,
    staleTime: 0,
  });

  const strikes = useMemo(
    () => (chainQuery.data?.strikes ?? []).map((r) => Number(r.strike_price)).filter((v) => Number.isFinite(v)),
    [chainQuery.data?.strikes],
  );

  const addDefaultLeg = () => {
    const strike = strikes[Math.floor(strikes.length / 2)] || Number(chainQuery.data?.atm_strike || 0) || 0;
    const priceRow = (chainQuery.data?.strikes ?? []).find((r) => Number(r.strike_price) === strike);
    const premium = Number(priceRow?.ce?.ltp || 0);
    setLegs((prev) => [
      ...prev,
      { type: "CE", strike, action: "buy", premium, lots: 1, lot_size: 50, expiry: chainQuery.data?.expiry_date || expiry || "" },
    ]);
  };

  useEffect(() => {
    const consumePending = () => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as Array<{ side: "CE" | "PE"; strike: number; ltp: number }>;
        if (!Array.isArray(parsed) || !parsed.length) return;
        setLegs((prev) => [
          ...prev,
          ...parsed.map((item) => ({
            type: item.side,
            strike: Number(item.strike || 0),
            action: "buy" as const,
            premium: Number(item.ltp || 0),
            lots: 1,
            lot_size: 50,
            expiry: chainQuery.data?.expiry_date || expiry || "",
          })),
        ]);
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
    };
    consumePending();
    window.addEventListener("fno:add-leg", consumePending as EventListener);
    return () => window.removeEventListener("fno:add-leg", consumePending as EventListener);
  }, [chainQuery.data?.expiry_date, expiry]);

  const chartData = useMemo(() => {
    const base = payoffQuery.data?.payoff_at_expiry ?? [];
    return base.map((p) => ({
      ...p,
      profit: p.pnl >= 0 ? p.pnl : null,
      loss: p.pnl < 0 ? p.pnl : null,
    }));
  }, [payoffQuery.data?.payoff_at_expiry]);

  const applyPreset = async (name: string) => {
    const out = await fetchStrategyFromPreset({ preset: name, symbol, expiry: expiry || undefined });
    setSelectedPreset(name);
    setLegs(out.legs);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded border border-terminal-border bg-terminal-panel px-3 py-2 text-xs">
        <div className="font-semibold uppercase tracking-wide text-terminal-accent">Strategy Builder</div>
        <div className="flex items-center gap-2">
          <span className="text-terminal-muted">Preset</span>
          <select className="rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={selectedPreset} onChange={(e) => setSelectedPreset(e.target.value)}>
            {Object.keys((presetsQuery.data ?? {})).map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          <button className="rounded border border-terminal-border px-2 py-1 text-terminal-accent" onClick={() => void applyPreset(selectedPreset)}>Apply</button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 rounded border border-terminal-border bg-terminal-panel px-3 py-2 text-xs">
        {Object.keys((presetsQuery.data ?? {})).slice(0, 8).map((name) => (
          <button key={name} className="rounded border border-terminal-border px-2 py-1 text-terminal-muted hover:text-terminal-accent" onClick={() => void applyPreset(name)}>
            {name}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[420px_1fr]">
        <div className="rounded border border-terminal-border bg-terminal-panel p-3">
          <div className="space-y-2">
            {legs.map((leg, idx) => (
              <div key={`leg-${idx}`} className="rounded border border-terminal-border bg-terminal-bg p-2">
                <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-3">
                  <select value={leg.type} onChange={(e) => setLegs((p) => p.map((x, i) => i === idx ? { ...x, type: e.target.value as "CE" | "PE" } : x))} className="rounded border border-terminal-border bg-terminal-panel px-2 py-1">
                    <option value="CE">CE</option>
                    <option value="PE">PE</option>
                  </select>
                  <select value={leg.action} onChange={(e) => setLegs((p) => p.map((x, i) => i === idx ? { ...x, action: e.target.value as "buy" | "sell" } : x))} className="rounded border border-terminal-border bg-terminal-panel px-2 py-1">
                    <option value="buy">Buy</option>
                    <option value="sell">Sell</option>
                  </select>
                  <select value={String(leg.strike)} onChange={(e) => setLegs((p) => p.map((x, i) => i === idx ? { ...x, strike: Number(e.target.value) } : x))} className="rounded border border-terminal-border bg-terminal-panel px-2 py-1">
                    {strikes.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <input type="number" value={leg.premium} onChange={(e) => setLegs((p) => p.map((x, i) => i === idx ? { ...x, premium: Number(e.target.value) } : x))} className="rounded border border-terminal-border bg-terminal-panel px-2 py-1" placeholder="Premium" />
                  <input type="number" value={leg.lots} onChange={(e) => setLegs((p) => p.map((x, i) => i === idx ? { ...x, lots: Number(e.target.value || 1) } : x))} className="rounded border border-terminal-border bg-terminal-panel px-2 py-1" placeholder="Lots" />
                  <button className="rounded border border-terminal-neg px-2 py-1 text-terminal-neg" onClick={() => setLegs((p) => p.filter((_, i) => i !== idx))}>Remove</button>
                </div>
              </div>
            ))}
            <button className="rounded border border-terminal-border px-2 py-1 text-xs" onClick={addDefaultLeg}>+ Add Leg</button>
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded border border-terminal-border bg-terminal-panel p-3">
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#2a2f3a" />
                  <XAxis dataKey="spot" tick={{ fill: "#8e98a8", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#8e98a8", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ border: "1px solid #2a2f3a", background: "#0c0f14", color: "#d8dde7" }} />
                  <ReferenceLine y={0} stroke="#8e98a8" strokeDasharray="4 4" />
                  <Area type="monotone" dataKey="profit" stroke="#00c176" fill="#00c17633" connectNulls />
                  <Area type="monotone" dataKey="loss" stroke="#ff4d4f" fill="#ff4d4f33" connectNulls />
                  <Line type="monotone" dataKey="pnl" stroke="#ff9f1a" dot={false} />
                  {payoffQuery.data?.breakeven_points?.map((b, i) => (
                    <ReferenceLine key={`be-${i}`} x={b} stroke="#ff9f1a" strokeDasharray="2 2" />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs">
            <div>Name: <span className="text-terminal-accent">{payoffQuery.data?.strategy_name || "Custom"}</span></div>
            <div>Net Premium: {formatCurrencyINR(Number(payoffQuery.data?.net_premium || 0))}</div>
            <div>Max Profit: {String(payoffQuery.data?.max_profit ?? "-")}</div>
            <div>Max Loss: {String(payoffQuery.data?.max_loss ?? "-")}</div>
            <div>Risk/Reward: {Number(payoffQuery.data?.risk_reward_ratio || 0).toFixed(2)}</div>
            <div>Breakeven: {(payoffQuery.data?.breakeven_points || []).join(", ") || "-"}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
