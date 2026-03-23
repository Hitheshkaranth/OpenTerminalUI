import { useCallback } from "react";

import {
  useSettingsStore,
  type RecentSecurityAssetClass,
  type RecentSecurityMarket,
} from "../store/settingsStore";

export function inferRecentSecurityAssetClass(symbol: string, exchange?: string | null): RecentSecurityAssetClass {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const normalizedExchange = String(exchange ?? "").trim().toUpperCase();

  if (normalizedSymbol.endsWith("-USD") || normalizedExchange.includes("CRYPTO")) return "crypto";
  if (normalizedExchange.includes("FOREX") || normalizedExchange === "FX") return "forex";
  if (normalizedExchange.includes("COM")) return "commodity";
  if (normalizedExchange.includes("ETF")) return "etf";
  if (normalizedExchange.includes("MF") || normalizedExchange.includes("MUTUAL")) return "mf";
  if (normalizedExchange.includes("NFO") || normalizedExchange.includes("FUT") || normalizedExchange.includes("OPT")) return "fno";
  return "equity";
}

export function inferRecentSecurityMarket(countryCode?: string | null, exchangeOrMarket?: string | null): RecentSecurityMarket {
  const normalizedCountry = String(countryCode ?? "").trim().toUpperCase();
  const normalizedExchange = String(exchangeOrMarket ?? "").trim().toUpperCase();

  if (normalizedCountry === "IN" || normalizedExchange === "NSE" || normalizedExchange === "BSE") return "IN";
  return "US";
}

export function useRecentSecurities() {
  const recentSecurities = useSettingsStore((state) => state.recentSecurities);
  const addRecentSecurity = useSettingsStore((state) => state.addRecentSecurity);
  const clearRecentSecurities = useSettingsStore((state) => state.clearRecentSecurities);

  const addRecent = useCallback(
    (
      symbol: string,
      name?: string,
      assetClass: RecentSecurityAssetClass = "equity",
      market: RecentSecurityMarket = "US",
      lastPrice?: number,
      changePercent?: number,
    ) => {
      const normalizedSymbol = symbol.trim().toUpperCase();
      if (!normalizedSymbol) return;

      addRecentSecurity({
        symbol: normalizedSymbol,
        name: (name ?? normalizedSymbol).trim() || normalizedSymbol,
        assetClass,
        market,
        lastPrice,
        changePercent,
        visitedAt: Date.now(),
      });
    },
    [addRecentSecurity],
  );

  return {
    recentSecurities,
    addRecent,
    clearRecent: clearRecentSecurities,
  };
}
