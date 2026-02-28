import { useMemo, useState } from "react";

import type { StrikeData } from "../types/fno";
import { formatIndianCompact } from "../types/fno";
import { useDisplayCurrency } from "../../hooks/useDisplayCurrency";

type SortKey = "strike" | "ce_oi" | "ce_oi_change" | "pe_oi" | "pe_oi_change";

type Props = {
  rows: StrikeData[];
  atmStrike: number;
};

function val(row: StrikeData, key: SortKey): number {
  if (key === "strike") return Number(row.strike_price || 0);
  if (key === "ce_oi") return Number(row.ce?.oi || 0);
  if (key === "ce_oi_change") return Number(row.ce?.oi_change || 0);
  if (key === "pe_oi") return Number(row.pe?.oi || 0);
  return Number(row.pe?.oi_change || 0);
}

export function OptionChainTable({ rows, atmStrike }: Props) {
  const { formatDisplayMoney } = useDisplayCurrency();
  const [sortKey, setSortKey] = useState<SortKey>("strike");
  const [asc, setAsc] = useState(true);
  const [showGreeks, setShowGreeks] = useState(false);
  const [selectedLeg, setSelectedLeg] = useState<{ side: "CE" | "PE"; strike: number; ltp: number } | null>(null);

  const getDeltaColor = (delta: number) => {
    const d = Math.abs(delta);
    if (d > 0.8) return "text-emerald-400 font-bold";
    if (d > 0.5) return "text-emerald-500";
    if (d > 0.2) return "text-emerald-600";
    return "text-terminal-muted";
  };

  const getThetaColor = (theta: number) => {
    const t = Math.abs(theta);
    if (t > 1.0) return "text-rose-400 font-bold";
    if (t > 0.5) return "text-rose-500";
    return "text-terminal-muted";
  };

  const persistLeg = (leg: { side: "CE" | "PE"; strike: number; ltp: number }) => {
    try {
      const key = "fno_strategy_pending_legs";
      const raw = localStorage.getItem(key);
      const current = raw ? (JSON.parse(raw) as Array<{ side: "CE" | "PE"; strike: number; ltp: number }>) : [];
      current.push(leg);
      localStorage.setItem(key, JSON.stringify(current));
      window.dispatchEvent(new Event("fno:add-leg"));
    } catch {
      // ignore local storage failure
    }
  };

  const sorted = useMemo(() => {
    const out = [...rows];
    out.sort((a, b) => (asc ? val(a, sortKey) - val(b, sortKey) : val(b, sortKey) - val(a, sortKey)));
    return out;
  }, [rows, sortKey, asc]);

  const onSort = (key: SortKey) => {
    if (key === sortKey) {
      setAsc((v) => !v);
      return;
    }
    setSortKey(key);
    setAsc(true);
  };

  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-0">
      <div className="flex items-center justify-between border-b border-terminal-border px-3 py-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-terminal-muted">Option Chain</div>
        <button
          onClick={() => setShowGreeks(!showGreeks)}
          className={`rounded border px-2 py-0.5 text-[10px] uppercase transition-colors ${showGreeks ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted hover:text-terminal-text"}`}
        >
          {showGreeks ? "Hide Greeks" : "Show Greeks"}
        </button>
      </div>
      <div className="max-h-[520px] overflow-auto">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 z-10 bg-terminal-panel">
            <tr className="border-b border-terminal-border text-[10px] uppercase tracking-wide text-terminal-muted">
              {showGreeks && (
                <>
                  <th className="px-2 py-2 text-right">Theta</th>
                  <th className="px-2 py-2 text-right">Delta</th>
                </>
              )}
              <th className="px-2 py-2 text-right">OI</th>
              <th className="px-2 py-2 text-right cursor-pointer" onClick={() => onSort("ce_oi_change")}>?OI</th>
              <th className="px-2 py-2 text-right">Vol</th>
              <th className="px-2 py-2 text-right">IV</th>
              <th className="px-2 py-2 text-right">LTP</th>
              <th className="px-2 py-2 text-center cursor-pointer" onClick={() => onSort("strike")}>Strike</th>
              <th className="px-2 py-2 text-left">LTP</th>
              <th className="px-2 py-2 text-left">IV</th>
              <th className="px-2 py-2 text-left">Vol</th>
              <th className="px-2 py-2 text-left cursor-pointer" onClick={() => onSort("pe_oi_change")}>?OI</th>
              <th className="px-2 py-2 text-left">OI</th>
              {showGreeks && (
                <>
                  <th className="px-2 py-2 text-left">Delta</th>
                  <th className="px-2 py-2 text-left">Theta</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const isAtm = Math.abs(Number(row.strike_price) - atmStrike) < 1e-9;
              const ceDoi = Number(row.ce?.oi_change || 0);
              const peDoi = Number(row.pe?.oi_change || 0);
              return (
                <tr key={String(row.strike_price)} className={`border-b border-terminal-border/30 ${isAtm ? "bg-terminal-accent/10" : "hover:bg-terminal-bg/60"}`}>
                  {showGreeks && (
                    <>
                      <td className={`px-2 py-1 text-right tabular-nums ${getThetaColor(row.ce?.greeks?.theta || 0)}`}>
                        {(row.ce?.greeks?.theta || 0).toFixed(3)}
                      </td>
                      <td className={`px-2 py-1 text-right tabular-nums ${getDeltaColor(row.ce?.greeks?.delta || 0)}`}>
                        {(row.ce?.greeks?.delta || 0).toFixed(2)}
                      </td>
                    </>
                  )}
                  <td className="px-2 py-1 text-right tabular-nums">{formatIndianCompact(Number(row.ce?.oi || 0))}</td>
                  <td className={`px-2 py-1 text-right tabular-nums ${ceDoi >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>{ceDoi >= 0 ? "+" : ""}{formatIndianCompact(ceDoi)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{formatIndianCompact(Number(row.ce?.volume || 0))}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{Number(row.ce?.iv || 0).toFixed(2)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    <button
                      className="text-terminal-accent hover:underline"
                      onClick={() => setSelectedLeg({ side: "CE", strike: Number(row.strike_price), ltp: Number(row.ce?.ltp || 0) })}
                    >
                      {formatDisplayMoney(Number(row.ce?.ltp || 0))}
                    </button>
                  </td>
                  <td className="px-2 py-1 text-center font-semibold tabular-nums">{Number(row.strike_price).toFixed(0)}{isAtm ? " ?" : ""}</td>
                  <td className="px-2 py-1 text-left tabular-nums">
                    <button
                      className="text-terminal-accent hover:underline"
                      onClick={() => setSelectedLeg({ side: "PE", strike: Number(row.strike_price), ltp: Number(row.pe?.ltp || 0) })}
                    >
                      {formatDisplayMoney(Number(row.pe?.ltp || 0))}
                    </button>
                  </td>
                  <td className="px-2 py-1 text-left tabular-nums">{Number(row.pe?.iv || 0).toFixed(2)}</td>
                  <td className="px-2 py-1 text-left tabular-nums">{formatIndianCompact(Number(row.pe?.volume || 0))}</td>
                  <td className={`px-2 py-1 text-left tabular-nums ${peDoi >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>{peDoi >= 0 ? "+" : ""}{formatIndianCompact(peDoi)}</td>
                  <td className="px-2 py-1 text-left tabular-nums">{formatIndianCompact(Number(row.pe?.oi || 0))}</td>
                  {showGreeks && (
                    <>
                      <td className={`px-2 py-1 text-left tabular-nums ${getDeltaColor(row.pe?.greeks?.delta || 0)}`}>
                        {(row.pe?.greeks?.delta || 0).toFixed(2)}
                      </td>
                      <td className={`px-2 py-1 text-left tabular-nums ${getThetaColor(row.pe?.greeks?.theta || 0)}`}>
                        {(row.pe?.greeks?.theta || 0).toFixed(3)}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={11} className="px-2 py-3 text-center text-terminal-muted">No strikes found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedLeg && (
        <div className="border-t border-terminal-border bg-terminal-bg px-3 py-2 text-xs">
          Add to Strategy: <span className="text-terminal-accent">{selectedLeg.side} {selectedLeg.strike}</span> @ {formatDisplayMoney(selectedLeg.ltp)}
          <button
            className="ml-3 rounded border border-terminal-accent px-2 py-0.5 text-[11px] text-terminal-accent"
            onClick={() => persistLeg(selectedLeg)}
          >
            Add
          </button>
          <button className="ml-3 rounded border border-terminal-border px-2 py-0.5 text-[11px]" onClick={() => setSelectedLeg(null)}>Close</button>
        </div>
      )}
    </div>
  );
}
