import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  fetchDepth,
  fetchPaperOrders,
  fetchPaperPortfolios,
  fetchPaperPositions,
  placePaperOrder,
} from "../../api/client";
import type { PaperOrder, PaperPosition } from "../../types";
import { useQuotesStore } from "../../realtime/useQuotesStream";
import { useSettingsStore } from "../../store/settingsStore";
import { useStockStore } from "../../store/stockStore";

const PAPER_PORTFOLIO_KEY = "ot:paper:selected-portfolio:v1";

type FlashState = "buy" | "sell" | null;
type OrderMode = "market" | "limit";

function formatPrice(value: number | null | undefined) {
  if (!Number.isFinite(Number(value))) return "--";
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatSignedPrice(value: number | null | undefined) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "--";
  return `${numeric >= 0 ? "+" : ""}${formatPrice(numeric)}`;
}

function formatSignedPct(value: number | null | undefined) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "--";
  return `${numeric >= 0 ? "+" : ""}${numeric.toFixed(2)}%`;
}

function formatCompact(value: number | null | undefined) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "--";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(numeric);
}

function readStoredPortfolioId() {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(PAPER_PORTFOLIO_KEY) || "";
  } catch {
    return "";
  }
}

function writeStoredPortfolioId(value: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PAPER_PORTFOLIO_KEY, value);
  } catch {
    // ignore persistence failure
  }
}

function emitToast(message: string, variant: "info" | "success" | "warning" | "danger" = "info") {
  window.dispatchEvent(
    new CustomEvent("ot:alert-toast", {
      detail: {
        title: "Paper Trading",
        message,
        variant,
        ttlMs: 3000,
      },
    }),
  );
}

function resolveQuoteToken(market: string, symbol: string) {
  return `${market.trim().toUpperCase()}:${symbol.trim().toUpperCase()}`;
}

