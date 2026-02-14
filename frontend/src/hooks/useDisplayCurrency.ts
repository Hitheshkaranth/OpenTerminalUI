import { useEffect, useMemo, useRef } from "react";

import { useSettingsStore } from "../store/settingsStore";
import { formatMoney } from "../lib/format";
import { useMarketStatus } from "./useStocks";

type MarketStatusPayload = {
  usdInr?: number | null;
  inrUsd?: number | null;
};

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function useDisplayCurrency() {
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const selectedMarket = useSettingsStore((s) => s.selectedMarket);
  const { data } = useMarketStatus();

  const liveUsdInr = useMemo(() => {
    const payload = (data ?? {}) as MarketStatusPayload;
    const direct = toNumber(payload.usdInr);
    if (direct && direct > 0) return direct;
    const inverse = toNumber(payload.inrUsd);
    if (inverse && inverse > 0) return 1 / inverse;
    return null;
  }, [data]);

  const lastKnownUsdInrRef = useRef<number | null>(null);
  useEffect(() => {
    if (liveUsdInr && liveUsdInr > 0) {
      lastKnownUsdInrRef.current = liveUsdInr;
    }
  }, [liveUsdInr]);

  const usdInr = liveUsdInr ?? lastKnownUsdInrRef.current;
  const isIndiaMarket = selectedMarket === "NSE" || selectedMarket === "BSE";
  const isUsMarket = selectedMarket === "NASDAQ" || selectedMarket === "NYSE";
  const financialUnit = displayCurrency === "USD" ? "M" : "Cr";
  const financialDivisor = displayCurrency === "USD" ? 1e6 : 1e7;
  const moneySymbol = displayCurrency === "USD" ? "$" : "\u20b9";
  const moneyLocale = displayCurrency === "USD" ? "en-US" : "en-IN";

  const convertAmount = (value: number): number => {
    if (!Number.isFinite(value)) return value;
    if (isIndiaMarket && displayCurrency === "USD") {
      if (!usdInr || usdInr <= 0) return Number.NaN;
      return value / usdInr;
    }
    if (isUsMarket && displayCurrency === "INR") {
      if (!usdInr || usdInr <= 0) return Number.NaN;
      return value * usdInr;
    }
    return value;
  };

  const formatDisplayMoney = (value: number): string => {
    const converted = convertAmount(value);
    return formatMoney(converted, displayCurrency);
  };

  const scaleFinancialAmount = (value: number): number => {
    const converted = convertAmount(value);
    if (!Number.isFinite(converted)) return Number.NaN;
    return converted / financialDivisor;
  };

  const formatFinancialCompact = (value: number): string => {
    const scaled = scaleFinancialAmount(value);
    if (!Number.isFinite(scaled)) return "-";
    return `${moneySymbol} ${scaled.toLocaleString(moneyLocale, { maximumFractionDigits: 2 })} ${financialUnit}`;
  };

  return {
    displayCurrency,
    usdInr,
    convertAmount,
    formatDisplayMoney,
    financialUnit,
    scaleFinancialAmount,
    formatFinancialCompact,
  };
}
