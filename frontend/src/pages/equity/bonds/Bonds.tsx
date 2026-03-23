import { useEffect, useState } from "react";
import axios from "axios";
import { TerminalPanel } from "../../../components/terminal/TerminalPanel";

const BASE = import.meta.env.VITE_API_BASE_URL || "/api";

interface Bond {
  isin: string;
  issuer: string;
  coupon: number;
  maturity_date: string;
  rating: string;
  yield: number;
  price: number;
  type: string;
}

interface CreditSpreadPoint {
  date: string;
  ig_yield: number;
  hy_yield: number;
  spread: number;
}

interface RatingMigration {
  issuer: string;
  old_rating: string;
  new_rating: string;
  date: string;
  action: string;
}

export function BondsPage() {
  const [section, setSection] = useState("screener");
  const [bonds, setBonds] = useState<Bond[]>([]);
  const [creditSpreads, setCreditSpreads] = useState<CreditSpreadPoint[]>([]);
  const [migrations, setMigrations] = useState<RatingMigration[]>([]);
  const [ratingFilter, setRatingFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  useEffect(() => {
    const params = new URLSearchParams();
    if (ratingFilter) params.set("rating", ratingFilter);
    if (typeFilter) params.set("issuer_type", typeFilter);
    axios
      .get<Bond[]>(`${BASE}/bonds/screener?${params.toString()}`)
      .then((r) => setBonds(r.data))
      .catch(() => {});
  }, [ratingFilter, typeFilter]);

  useEffect(() => {
    axios
      .get<{ history: CreditSpreadPoint[] }>(`${BASE}/bonds/credit-spreads`)
      .then((r) => setCreditSpreads(r.data.history ?? []))
      .catch(() => {});
    axios
      .get<RatingMigration[]>(`${BASE}/bonds/ratings-migration`)
      .then((r) => setMigrations(r.data))
      .catch(() => {});
  }, []);

  const tabs = ["screener", "credit-spreads", "migrations"] as const;

  const latestSpread = creditSpreads.length > 0 ? creditSpreads[creditSpreads.length - 1] : null;
  const spreadRange = creditSpreads.length > 10 ? creditSpreads.slice(-30) : creditSpreads;
  const maxSpread = Math.max(...spreadRange.map((s) => s.spread), 0);
  const minSpread = Math.min(...spreadRange.map((s) => s.spread), Infinity);

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold uppercase tracking-tight text-terminal-accent">Bonds & Fixed Income</h1>
        <div className="flex gap-1">
          {tabs.map((s) => (
            <button
              key={s}
              onClick={() => setSection(s)}
              className={`rounded border px-3 py-1 text-xs uppercase ${
                section === s ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"
              }`}
            >
              {s.replace("-", " ")}
            </button>
          ))}
        </div>
      </div>

      {section === "screener" && (
        <div className="space-y-4">
          <div className="flex gap-4">
            <div className="flex items-center gap-2">
              <label className="text-[10px] uppercase text-terminal-muted">Rating</label>
              <select
                value={ratingFilter}
                onChange={(e) => setRatingFilter(e.target.value)}
                className="h-7 rounded border border-terminal-border bg-terminal-bg px-2 text-xs text-terminal-text"
              >
                <option value="">All</option>
                <option value="AAA">AAA</option>
                <option value="AA+">AA+</option>
                <option value="AA">AA</option>
                <option value="SOV">SOV</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[10px] uppercase text-terminal-muted">Type</label>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="h-7 rounded border border-terminal-border bg-terminal-bg px-2 text-xs text-terminal-text"
              >
                <option value="">All</option>
                <option value="Corporate">Corporate</option>
                <option value="G-Sec">G-Sec</option>
                <option value="Banking">Banking</option>
                <option value="PSU">PSU</option>
              </select>
            </div>
          </div>
          <TerminalPanel title={`Bond Screener (${bonds.length} results)`}>
            <div className="overflow-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-terminal-border text-left text-[10px] uppercase text-terminal-muted">
                    <th className="px-2 py-1">ISIN</th>
                    <th className="px-2 py-1">Issuer</th>
                    <th className="px-2 py-1 text-right">Coupon</th>
                    <th className="px-2 py-1">Maturity</th>
                    <th className="px-2 py-1">Rating</th>
                    <th className="px-2 py-1 text-right">Yield</th>
                    <th className="px-2 py-1 text-right">Price</th>
                    <th className="px-2 py-1">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {bonds.map((b) => (
                    <tr key={b.isin} className="border-b border-terminal-border/30 hover:bg-terminal-accent/5">
                      <td className="px-2 py-1 font-mono text-terminal-muted">{b.isin}</td>
                      <td className="px-2 py-1 text-terminal-text">{b.issuer}</td>
                      <td className="px-2 py-1 text-right text-terminal-accent">{b.coupon.toFixed(2)}%</td>
                      <td className="px-2 py-1 text-terminal-muted">{b.maturity_date}</td>
                      <td className="px-2 py-1">
                        <span className={`rounded px-1 py-0.5 text-[9px] font-bold ${b.rating === "AAA" || b.rating === "SOV" ? "bg-green-900/30 text-green-400" : "bg-yellow-900/30 text-yellow-400"}`}>
                          {b.rating}
                        </span>
                      </td>
                      <td className="px-2 py-1 text-right text-terminal-text">{b.yield.toFixed(2)}%</td>
                      <td className="px-2 py-1 text-right text-terminal-text">{b.price.toFixed(2)}</td>
                      <td className="px-2 py-1 text-terminal-muted">{b.type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TerminalPanel>
        </div>
      )}

      {section === "credit-spreads" && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <TerminalPanel title="Spread Summary" className="xl:col-span-1">
            <div className="space-y-3 p-3 text-xs">
              {latestSpread ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-terminal-muted">IG Yield</span>
                    <span className="text-terminal-accent">{latestSpread.ig_yield.toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-terminal-muted">HY Yield</span>
                    <span className="text-red-400">{latestSpread.hy_yield.toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between border-t border-terminal-border pt-2">
                    <span className="text-terminal-muted">Spread</span>
                    <span className="font-bold text-terminal-text">{latestSpread.spread.toFixed(2)} bps</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-terminal-muted">30D Range</span>
                    <span className="text-terminal-muted">
                      {minSpread.toFixed(2)} - {maxSpread.toFixed(2)}
                    </span>
                  </div>
                </>
              ) : (
                <span className="text-terminal-muted">Loading...</span>
              )}
            </div>
          </TerminalPanel>
          <TerminalPanel title="IG vs HY Credit Spread Timeline (90D)" className="xl:col-span-2">
            <div className="flex h-56 flex-col gap-1 overflow-x-auto p-2">
              <div className="flex h-full items-end gap-[2px]">
                {spreadRange.map((pt, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-t bg-terminal-accent/60"
                    style={{ height: `${((pt.spread - minSpread) / (maxSpread - minSpread + 0.01)) * 100}%`, minHeight: 2 }}
                    title={`${pt.date}: ${pt.spread.toFixed(2)} bps`}
                  />
                ))}
              </div>
              <div className="flex justify-between text-[8px] text-terminal-muted">
                <span>{spreadRange[0]?.date}</span>
                <span>{spreadRange[spreadRange.length - 1]?.date}</span>
              </div>
            </div>
          </TerminalPanel>
        </div>
      )}

      {section === "migrations" && (
        <TerminalPanel title="Rating Migration Tracker">
          <div className="overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-terminal-border text-left text-[10px] uppercase text-terminal-muted">
                  <th className="px-2 py-1">Issuer</th>
                  <th className="px-2 py-1">From</th>
                  <th className="px-2 py-1">To</th>
                  <th className="px-2 py-1">Action</th>
                  <th className="px-2 py-1">Date</th>
                </tr>
              </thead>
              <tbody>
                {migrations.map((m, i) => (
                  <tr key={i} className="border-b border-terminal-border/30 hover:bg-terminal-accent/5">
                    <td className="px-2 py-1 text-terminal-text">{m.issuer}</td>
                    <td className="px-2 py-1 text-terminal-muted">{m.old_rating}</td>
                    <td className="px-2 py-1 text-terminal-text">{m.new_rating}</td>
                    <td className="px-2 py-1">
                      <span className={m.action === "Upgrade" ? "text-green-400" : "text-red-400"}>
                        {m.action === "Upgrade" ? "\u2191" : "\u2193"} {m.action}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-terminal-muted">{m.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TerminalPanel>
      )}
    </div>
  );
}
