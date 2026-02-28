import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { fetchQuotesBatch } from "../../api/client";
import { useMarketStatus } from "../../hooks/useStocks";
import { useQuotesStore, useQuotesStream } from "../../realtime/useQuotesStream";
import { useSettingsStore } from "../../store/settingsStore";
import { useStockStore } from "../../store/stockStore";

type TapeItem = {
  key: string;
  symbol: string;
  label: string;
  market: string;
  price: number | null;
  changePct: number | null;
  change: number | null;
};

type FlashDirection = "up" | "down";

const PINNED_KEY = "ot:ticker-tape:pinned:v1";

function readPinned(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed.map((v) => String(v).toUpperCase()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function formatPrice(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "NA";
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatChange(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "NA";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function formatPct(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "NA";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function TickerTape() {
  const navigate = useNavigate();
  const { data: polledStatus } = useMarketStatus();
  const realtimeStatus = useQuotesStore((s) => s.marketStatus);
  const marketStatus = realtimeStatus || polledStatus;

  const selectedMarket = useSettingsStore((s) => s.selectedMarket);
  const selectedTicker = useStockStore((s) => s.ticker);
  const setTicker = useStockStore((s) => s.setTicker);
  const loadTicker = useStockStore((s) => s.load);
  const [pinnedSymbols] = useState<string[]>(() => readPinned());
  const [pinnedQuotes, setPinnedQuotes] = useState<Record<string, { last: number; change: number; changePct: number }>>({});
  const [flashes, setFlashes] = useState<Record<string, FlashDirection>>({});
  const prevPricesRef = useRef<Record<string, number>>({});
  const { subscribe, unsubscribe } = useQuotesStream(selectedMarket);
  const ticksByToken = useQuotesStore((s) => s.ticksByToken);

  useEffect(() => {
    if (!pinnedSymbols.length) return;
    subscribe(pinnedSymbols);
    void (async () => {
      try {
        const batch = await fetchQuotesBatch(pinnedSymbols, selectedMarket);
        setPinnedQuotes(
          Object.fromEntries(
            (batch.quotes || []).map((q) => [
              String(q.symbol || "").toUpperCase(),
              { last: Number(q.last), change: Number(q.change), changePct: Number(q.changePct) },
            ]),
          ),
        );
      } catch {
        // polling snapshot optional
      }
    })();
    return () => unsubscribe(pinnedSymbols);
  }, [pinnedSymbols, selectedMarket, subscribe, unsubscribe]);

  useEffect(() => {
    const nextFlashes: Record<string, FlashDirection> = {};
    for (const symbol of pinnedSymbols) {
      const tick = ticksByToken[`${selectedMarket.toUpperCase()}:${symbol}`];
      if (!tick || !Number.isFinite(Number(tick.ltp))) continue;
      const next = Number(tick.ltp);
      const prev = prevPricesRef.current[symbol];
      if (Number.isFinite(prev) && prev !== next) {
        nextFlashes[symbol] = next > prev ? "up" : "down";
      }
      prevPricesRef.current[symbol] = next;
      setPinnedQuotes((prevQuotes) => ({
        ...prevQuotes,
        [symbol]: {
          last: next,
          change: Number.isFinite(Number(tick.change)) ? Number(tick.change) : prevQuotes[symbol]?.change ?? 0,
          changePct: Number.isFinite(Number(tick.change_pct)) ? Number(tick.change_pct) : prevQuotes[symbol]?.changePct ?? 0,
        },
      }));
    }
    if (Object.keys(nextFlashes).length) {
      setFlashes((prev) => ({ ...prev, ...nextFlashes }));
      const timer = setTimeout(() => {
        setFlashes((prev) => {
          const merged = { ...prev };
          Object.keys(nextFlashes).forEach((key) => delete merged[key]);
          return merged;
        });
      }, 300);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [pinnedSymbols, selectedMarket, ticksByToken]);

  const indexItems = useMemo<TapeItem[]>(() => {
    const payload = (marketStatus ?? {}) as Record<string, unknown>;
    const mapNum = (k: string) => (Number.isFinite(Number(payload[k])) ? Number(payload[k]) : null);
    return [
      { key: "NIFTY50", symbol: "NIFTY", label: "NIFTY 50", market: "NSE", price: mapNum("nifty50"), change: null, changePct: mapNum("nifty50Pct") },
      { key: "SENSEX", symbol: "SENSEX", label: "SENSEX", market: "BSE", price: mapNum("sensex"), change: null, changePct: mapNum("sensexPct") },
      { key: "USDINR", symbol: "USDINR", label: "USD/INR", market: "FX", price: mapNum("usdInr"), change: null, changePct: mapNum("usdInrPct") },
      { key: "SPX", symbol: "SPX", label: "S&P 500", market: "NASDAQ", price: mapNum("sp500"), change: null, changePct: mapNum("sp500Pct") },
      { key: "IXIC", symbol: "IXIC", label: "NASDAQ", market: "NASDAQ", price: mapNum("nasdaq"), change: null, changePct: mapNum("nasdaqPct") },
      { key: "DJI", symbol: "DJI", label: "DOW", market: "NYSE", price: mapNum("dowjones"), change: null, changePct: mapNum("dowjonesPct") },
      { key: "FTSE", symbol: "FTSE", label: "FTSE 100", market: "LSE", price: mapNum("ftse100"), change: null, changePct: mapNum("ftse100Pct") },
      { key: "DAX", symbol: "DAX", label: "DAX", market: "XETRA", price: mapNum("dax"), change: null, changePct: mapNum("daxPct") },
      { key: "NIKKEI", symbol: "N225", label: "Nikkei 225", market: "JPX", price: mapNum("nikkei225"), change: null, changePct: mapNum("nikkei225Pct") },
      // Added from topIndicators
      { key: "GOLD", symbol: "GC=F", label: "GOLD", market: "COMEX", price: mapNum("gold"), change: null, changePct: mapNum("goldPct") },
      { key: "SILVER", symbol: "SI=F", label: "SILVER", market: "COMEX", price: mapNum("silver"), change: null, changePct: mapNum("silverPct") },
      { key: "CRUDE", symbol: "CL=F", label: "CRUDE OIL", market: "NYMEX", price: mapNum("crude"), change: null, changePct: mapNum("crudePct") },
    ];
  }, [marketStatus]);

  const pinnedItems = useMemo<TapeItem[]>(
    () =>
      pinnedSymbols.map((symbol) => ({
        key: `pin:${symbol}`,
        symbol,
        label: symbol,
        market: selectedMarket,
        price: Number.isFinite(Number(pinnedQuotes[symbol]?.last)) ? Number(pinnedQuotes[symbol]?.last) : null,
        change: Number.isFinite(Number(pinnedQuotes[symbol]?.change)) ? Number(pinnedQuotes[symbol]?.change) : null,
        changePct: Number.isFinite(Number(pinnedQuotes[symbol]?.changePct)) ? Number(pinnedQuotes[symbol]?.changePct) : null,
      })),
    [pinnedQuotes, pinnedSymbols, selectedMarket],
  );

  const items = [...indexItems, ...pinnedItems];

  const handleClick = (item: TapeItem) => {
    const loadSymbol =
      item.symbol === "SPX" ? "^GSPC" :
      item.symbol === "DJI" ? "^DJI" :
      item.symbol === "IXIC" ? "^IXIC" :
      item.symbol === "FTSE" ? "^FTSE" :
      item.symbol === "DAX" ? "^GDAXI" :
      item.symbol;
    setTicker(loadSymbol);
    void loadTicker();
    navigate(`/equity/security/${encodeURIComponent(loadSymbol)}?tab=chart`);
  };

  return (
    <div className="relative z-30 h-8 overflow-hidden border-b border-terminal-border bg-terminal-bg text-[12px]">
      <div className="ticker-tape-track h-full hover:[animation-play-state:paused]">
        <div className="ticker-tape-segment">
          {items.map((item) => {
            const pctClass =
              item.changePct == null ? "text-terminal-muted" : item.changePct >= 0 ? "text-terminal-pos" : "text-terminal-neg";
            const flash = flashes[item.symbol];
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => handleClick(item)}
                className={[
                  "inline-flex h-6 items-center gap-2 rounded-sm border border-transparent px-2 ot-type-data text-[12px] hover:border-terminal-border",
                  selectedTicker?.toUpperCase() === item.symbol ? "text-terminal-accent" : "text-terminal-text",
                  flash === "up" ? "bg-emerald-500/10" : flash === "down" ? "bg-rose-500/10" : "",
                ].join(" ")}
                title={`Load ${item.label} in active chart`}
              >
                <span className="text-[#FF6B00]">{item.label}</span>
                <span>{formatPrice(item.price)}</span>
                <span className={item.change != null && item.change >= 0 ? "text-terminal-pos" : item.change != null ? "text-terminal-neg" : "text-terminal-muted"}>
                  {formatChange(item.change)}
                </span>
                <span className={pctClass}>{formatPct(item.changePct)}</span>
              </button>
            );
          })}
        </div>
        <div className="ticker-tape-segment" aria-hidden="true">
          {items.map((item) => {
            const pctClass =
              item.changePct == null ? "text-terminal-muted" : item.changePct >= 0 ? "text-terminal-pos" : "text-terminal-neg";
            return (
              <div
                key={`${item.key}:ghost`}
                className="inline-flex h-6 items-center gap-2 px-2 ot-type-data text-[12px] text-terminal-text"
              >
                <span className="text-[#FF6B00]">{item.label}</span>
                <span>{formatPrice(item.price)}</span>
                <span className={item.change != null && item.change >= 0 ? "text-terminal-pos" : item.change != null ? "text-terminal-neg" : "text-terminal-muted"}>
                  {formatChange(item.change)}
                </span>
                <span className={pctClass}>{formatPct(item.changePct)}</span>
              </div>
            );
          })}
        </div>
      </div>
      <style>{`
        .ticker-tape-track {
          display: flex;
          width: max-content;
          align-items: center;
          animation: ot-ticker-tape 70s linear infinite;
          will-change: transform;
        }
        .ticker-tape-segment {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          white-space: nowrap;
          padding-right: 6px;
        }
        @keyframes ot-ticker-tape {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .ticker-tape-track { animation: none; }
        }
      `}</style>
    </div>
  );
}