export function HotKeyPanel({
  className = "",
  autoFocus = false,
  embedded = false,
}: {
  className?: string;
  autoFocus?: boolean;
  embedded?: boolean;
}) {
  const queryClient = useQueryClient();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  const selectedMarket = useSettingsStore((state) => state.selectedMarket);
  const ticker = useStockStore((state) => state.ticker);
  const stock = useStockStore((state) => state.stock);
  const tick = useQuotesStore((state) => state.ticksByToken[resolveQuoteToken(selectedMarket, ticker || "RELIANCE")]);
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string>(() => readStoredPortfolioId());
  const [focused, setFocused] = useState(autoFocus);
  const [quantity, setQuantity] = useState(1);
  const [orderMode, setOrderMode] = useState<OrderMode>("market");
  const [limitPrice, setLimitPrice] = useState(0);
  const [flash, setFlash] = useState<FlashState>(null);

  const activeTicker = (ticker || "RELIANCE").toUpperCase();

  const portfoliosQuery = useQuery({
    queryKey: ["paper", "portfolios"],
    queryFn: fetchPaperPortfolios,
    refetchInterval: 60_000,
  });

  const positionsQuery = useQuery({
    queryKey: ["paper", "positions", selectedPortfolioId],
    queryFn: () => fetchPaperPositions(selectedPortfolioId),
    enabled: Boolean(selectedPortfolioId),
    refetchInterval: 15_000,
  });

  const ordersQuery = useQuery({
    queryKey: ["paper", "orders", selectedPortfolioId],
    queryFn: () => fetchPaperOrders(selectedPortfolioId),
    enabled: Boolean(selectedPortfolioId),
    refetchInterval: 10_000,
  });

  const depthQuery = useQuery({
    queryKey: ["hotkey-panel", "depth", selectedMarket, activeTicker],
    queryFn: () => fetchDepth(activeTicker, selectedMarket, 5),
    staleTime: 1_000,
    refetchInterval: 3_000,
  });

  useEffect(() => {
    if (!portfoliosQuery.data?.length) return;
    if (selectedPortfolioId && portfoliosQuery.data.some((row) => row.id === selectedPortfolioId)) return;
    const next = portfoliosQuery.data[0].id;
    setSelectedPortfolioId(next);
    writeStoredPortfolioId(next);
  }, [portfoliosQuery.data, selectedPortfolioId]);

  useEffect(() => {
    if (!autoFocus) return;
    panelRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    const fallback = Number(tick?.ltp ?? stock?.current_price ?? depthQuery.data?.last_price ?? 0);
    if (!Number.isFinite(fallback) || fallback <= 0) return;
    setLimitPrice((prev) => (prev > 0 ? prev : fallback));
  }, [depthQuery.data?.last_price, stock?.current_price, tick?.ltp]);

  useEffect(
    () => () => {
      if (flashTimerRef.current != null) {
        window.clearTimeout(flashTimerRef.current);
      }
    },
    [],
  );

  const selectedPortfolio = useMemo(
    () => portfoliosQuery.data?.find((row) => row.id === selectedPortfolioId) ?? null,
    [portfoliosQuery.data, selectedPortfolioId],
  );

  const activePosition = useMemo<PaperPosition | null>(() => {
    const normalized = `${selectedMarket}:${activeTicker}`;
    return (
      positionsQuery.data?.find((row) => String(row.symbol || "").toUpperCase() === normalized)
      ?? positionsQuery.data?.find((row) => String(row.symbol || "").toUpperCase().endsWith(`:${activeTicker}`))
      ?? null
    );
  }, [activeTicker, positionsQuery.data, selectedMarket]);

  const recentOrders = useMemo<PaperOrder[]>(
    () => (ordersQuery.data ?? []).filter((row) => String(row.symbol || "").toUpperCase().endsWith(`:${activeTicker}`)).slice(0, 5),
    [activeTicker, ordersQuery.data],
  );

  const lastPrice = Number(tick?.ltp ?? stock?.current_price ?? depthQuery.data?.last_price ?? activePosition?.mark_price ?? 0);
  const changePct = Number(tick?.change_pct ?? stock?.change_pct ?? 0);
  const previousClose = changePct !== -100 && lastPrice > 0 ? lastPrice / (1 + changePct / 100) : 0;
  const change = lastPrice > 0 ? lastPrice - previousClose : 0;
  const bestBid = Number(depthQuery.data?.bids?.[0]?.price ?? (lastPrice > 0 ? lastPrice - Math.max(0.01, lastPrice * 0.0005) : 0));
  const bestAsk = Number(depthQuery.data?.asks?.[0]?.price ?? (lastPrice > 0 ? lastPrice + Math.max(0.01, lastPrice * 0.0005) : 0));
  const maxQty = useMemo(() => {
    const cash = Number(selectedPortfolio?.current_cash ?? 0);
    const basis = orderMode === "limit" && limitPrice > 0 ? limitPrice : lastPrice;
    if (!Number.isFinite(cash) || !Number.isFinite(basis) || basis <= 0) return 0;
    return Math.max(0, Math.floor(cash / basis));
  }, [lastPrice, limitPrice, orderMode, selectedPortfolio?.current_cash]);

  const submitOrder = useMutation({
    mutationFn: async (payload: {
      side: "buy" | "sell";
      mode: OrderMode;
      quantity: number;
      limitPrice?: number;
    }) => {
      if (!selectedPortfolioId) throw new Error("Select a paper portfolio first.");
      if (!payload.quantity || payload.quantity <= 0) throw new Error("Quantity must be greater than zero.");
      return placePaperOrder({
        portfolio_id: selectedPortfolioId,
        symbol: `${selectedMarket}:${activeTicker}`,
        side: payload.side,
        order_type: payload.mode,
        quantity: payload.quantity,
        limit_price: payload.mode === "limit" ? payload.limitPrice : undefined,
      });
    },
    onSuccess: async (result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["paper", "orders", selectedPortfolioId] }),
        queryClient.invalidateQueries({ queryKey: ["paper", "positions", selectedPortfolioId] }),
        queryClient.invalidateQueries({ queryKey: ["paper", "portfolios"] }),
      ]);
      setFlash(variables.side);
      if (flashTimerRef.current != null) window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = window.setTimeout(() => setFlash(null), 450);
      emitToast(
        `${variables.side === "buy" ? "Bought" : "Sold"} ${variables.quantity} ${activeTicker} @ ${formatPrice(result.fill_price ?? variables.limitPrice ?? lastPrice)}`,
        "success",
      );
    },
    onError: (error) => {
      emitToast(error instanceof Error ? error.message : "Failed to place paper order.", "danger");
    },
  });

  const handleSubmit = (side: "buy" | "sell", mode = orderMode) => {
    void submitOrder.mutateAsync({
      side,
      mode,
      quantity,
      limitPrice: mode === "limit" ? limitPrice || lastPrice : undefined,
    });
  };

  const handleFlatten = () => {
    if (!activePosition || Math.abs(Number(activePosition.quantity || 0)) <= 0) {
      emitToast("No open position to flatten.", "warning");
      return;
    }
    const positionQty = Math.abs(Number(activePosition.quantity));
    const side = Number(activePosition.quantity) > 0 ? "sell" : "buy";
    void submitOrder.mutateAsync({
      side,
      mode: "market",
      quantity: positionQty,
    });
  };

  const handleReverse = () => {
    const qty = Math.abs(Number(activePosition?.quantity || 0));
    if (!qty) {
      emitToast("No position to reverse.", "warning");
      return;
    }
    emitToast("Paper engine is currently long-only. Reverse will flatten only.", "warning");
    handleFlatten();
  };

  const handleCancelDraft = () => {
    setOrderMode("market");
    setLimitPrice(lastPrice > 0 ? lastPrice : 0);
    emitToast("Pending-order cancel is not available in the current paper API. Draft cleared instead.", "warning");
  };

  useEffect(() => {
    const node = panelRef.current;
    if (!node) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!focused) return;
      const tag = (event.target as HTMLElement | null)?.tagName?.toLowerCase();
      const inEditable = tag === "input" || tag === "textarea" || tag === "select";
      if (event.key === "Escape") {
        event.preventDefault();
        handleCancelDraft();
        return;
      }
      if (inEditable && !["+", "=", "-", "b", "B", "s", "S", "f", "F", "r", "R"].includes(event.key)) return;
      if (event.shiftKey && (event.key === "B" || event.key === "S")) {
        event.preventDefault();
        handleSubmit(event.key === "B" ? "buy" : "sell", "limit");
        return;
      }
      switch (event.key) {
        case "b":
        case "B":
          event.preventDefault();
          handleSubmit("buy", "market");
          break;
        case "s":
        case "S":
          event.preventDefault();
          handleSubmit("sell", "market");
          break;
        case "f":
        case "F":
          event.preventDefault();
          handleFlatten();
          break;
        case "r":
        case "R":
          event.preventDefault();
          handleReverse();
          break;
        case "+":
        case "=":
          event.preventDefault();
          setQuantity((prev) => Math.max(1, prev + 1));
          break;
        case "-":
          event.preventDefault();
          setQuantity((prev) => Math.max(1, prev - 1));
          break;
        default:
          break;
      }
    };
    node.addEventListener("keydown", onKeyDown);
    return () => node.removeEventListener("keydown", onKeyDown);
  }, [focused, handleFlatten, handleReverse, lastPrice, limitPrice, orderMode, quantity]);

  const flashClass =
    flash === "buy"
      ? "border-emerald-400 shadow-[0_0_0_1px_rgba(16,185,129,0.6),0_0_26px_rgba(16,185,129,0.22)]"
      : flash === "sell"
        ? "border-red-400 shadow-[0_0_0_1px_rgba(248,113,113,0.65),0_0_26px_rgba(248,113,113,0.22)]"
        : focused
          ? "border-terminal-accent shadow-[0_0_0_1px_rgba(var(--terminal-accent-rgb,74_222_128),0.55),0_0_28px_rgba(56,189,248,0.14)]"
          : "border-terminal-border";

  return (
    <div
      ref={panelRef}
      tabIndex={0}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (panelRef.current?.contains(event.relatedTarget as Node | null)) return;
        setFocused(false);
      }}
      onMouseDown={() => {
        setFocused(true);
        panelRef.current?.focus();
      }}
      className={`rounded-sm border bg-terminal-panel p-3 outline-none transition-all ${flashClass} ${className}`.trim()}
      data-testid="hotkey-panel"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-terminal-muted">Hot Key Trading</div>
          <div className="mt-1 flex items-center gap-2">
            <div className="text-2xl font-semibold text-terminal-text" data-testid="hotkey-symbol">{activeTicker}</div>
            <span className="rounded-sm border border-amber-500/70 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300">
              Paper
            </span>
            {focused ? <span className="text-[10px] uppercase tracking-[0.18em] text-terminal-accent">Focused</span> : null}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-terminal-muted">
            <span className="font-mono text-terminal-text">{formatPrice(lastPrice)}</span>
            <span className={change >= 0 ? "text-emerald-300" : "text-red-300"}>{formatSignedPrice(change)} ({formatSignedPct(changePct)})</span>
            <span>BID {formatPrice(bestBid)}</span>
            <span>ASK {formatPrice(bestAsk)}</span>
          </div>
        </div>
        <div className="min-w-[120px] text-right">
          <div className="text-[10px] uppercase tracking-[0.18em] text-terminal-muted">Portfolio</div>
          <select
            value={selectedPortfolioId}
            onChange={(event) => {
              setSelectedPortfolioId(event.target.value);
              writeStoredPortfolioId(event.target.value);
            }}
            className="mt-1 w-full rounded-sm border border-terminal-border bg-terminal-bg px-2 py-1 text-[11px] text-terminal-text outline-none"
          >
            <option value="">{portfoliosQuery.data?.length ? "Select" : "No portfolio"}</option>
            {portfoliosQuery.data?.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
          {!selectedPortfolio && !portfoliosQuery.isLoading ? (
            <div className="mt-1 text-[10px] text-terminal-muted">Create a paper portfolio on the Paper Trading page.</div>
          ) : null}
        </div>
      </div>

      {activePosition ? (
        <div className="mt-3 grid gap-2 rounded-sm border border-terminal-border bg-terminal-bg/60 p-2 text-xs sm:grid-cols-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-terminal-muted">Position</div>
            <div className={`mt-1 font-mono ${activePosition.quantity >= 0 ? "text-emerald-300" : "text-red-300"}`}>
              {activePosition.quantity >= 0 ? "+" : ""}{activePosition.quantity} {activePosition.quantity >= 0 ? "LONG" : "SHORT"}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-terminal-muted">Avg Entry</div>
            <div className="mt-1 font-mono text-terminal-text">{formatPrice(activePosition.avg_entry_price)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-terminal-muted">Unrealized</div>
            <div className={`mt-1 font-mono ${activePosition.unrealized_pnl >= 0 ? "text-emerald-300" : "text-red-300"}`}>
              {formatSignedPrice(activePosition.unrealized_pnl)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-terminal-muted">Market Value</div>
            <div className="mt-1 font-mono text-terminal-text">{formatPrice(activePosition.quantity * activePosition.mark_price)}</div>
          </div>
        </div>
      ) : null}

      <div className="mt-3 space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-[0.18em] text-terminal-muted">Quantity</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setQuantity((prev) => Math.max(1, prev - 1))}
                className="rounded-sm border border-terminal-border px-2 py-1 text-terminal-muted hover:text-terminal-text"
              >
                -
              </button>
              <input
                value={quantity}
                onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))}
                type="number"
                min={1}
                className="w-24 rounded-sm border border-terminal-border bg-terminal-bg px-2 py-1 font-mono text-terminal-text outline-none"
                aria-label="Quantity"
              />
              <button
                type="button"
                onClick={() => setQuantity((prev) => prev + 1)}
                className="rounded-sm border border-terminal-border px-2 py-1 text-terminal-muted hover:text-terminal-text"
              >
                +
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {[
                { label: "1x", value: 1 },
                { label: "5x", value: 5 },
                { label: "10x", value: 10 },
                { label: "25x", value: 25 },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => setQuantity(item.value)}
                  className="rounded-sm border border-terminal-border px-2 py-1 text-[11px] text-terminal-muted hover:text-terminal-text"
                >
                  {item.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setQuantity(Math.max(1, maxQty))}
                className="rounded-sm border border-terminal-border px-2 py-1 text-[11px] text-terminal-muted hover:text-terminal-text"
              >
                Max
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-[0.18em] text-terminal-muted">Order Type</div>
            <div className="flex items-center gap-1">
              {(["market", "limit"] as OrderMode[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setOrderMode(item)}
                  className={`rounded-sm border px-3 py-1 text-[11px] uppercase tracking-[0.16em] ${
                    orderMode === item
                      ? "border-terminal-accent bg-terminal-accent/10 text-terminal-accent"
                      : "border-terminal-border text-terminal-muted hover:text-terminal-text"
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
            {orderMode === "limit" ? (
              <input
                value={limitPrice}
                onChange={(event) => setLimitPrice(Number(event.target.value) || 0)}
                type="number"
                step="0.05"
                className="w-full rounded-sm border border-terminal-border bg-terminal-bg px-2 py-1 font-mono text-terminal-text outline-none"
                aria-label="Limit Price"
              />
            ) : null}
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            disabled={!selectedPortfolioId || submitOrder.isPending}
            onClick={() => handleSubmit("buy", orderMode)}
            className="rounded-sm border border-emerald-500/60 bg-emerald-500/12 px-3 py-2 text-sm font-semibold text-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            BUY ({orderMode === "market" ? "B" : "SHIFT+B"})
          </button>
          <button
            type="button"
            disabled={!selectedPortfolioId || submitOrder.isPending}
            onClick={() => handleSubmit("sell", orderMode)}
            className="rounded-sm border border-red-500/60 bg-red-500/12 px-3 py-2 text-sm font-semibold text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            SELL ({orderMode === "market" ? "S" : "SHIFT+S"})
          </button>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <button
            type="button"
            onClick={handleFlatten}
            className="rounded-sm border border-terminal-border px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-terminal-muted hover:text-terminal-text"
          >
            Flatten (F)
          </button>
          <button
            type="button"
            onClick={handleReverse}
            className="rounded-sm border border-terminal-border px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-terminal-muted hover:text-terminal-text"
          >
            Reverse (R)
          </button>
          <button
            type="button"
            onClick={handleCancelDraft}
            className="rounded-sm border border-terminal-border px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-terminal-muted hover:text-terminal-text"
          >
            Clear Draft (Esc)
          </button>
        </div>
      </div>

      <div className="mt-3 rounded-sm border border-terminal-border bg-terminal-bg/50 p-2">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-[0.18em] text-terminal-muted">Recent Orders</div>
          {embedded ? <div className="text-[10px] text-terminal-muted">Embedded on Paper Trading</div> : null}
        </div>
        <div className="mt-2 space-y-1 text-[11px]">
          {recentOrders.length ? (
            recentOrders.map((row) => (
              <div key={row.id} className="grid grid-cols-[74px_1fr_54px_72px] gap-2 rounded-sm border border-terminal-border px-2 py-1">
                <div className="font-mono text-terminal-muted">{row.fill_time ? new Date(row.fill_time).toLocaleTimeString() : "--:--:--"}</div>
                <div className={`${row.side === "buy" ? "text-emerald-300" : "text-red-300"}`}>
                  {row.side.toUpperCase()} {row.quantity}
                </div>
                <div className="text-right font-mono text-terminal-text">{formatPrice(row.fill_price ?? row.limit_price)}</div>
                <div className="text-right uppercase text-terminal-muted">{row.status}</div>
              </div>
            ))
          ) : (
            <div className="rounded-sm border border-dashed border-terminal-border px-2 py-3 text-center text-terminal-muted">
              No recent orders for {activeTicker}.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
