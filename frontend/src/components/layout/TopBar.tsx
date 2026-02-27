import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { fetchCryptoSearch, searchSymbols, type SearchSymbolItem } from "../../api/client";
import { CountryFlag } from "../common/CountryFlag";
import { useMarketStatus, useTopBarTickers } from "../../hooks/useStocks";
import { useSettingsStore } from "../../store/settingsStore";
import { useStockStore } from "../../store/stockStore";
import { COUNTRY_MARKETS } from "../../types";
import type { CountryCode, MarketCode } from "../../types";

type DisplayCurrency = "INR" | "USD";

const COUNTRY_FLAGS: Record<CountryCode, string> = {
  IN: "🇮🇳",
  US: "🇺🇸",
};

const COUNTRY_DEFAULT_MARKET: Record<CountryCode, MarketCode> = {
  IN: "NSE",
  US: "NASDAQ",
};

type TopBarProps = {
  hideTickerLoader?: boolean;
  hideMarketMarquee?: boolean;
};

export function TopBar({ hideTickerLoader = false, hideMarketMarquee = false }: TopBarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const setTicker = useStockStore((s) => s.setTicker);
  const load = useStockStore((s) => s.load);
  const ticker = useStockStore((s) => s.ticker);
  const selectedCountry = useSettingsStore((s) => s.selectedCountry);
  const selectedMarket = useSettingsStore((s) => s.selectedMarket);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const setSelectedCountry = useSettingsStore((s) => s.setSelectedCountry);
  const setSelectedMarket = useSettingsStore((s) => s.setSelectedMarket);
  const setDisplayCurrency = useSettingsStore((s) => s.setDisplayCurrency);
  const { data: marketStatus } = useMarketStatus();
  const { data: topBarTickers } = useTopBarTickers();
  const [query, setQuery] = useState(ticker);
  const [results, setResults] = useState<SearchSymbolItem[]>([]);
  const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchRequestRef = useRef(0);
  const suppressSuggestionsRef = useRef(false);
  const marketsForCountry = COUNTRY_MARKETS[selectedCountry];
  const statusPayload = (marketStatus as {
    error?: string;
    marketState?: Array<{ marketStatus?: string; tradeDate?: string }>;
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
  const hasGlobalData = sp500 !== null || nikkei225 !== null || hangseng !== null;
  const hasFxData = usdInr !== null || inrUsd !== null;
  const isFallback = Boolean(statusPayload?.fallbackEnabled) || !statusPayload?.source?.nseIndices;
  const marketStateLabel = String(statusPayload?.marketState?.[0]?.marketStatus || "").toUpperCase();
  const feedStateLabel = !hasIndexData
    ? "OFFLINE"
    : marketStateLabel === "CLOSE"
    ? "CLOSED"
    : isFallback
    ? "FALLBACK"
    : "LIVE";
  const backendHealthLabel = hasGlobalData && hasFxData ? "stream ok" : "partial feed";

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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const editing =
        tag === "input" || tag === "textarea" || tag === "select" || Boolean(target?.isContentEditable);

      if (event.key === "/" && !editing) {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if ((event.key === "m" || event.key === "M") && !editing) {
        event.preventDefault();
        navigate("/equity/portfolio");
        return;
      }
      if (event.key === "Escape") {
        if (results.length > 0) {
          setResults([]);
          setIsSuggestionsOpen(false);
          return;
        }
        if (editing && tag === "input") {
          const inputEl = target as HTMLInputElement;
          inputEl.blur();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, results.length]);

  useEffect(() => {
    if (!marketsForCountry.includes(selectedMarket)) {
      setSelectedMarket(COUNTRY_DEFAULT_MARKET[selectedCountry]);
    }
  }, [marketsForCountry, selectedCountry, selectedMarket, setSelectedMarket]);

  const doSearch = useCallback(async (q: string) => {
    if (suppressSuggestionsRef.current) {
      setResults([]);
      setIsSuggestionsOpen(false);
      return;
    }
    if (q.length < 2) {
      setResults([]);
      setIsSuggestionsOpen(false);
      return;
    }
    const requestId = ++searchRequestRef.current;
    try {
      const [equityRes, cryptoRes] = await Promise.all([searchSymbols(q, selectedMarket), fetchCryptoSearch(q)]);
      const merged = [...equityRes, ...cryptoRes];
      const seen = new Set<string>();
      const res = merged.filter((item) => {
        const key = `${(item.ticker || "").toUpperCase()}::${(item.name || "").toUpperCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (requestId !== searchRequestRef.current || suppressSuggestionsRef.current) {
        return;
      }
      setResults(res);
      setIsSuggestionsOpen(res.length > 0);
    } catch {
      if (requestId === searchRequestRef.current) {
        setResults([]);
        setIsSuggestionsOpen(false);
      }
    }
  }, [selectedMarket]);

  const handleLoad = useCallback(async () => {
    setResults([]);
    setIsSuggestionsOpen(false);
    try {
      await load();
    } catch {
      // Stock store handles errors internally
    }
  }, [load]);

  const selectTicker = useCallback((value: string) => {
    const symbol = value.trim().toUpperCase();
    if (!symbol) return;
    suppressSuggestionsRef.current = true;
    searchRequestRef.current += 1;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setResults([]);
    setIsSuggestionsOpen(false);
    setQuery(symbol);
    setTicker(symbol);
    void handleLoad();
  }, [handleLoad, setTicker]);
  const safeTicker = (ticker || "NIFTY").toUpperCase();
  const topIndicators = topBarTickers?.items ?? [];
  const chartProxyTickerByKey: Record<string, string> = {
    crude: "ONGC",
    gold: "GOLDBEES",
    silver: "SILVERBEES",
  };

  const marketTickerItems = (
    <>
      {nifty50 !== null ? (
        <>
          <span className="text-terminal-accent">NIFTY 50</span>
          <span>{formatIndex(nifty50)}</span>
          <span className={pctClass(nifty50Pct)}>{formatPct(nifty50Pct)}</span>
        </>
      ) : null}
      {sensex !== null ? (
        <>
          <span className="text-terminal-accent">SENSEX</span>
          <span>{formatIndex(sensex)}</span>
          <span className={pctClass(sensexPct)}>{formatPct(sensexPct)}</span>
        </>
      ) : null}
      {(usdInr !== null || inrUsd !== null) ? (
        <>
          <span className="text-terminal-accent">USD/INR</span>
          <span>{formatFx(usdInr ?? (inrUsd ? 1 / inrUsd : null))}</span>
          <span className={pctClass(usdInrPct)}>{formatPct(usdInrPct)}</span>
        </>
      ) : null}
      {sp500 !== null ? (
        <>
          <span className="text-terminal-accent">S&P500</span>
          <span>{formatGlobalIndex(sp500)}</span>
          <span className={pctClass(sp500Pct)}>{formatPct(sp500Pct)}</span>
        </>
      ) : null}
      {nikkei225 !== null ? (
        <>
          <span className="text-terminal-accent">NIKKEI225</span>
          <span>{formatGlobalIndex(nikkei225)}</span>
          <span className={pctClass(nikkei225Pct)}>{formatPct(nikkei225Pct)}</span>
        </>
      ) : null}
      {hangseng !== null ? (
        <>
          <span className="text-terminal-accent">HANGSENG</span>
          <span>{formatGlobalIndex(hangseng)}</span>
          <span className={pctClass(hangsengPct)}>{formatPct(hangsengPct)}</span>
        </>
      ) : null}
      {topIndicators
        .filter((item) => Number.isFinite(Number(item.price)))
        .map((item) => (
          <button
            key={item.key}
            className="inline-flex items-center gap-1 rounded border border-terminal-border px-1.5 py-0.5 text-[10px] uppercase hover:border-terminal-accent hover:text-terminal-accent"
            onClick={() => {
              const proxy = chartProxyTickerByKey[item.key] || safeTicker;
              setTicker(proxy);
              void load();
              navigate("/equity/stocks");
            }}
            title={`Open chart pane (${(chartProxyTickerByKey[item.key] || safeTicker).toUpperCase()})`}
          >
            <span className="text-terminal-accent">{item.label}</span>
            <span>{Number(item.price).toFixed(2)}</span>
            <span className={pctClass(item.change_pct ?? null)}>{formatPct(item.change_pct ?? null)}</span>
          </button>
        ))}
      <span className={hasIndexData ? "text-terminal-pos" : "text-terminal-neg"}>{feedStateLabel}</span>
      <span className="text-terminal-muted">{isFallback ? "fallback enabled" : backendHealthLabel}</span>
      {marketError && !hasIndexData ? <span className="text-terminal-neg">feed error</span> : null}
    </>
  );

  return (
    <div className="relative z-20 border-b border-terminal-border bg-terminal-panel">
      {!hideMarketMarquee ? (
        <div className="flex items-center justify-between border-b border-terminal-border px-3 py-1 text-[11px] uppercase text-terminal-muted">
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="topbar-marquee-track">
              <div className="topbar-marquee-segment">{marketTickerItems}</div>
              <div className="topbar-marquee-segment" aria-hidden="true">{marketTickerItems}</div>
            </div>
          </div>
          <div className="ml-3 shrink-0">CTRL+G GO BAR | / SEARCH</div>
        </div>
      ) : null}
      <style>{`
        .topbar-marquee-track {
          display: flex;
          width: max-content;
          animation: topbar-marquee 70s linear infinite;
          will-change: transform;
        }
        .topbar-marquee-segment {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          white-space: nowrap;
          padding-right: 0.75rem;
        }
        @keyframes topbar-marquee {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .topbar-marquee-track {
            animation: none;
          }
        }
      `}</style>
      <div className="relative flex items-center gap-2 px-3 py-1.5">
        <Link className="rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-muted hover:text-terminal-text" to="/">
          HOME
        </Link>
        <Link className="rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-muted hover:text-terminal-text" to="/equity/screener">
          SCREENER
        </Link>
        <Link className="rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-muted hover:text-terminal-text" to="/equity/compare">
          COMPARE
        </Link>
        <Link className="rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-muted hover:text-terminal-text" to={`/fno/heatmap?symbol=${encodeURIComponent(safeTicker)}`}>
          HEATMAP
        </Link>
        <Link className="rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-muted hover:text-terminal-text" to={`/fno?symbol=${encodeURIComponent(safeTicker)}`}>
          F&O -&gt;
        </Link>
        {!hideTickerLoader ? (
          <>
            <input
              ref={searchInputRef}
              className="min-w-0 flex-1 rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs outline-none focus:border-terminal-accent"
              placeholder={`Search ${selectedMarket} symbol ( / )`}
              value={query}
              onChange={(e) => {
                const next = e.target.value.toUpperCase();
                suppressSuggestionsRef.current = false;
                setQuery(next);
                setIsSuggestionsOpen(next.length >= 2);
                if (debounceRef.current) clearTimeout(debounceRef.current);
                debounceRef.current = setTimeout(() => {
                  void doSearch(next);
                }, 300);
              }}
              onFocus={() => {
                if (results.length > 0 && query.length >= 2) {
                  setIsSuggestionsOpen(true);
                }
              }}
              onBlur={() => {
                setTimeout(() => setIsSuggestionsOpen(false), 120);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  selectTicker(query);
                }
                if (e.key === "Escape") {
                  setResults([]);
                  setIsSuggestionsOpen(false);
                }
              }}
            />
            <button
              className="rounded bg-terminal-accent px-2 py-1 text-xs font-medium text-black"
              onClick={() => {
                selectTicker(query);
              }}
            >
              Load
            </button>
          </>
        ) : (
          <div className="min-w-0 flex-1 rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs text-terminal-muted">
            Account details mode: ticker loader hidden
          </div>
        )}
        <div className="flex items-center gap-1 border-l border-terminal-border pl-2">
          <select
            className="w-[88px] rounded border border-terminal-border bg-terminal-bg px-1 py-1 text-[11px] uppercase text-terminal-text outline-none"
            value={selectedCountry}
            onChange={(e) => setSelectedCountry(e.target.value as CountryCode)}
          >
            <option value="IN">{COUNTRY_FLAGS.IN} IN</option>
            <option value="US">{COUNTRY_FLAGS.US} US</option>
          </select>
          <select
            className="w-[86px] rounded border border-terminal-border bg-terminal-bg px-1 py-1 text-[11px] uppercase text-terminal-text outline-none"
            value={selectedMarket}
            onChange={(e) => setSelectedMarket(e.target.value as MarketCode)}
          >
            {marketsForCountry.map((market) => (
              <option key={market} value={market}>
                {market}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1 border-l border-terminal-border pl-2">
          <span className="text-[11px] leading-none text-terminal-muted" title="Display currency">
            Currency
          </span>
          <select
            className="w-[72px] rounded border border-terminal-border bg-terminal-bg px-1 py-1 text-[11px] uppercase text-terminal-text outline-none"
            value={displayCurrency}
            onChange={(e) => setDisplayCurrency(e.target.value as DisplayCurrency)}
            title="Display currency"
            aria-label="Display currency"
          >
            <option value="INR">INR</option>
            <option value="USD">USD</option>
          </select>
        </div>
        <div className="inline-flex items-center gap-1 border-l border-terminal-border pl-2 text-[11px] uppercase tracking-wide text-terminal-muted">
          <CountryFlag countryCode={selectedCountry} size="sm" />
          <span>{selectedMarket}</span>
          <span>|</span>
          <span>{displayCurrency}</span>
        </div>
        {!hideTickerLoader && isSuggestionsOpen && results.length > 0 && (
          <div className="absolute left-3 right-3 top-10 z-10 max-h-72 overflow-auto rounded border border-terminal-border bg-terminal-panel">
            {results.map((item) => (
              <button
                key={`${item.ticker}:${item.name}`}
                className="block w-full border-b border-terminal-border px-3 py-2 text-left text-sm hover:bg-terminal-bg"
                onMouseDown={(event) => {
                  event.preventDefault();
                  selectTicker(item.ticker);
                }}
                onClick={() => {
                  selectTicker(item.ticker);
                }}
              >
                <span className="inline-flex items-center gap-2">
                  <CountryFlag countryCode={item.country_code} flagEmoji={item.flag_emoji} size="sm" />
                  <span>{item.ticker}</span>
                  <span className="text-terminal-muted">- {item.name}</span>
                  {item.exchange ? <span className="text-terminal-muted">({item.exchange})</span> : null}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
