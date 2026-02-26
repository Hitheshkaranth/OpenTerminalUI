import { useEffect, useMemo } from "react";
import type { ChartSlot } from "../store/chartWorkstationStore";
import { useQuotesStore, useQuotesStream } from "../realtime/useQuotesStream";

function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase();
}

export function useWorkstationQuotes(slots: ChartSlot[]) {
  const nseSymbols = useMemo(
    () =>
      slots
        .filter((s) => s.ticker && s.market === "IN")
        .map((s) => normalizeSymbol(s.ticker!)),
    [slots],
  );
  const usSymbols = useMemo(
    () =>
      slots
        .filter((s) => s.ticker && s.market === "US")
        .map((s) => normalizeSymbol(s.ticker!)),
    [slots],
  );

  const nse = useQuotesStream("NSE");
  const us = useQuotesStream("NASDAQ");
  const ticksByToken = useQuotesStore((s) => s.ticksByToken);
  const { subscribe: subscribeNse, unsubscribe: unsubscribeNse } = nse;
  const { subscribe: subscribeUs, unsubscribe: unsubscribeUs } = us;

  useEffect(() => {
    if (!nseSymbols.length) return;
    subscribeNse(nseSymbols);
    return () => unsubscribeNse(nseSymbols);
  }, [nseSymbols, subscribeNse, unsubscribeNse]);

  useEffect(() => {
    if (!usSymbols.length) return;
    subscribeUs(usSymbols);
    return () => unsubscribeUs(usSymbols);
  }, [subscribeUs, unsubscribeUs, usSymbols]);

  const quoteBySlotId = useMemo(() => {
    const out: Record<string, (typeof ticksByToken)[string] | null> = {};
    for (const slot of slots) {
      if (!slot.ticker) {
        out[slot.id] = null;
        continue;
      }
      const market = slot.market === "IN" ? "NSE" : "NASDAQ";
      out[slot.id] = ticksByToken[`${market}:${normalizeSymbol(slot.ticker)}`] ?? null;
    }
    return out;
  }, [slots, ticksByToken]);

  const connectionState =
    nse.connectionState === "connected" || us.connectionState === "connected"
      ? "connected"
      : nse.connectionState === "connecting" || us.connectionState === "connecting"
        ? "connecting"
        : "disconnected";

  return {
    connectionState,
    isConnected: connectionState === "connected",
    quoteBySlotId,
  };
}
