import { useEffect, useState } from "react";

import { DOMLadder } from "../components/market/DOMLadder";
import { TimeAndSales } from "../components/market/TimeAndSales";
import { useSettingsStore } from "../store/settingsStore";
import { useStockStore } from "../store/stockStore";
import type { DepthSnapshotResponse } from "../api/client";

function formatPrice(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "--";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatSpread(spread: number, lastPrice: number): string {
  if (!Number.isFinite(spread) || !Number.isFinite(lastPrice) || lastPrice <= 0) return "--";
  return `${spread.toFixed(2)} / ${((spread / lastPrice) * 10_000).toFixed(1)} bps`;
}

export function DOMPage() {
  const selectedMarket = useSettingsStore((state) => state.selectedMarket);
  const ticker = useStockStore((state) => state.ticker);
  const stock = useStockStore((state) => state.stock);
  const setTicker = useStockStore((state) => state.setTicker);
  const loadTicker = useStockStore((state) => state.load);
  const [inputValue, setInputValue] = useState((ticker || "RELIANCE").toUpperCase());
  const [depthSnapshot, setDepthSnapshot] = useState<DepthSnapshotResponse | null>(null);

  useEffect(() => {
    setInputValue((ticker || "RELIANCE").toUpperCase());
  }, [ticker]);

  useEffect(() => {
    void loadTicker();
  }, [loadTicker, selectedMarket, ticker]);

  const activeTicker = (ticker || "RELIANCE").toUpperCase();
  const lastPrice = Number(stock?.current_price ?? depthSnapshot?.last_price ?? 0);
  const changePct = Number(stock?.change_pct ?? 0);
  const previousClose = changePct !== -100 && lastPrice > 0 ? lastPrice / (1 + changePct / 100) : 0;
  const change = lastPrice - previousClose;
  const positive = change >= 0;

  return (
    <div className="h-full min-h-0 overflow-auto p-2">
      <div className="grid gap-2">
        <div className="rounded-sm border border-terminal-border bg-terminal-panel px-3 py-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.22em] text-terminal-muted">Depth Of Market</div>
                <div className="mt-1 text-2xl font-semibold text-terminal-text">{activeTicker}</div>
              </div>
              <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-terminal-muted">
                <span>Symbol</span>
                <div className="flex items-center gap-2">
                  <input
                    value={inputValue}
                    onChange={(event) => setInputValue(event.target.value.toUpperCase())}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        setTicker(inputValue);
                      }
                    }}
                    className="w-36 rounded-sm border border-terminal-border bg-terminal-bg px-2 py-1 font-mono text-terminal-text outline-none focus:border-terminal-accent"
                  />
                  <button
                    type="button"
                    onClick={() => setTicker(inputValue)}
                    className="rounded-sm border border-terminal-accent bg-terminal-accent/10 px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-terminal-accent"
                  >
                    Load
                  </button>
                </div>
              </label>
            </div>
            <div className="grid gap-2 text-right sm:grid-cols-3">
              <div className="rounded-sm border border-terminal-border bg-terminal-bg px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.18em] text-terminal-muted">Last</div>
                <div className="mt-1 font-mono text-xl text-terminal-text">{formatPrice(lastPrice)}</div>
              </div>
              <div className="rounded-sm border border-terminal-border bg-terminal-bg px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.18em] text-terminal-muted">Change</div>
                <div className={`mt-1 font-mono text-xl ${positive ? "text-green-400" : "text-red-400"}`}>
                  {positive ? "+" : ""}{formatPrice(change)} ({positive ? "+" : ""}{changePct.toFixed(2)}%)
                </div>
              </div>
              <div className="rounded-sm border border-terminal-border bg-terminal-bg px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.18em] text-terminal-muted">Spread</div>
                <div className="mt-1 font-mono text-lg text-terminal-text">
                  {formatSpread(depthSnapshot?.spread ?? 0, depthSnapshot?.last_price ?? lastPrice)}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid min-h-[920px] gap-2 xl:grid-cols-[1.5fr_1fr]">
          <DOMLadder
            symbol={activeTicker}
            market={selectedMarket}
            className="min-h-[920px]"
            onSnapshot={setDepthSnapshot}
          />
          <TimeAndSales ticker={activeTicker} className="min-h-[920px]" />
        </div>
      </div>
    </div>
  );
}
