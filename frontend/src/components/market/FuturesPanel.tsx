import { useEffect, useMemo, useState } from "react";

import { fetchFuturesChain, fetchFuturesUnderlyings, type FuturesChainContract } from "../../api/client";
import { useDisplayCurrency } from "../../hooks/useDisplayCurrency";
import { useQuotesStore, useQuotesStream } from "../../realtime/useQuotesStream";
import { useStockHistory } from "../../hooks/useStocks";
import { ChartEngine } from "../../shared/chart/ChartEngine";
import { chartPointsToBars } from "../../shared/chart/chartUtils";
import { TerminalPanel } from "../terminal/TerminalPanel";

type FuturesRow = FuturesChainContract & {
  ltp: number | null;
  changePct: number | null;
  oi: number | null;
  volume: number | null;
};

function fmtNum(value: number | null, fractionDigits = 2): string {
  if (value === null || !Number.isFinite(value)) return "-";
  return value.toLocaleString("en-IN", { maximumFractionDigits: fractionDigits });
}

export function FuturesPanel() {
  const { formatDisplayMoney } = useDisplayCurrency();
  const { subscribe, unsubscribe, isConnected } = useQuotesStream("NFO");
  const ticksByToken = useQuotesStore((s) => s.ticksByToken);

  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedUnderlying, setSelectedUnderlying] = useState("");
  const [chainContracts, setChainContracts] = useState<FuturesChainContract[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: chart } = useStockHistory(selectedUnderlying, "3mo", "1d");
  // Must be memoized: inline chartPointsToBars() creates a new array reference every
  // render, which feeds an unstable seedBars into useRealtimeChart → setBars loop.
  const historicalData = useMemo(() => (chart?.data ? chartPointsToBars(chart.data) : []), [chart?.data]);

  useEffect(() => {
    const term = query.trim().toUpperCase();
    if (term.length < 2) {
      setSuggestions([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const items = await fetchFuturesUnderlyings(term, 12);
          if (active) setSuggestions(items);
        } catch {
          if (active) setSuggestions([]);
        }
      })();
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    if (!selectedUnderlying) {
      setChainContracts([]);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    setChainContracts([]);
    void (async () => {
      try {
        const payload = await fetchFuturesChain(selectedUnderlying);
        if (!active) return;
        setChainContracts(Array.isArray(payload.contracts) ? payload.contracts : []);
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Failed to load futures chain");
        setChainContracts([]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [selectedUnderlying]);

  const subscriptionSymbols = useMemo(
    () =>
      Array.from(
        new Set(
          chainContracts
            .map((row) => String(row.ws_symbol || `NFO:${row.tradingsymbol || ""}`).toUpperCase())
            .filter((token) => token.startsWith("NFO:") && token.length > 4)
            .map((token) => token.slice(4)),
        ),
      ),
    [chainContracts],
  );

  useEffect(() => {
    if (!subscriptionSymbols.length) return;
    subscribe(subscriptionSymbols);
    return () => unsubscribe(subscriptionSymbols);
  }, [subscribe, subscriptionSymbols, unsubscribe]);

  const rows: FuturesRow[] = useMemo(
    () =>
      chainContracts.map((row) => {
        const wsSymbol = String(row.ws_symbol || `NFO:${row.tradingsymbol || ""}`).toUpperCase();
        const live = ticksByToken[wsSymbol];
        return {
          ...row,
          ltp: live?.ltp ?? (Number.isFinite(Number(row.ltp)) ? Number(row.ltp) : null),
          changePct: live?.change_pct ?? (Number.isFinite(Number(row.change_pct)) ? Number(row.change_pct) : null),
          oi: live?.oi ?? (Number.isFinite(Number(row.oi)) ? Number(row.oi) : null),
          volume: live?.volume ?? (Number.isFinite(Number(row.volume)) ? Number(row.volume) : null),
        };
      }),
    [chainContracts, ticksByToken],
  );

  return (
    <TerminalPanel
      title="Futures Chain"
      subtitle={selectedUnderlying ? `NFO ${selectedUnderlying}` : "Select underlying"}
      actions={
        <span className={`rounded border px-2 py-0.5 text-[10px] ${isConnected ? "border-terminal-pos text-terminal-pos" : "border-terminal-border text-terminal-muted"}`}>
          LIVE
        </span>
      }
    >
      <div className="space-y-2">
        <div className="relative">
          <input
            className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs uppercase outline-none focus:border-terminal-accent"
            placeholder="Search underlying (e.g. REL)"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value.toUpperCase());
              setError(null);
            }}
          />
          {suggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-8 z-10 max-h-52 overflow-auto rounded border border-terminal-border bg-terminal-panel">
              {suggestions.map((item) => (
                <button
                  key={item}
                  className="block w-full border-b border-terminal-border px-2 py-1 text-left text-xs hover:bg-terminal-bg"
                  onClick={() => {
                    setSelectedUnderlying(item);
                    setQuery(item);
                    setSuggestions([]);
                  }}
                >
                  {item}
                </button>
              ))}
            </div>
          )}
        </div>

        {loading && <div className="text-xs text-terminal-muted">Loading chain...</div>}
        {error && <div className="text-xs text-terminal-neg">{error}</div>}

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {selectedUnderlying && historicalData.length > 0 && (
            <div className="h-72 w-full max-h-72 rounded border border-terminal-border">
              <ChartEngine
                symbol={selectedUnderlying}
                timeframe="1D"
                historicalData={historicalData}
                market="NSE"
                activeIndicators={[]}
                chartType="candle"
                showVolume={true}
                enableRealtime={true}
                height={285}
              />
            </div>
          )}
          <div className="max-h-72 overflow-auto w-full border border-terminal-border rounded">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 bg-terminal-panel">
                <tr className="border-b border-terminal-border text-terminal-muted">
                  <th className="px-2 py-1 text-left">Expiry</th>
                  <th className="px-2 py-1 text-right">LTP</th>
                  <th className="px-2 py-1 text-right">Chg%</th>
                  <th className="px-2 py-1 text-right">OI</th>
                  <th className="px-2 py-1 text-right">Vol</th>
                  <th className="px-2 py-1 text-left">Tradingsymbol</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const moveClass =
                    row.changePct === null ? "text-terminal-muted" : row.changePct >= 0 ? "text-terminal-pos" : "text-terminal-neg";
                  return (
                    <tr key={`${row.instrument_token}`} className="border-b border-terminal-border/40">
                      <td className="px-2 py-1">{row.expiry_date || "-"}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{row.ltp !== null ? formatDisplayMoney(row.ltp) : "-"}</td>
                      <td className={`px-2 py-1 text-right tabular-nums ${moveClass}`}>
                        {row.changePct !== null ? `${row.changePct >= 0 ? "+" : ""}${row.changePct.toFixed(2)}%` : "-"}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmtNum(row.oi, 0)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmtNum(row.volume, 0)}</td>
                      <td className="px-2 py-1">{row.tradingsymbol}</td>
                    </tr>
                  );
                })}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td className="px-2 py-2 text-center text-terminal-muted" colSpan={6}>
                      No contracts
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </TerminalPanel>
  );
}
