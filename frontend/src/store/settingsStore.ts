import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { CountryCode, MarketCode } from "../types/markets";

type DisplayCurrency = "INR" | "USD";
type RealtimeMode = "polling" | "ws";

type SettingsState = {
  selectedCountry: CountryCode;
  selectedMarket: MarketCode;
  displayCurrency: DisplayCurrency;
  realtimeMode: RealtimeMode;
  newsAutoRefresh: boolean;
  newsRefreshSec: number;
  setSelectedCountry: (country: CountryCode) => void;
  setSelectedMarket: (market: MarketCode) => void;
  setDisplayCurrency: (currency: DisplayCurrency) => void;
  setRealtimeMode: (mode: RealtimeMode) => void;
  setNewsAutoRefresh: (enabled: boolean) => void;
  setNewsRefreshSec: (seconds: number) => void;
};

const countryDefaults: Record<CountryCode, { market: MarketCode; currency: DisplayCurrency }> = {
  IN: { market: "NSE", currency: "INR" },
  US: { market: "NASDAQ", currency: "USD" },
};

const defaultCountry: CountryCode = "US";
const defaultValues = countryDefaults[defaultCountry];

function normalizePersistedMarket(value: unknown, country: CountryCode): MarketCode {
  const raw = String(value ?? "").trim().toUpperCase();
  if (raw === "IN") return "NSE";
  if (raw === "US") return "NASDAQ";
  if (raw === "NSE" || raw === "BSE" || raw === "NYSE" || raw === "NASDAQ") return raw as MarketCode;
  return countryDefaults[country].market;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      selectedCountry: defaultCountry,
      selectedMarket: defaultValues.market,
      displayCurrency: defaultValues.currency,
      realtimeMode: "polling",
      newsAutoRefresh: true,
      newsRefreshSec: 60,
      setSelectedCountry: (country) => {
        const defaults = countryDefaults[country];
        set({
          selectedCountry: country,
          selectedMarket: defaults.market,
          displayCurrency: defaults.currency,
        });
      },
      setSelectedMarket: (market) => set({ selectedMarket: market }),
      setDisplayCurrency: (currency) => set({ displayCurrency: currency }),
      setRealtimeMode: (mode) => set({ realtimeMode: mode }),
      setNewsAutoRefresh: (enabled) => set({ newsAutoRefresh: enabled }),
      setNewsRefreshSec: (seconds) => set({ newsRefreshSec: seconds }),
    }),
    {
      name: "ui-settings",
      storage: createJSONStorage(() => localStorage),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState as Partial<SettingsState>) ?? {};
        const current = currentState as SettingsState;
        const selectedCountry: CountryCode =
          persisted.selectedCountry === "IN" || persisted.selectedCountry === "US"
            ? persisted.selectedCountry
            : current.selectedCountry;
        return {
          ...current,
          ...persisted,
          selectedCountry,
          selectedMarket: normalizePersistedMarket((persisted as any).selectedMarket, selectedCountry),
        };
      },
    },
  ),
);
