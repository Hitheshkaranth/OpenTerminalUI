import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { searchStocks } from "../../api/client";
import { useMarketStatus } from "../../hooks/useStocks";
import { useStockStore } from "../../store/stockStore";

export function TopBar() {
  const setTicker = useStockStore((s) => s.setTicker);
  const load = useStockStore((s) => s.load);
  const ticker = useStockStore((s) => s.ticker);
  const { data: marketStatus } = useMarketStatus();
  const [query, setQuery] = useState(ticker);
  const [results, setResults] = useState<Array<{ ticker: string; name: string }>>([]);
  const statusPayload = (marketStatus as {
    error?: string;
    nifty50?: number | null;
    sensex?: number | null;
    inrUsd?: number | null;
    usdInr?: number | null;
    sp500?: number | null;
    nikkei225?: number | null;
    hangseng?: number | null;
    nifty50Pct?: number | null;
    sensexPct?: number | null;
    usdInrPct?: number | null;
    sp500Pct?: number | null;
    nikkei225Pct?: number | null;
    hangsengPct?: number | null;
    fallbackEnabled?: boolean;
    source?: { nseIndices?: boolean };
  } | undefined);
  const marketError = statusPayload?.error;
  const nifty50 = typeof statusPayload?.nifty50 === "number" ? statusPayload.nifty50 : null;
  const sensex = typeof statusPayload?.sensex === "number" ? statusPayload.sensex : null;
  const inrUsd = typeof statusPayload?.inrUsd === "number" ? statusPayload.inrUsd : null;
  const usdInr = typeof statusPayload?.usdInr === "number" ? statusPayload.usdInr : null;
  const sp500 = typeof statusPayload?.sp500 === "number" ? statusPayload.sp500 : null;
  const nikkei225 = typeof statusPayload?.nikkei225 === "number" ? statusPayload.nikkei225 : null;
  const hangseng = typeof statusPayload?.hangseng === "number" ? statusPayload.hangseng : null;
  const nifty50Pct = typeof statusPayload?.nifty50Pct === "number" ? statusPayload.nifty50Pct : null;
  const sensexPct = typeof statusPayload?.sensexPct === "number" ? statusPayload.sensexPct : null;
  const usdInrPct = typeof statusPayload?.usdInrPct === "number" ? statusPayload.usdInrPct : null;
  const sp500Pct = typeof statusPayload?.sp500Pct === "number" ? statusPayload.sp500Pct : null;
  const nikkei225Pct = typeof statusPayload?.nikkei225Pct === "number" ? statusPayload.nikkei225Pct : null;
  const hangsengPct = typeof statusPayload?.hangsengPct === "number" ? statusPayload.hangsengPct : null;
  const hasIndexData = nifty50 !== null || sensex !== null;
  const isFallback = Boolean(statusPayload?.fallbackEnabled) || !statusPayload?.source?.nseIndices;

  const formatIndex = (value: number | null) =>
    value === null ? "NA" : value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const formatFx = (value: number | null) =>
    value === null ? "NA" : value.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 6 });
  const formatGlobalIndex = (value: number | null) =>
    value === null ? "NA" : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const formatPct = (value: number | null) => {
    if (value === null) return "NA";
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(2)}%`;
  };
  const pctClass = (value: number | null) =>
    value === null ? "text-terminal-muted" : value >= 0 ? "text-terminal-pos" : "text-terminal-neg";
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setQuery(ticker);
  }, [ticker]);

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      return;
    }
    try {
      const res = await searchStocks(q);
      setResults(res);
    } catch {
      setResults([]);
    }
  }, []);

  const handleLoad = useCallback(async () => {
    try {
      await load();
    } catch {
      // Stock store handles errors internally
    }
    setResults([]);
  }, [load]);

  return (
    <div className="relative z-20 border-b border-terminal-border bg-terminal-panel">
      <div className="flex items-center justify-between border-b border-terminal-border px-3 py-1 text-[11px] uppercase text-terminal-muted">
        <div className="flex items-center gap-3">
          <span className="text-terminal-accent">NIFTY 50</span>
          <span>{formatIndex(nifty50)}</span>
          <span className={pctClass(nifty50Pct)}>{formatPct(nifty50Pct)}</span>
          <span className={hasIndexData ? "text-terminal-pos" : "text-terminal-neg"}>
            {hasIndexData ? (isFallback ? "FALLBACK" : "CONNECTED") : "OFFLINE"}
          </span>
          <span className="text-terminal-accent">SENSEX</span>
          <span>{formatIndex(sensex)}</span>
          <span className={pctClass(sensexPct)}>{formatPct(sensexPct)}</span>
          <span className="text-terminal-accent">USD/INR</span>
          <span>{formatFx(usdInr ?? (inrUsd ? 1 / inrUsd : null))}</span>
          <span className={pctClass(usdInrPct)}>{formatPct(usdInrPct)}</span>
          <span className="text-terminal-accent">S&P500</span>
          <span>{formatGlobalIndex(sp500)}</span>
          <span className={pctClass(sp500Pct)}>{formatPct(sp500Pct)}</span>
          <span className="text-terminal-accent">NIKKEI225</span>
          <span>{formatGlobalIndex(nikkei225)}</span>
          <span className={pctClass(nikkei225Pct)}>{formatPct(nikkei225Pct)}</span>
          <span className="text-terminal-accent">HANGSENG</span>
          <span>{formatGlobalIndex(hangseng)}</span>
          <span className={pctClass(hangsengPct)}>{formatPct(hangsengPct)}</span>
          <span className="text-terminal-muted">{isFallback ? "fallback enabled" : "stream ok"}</span>
          {marketError && !hasIndexData && <span className="text-terminal-neg">feed error</span>}
        </div>
        <div>CTRL+K COMMAND | / SEARCH</div>
      </div>
      <div className="relative flex items-center gap-3 px-3 py-2">
        <Link className="rounded border border-terminal-border px-2 py-2 text-xs text-terminal-muted hover:text-terminal-text" to="/stocks">
          HOME
        </Link>
        <Link className="rounded border border-terminal-border px-2 py-2 text-xs text-terminal-muted hover:text-terminal-text" to="/screener">
          SCREENER
        </Link>
        <input
          className="w-full rounded border border-terminal-border bg-terminal-bg px-3 py-2 text-sm outline-none focus:border-terminal-accent"
          placeholder="Search NSE symbol ( / )"
          value={query}
          onChange={(e) => {
            const next = e.target.value.toUpperCase();
            setQuery(next);
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => {
              void doSearch(next);
            }, 300);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setTicker(query);
              void handleLoad();
            }
          }}
        />
        <button
          className="rounded bg-terminal-accent px-3 py-2 text-sm font-medium text-black"
          onClick={() => {
            setTicker(query);
            void handleLoad();
          }}
        >
          Load
        </button>
        {results.length > 0 && (
          <div className="absolute left-3 right-3 top-12 z-10 max-h-72 overflow-auto rounded border border-terminal-border bg-terminal-panel">
            {results.map((item) => (
              <button
                key={item.ticker}
                className="block w-full border-b border-terminal-border px-3 py-2 text-left text-sm hover:bg-terminal-bg"
                onClick={() => {
                  setQuery(item.ticker);
                  setTicker(item.ticker);
                  void handleLoad();
                }}
              >
                {item.ticker} - {item.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
