import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { CountryCode, MarketCode } from "../types/markets";

export type DisplayCurrency = "INR" | "USD";
export type RealtimeMode = "polling" | "ws";
export type ThemeVariant = "terminal-noir" | "classic-bloomberg" | "light-desk" | "custom";
export type RecentSecurityAssetClass = "equity" | "fno" | "crypto" | "commodity" | "forex" | "etf" | "mf";
export type RecentSecurityMarket = "IN" | "US";

export type RecentSecurity = {
  symbol: string;
  name: string;
  assetClass: RecentSecurityAssetClass;
  market: RecentSecurityMarket;
  lastPrice?: number;
  changePercent?: number;
  visitedAt: number;
};

const MAX_RECENT_SECURITIES = 20;
const RECENT_SECURITY_ASSET_CLASSES: RecentSecurityAssetClass[] = ["equity", "fno", "crypto", "commodity", "forex", "etf", "mf"];

function isRecentSecurityAssetClass(value: unknown): value is RecentSecurityAssetClass {
  return RECENT_SECURITY_ASSET_CLASSES.includes(value as RecentSecurityAssetClass);
}

function sanitizeRecentSecurity(item: unknown): RecentSecurity | null {
  if (!item || typeof item !== "object") return null;
  const row = item as Partial<RecentSecurity>;
  const symbol = String(row.symbol ?? "").trim().toUpperCase();
  if (!symbol) return null;

  const name = String(row.name ?? symbol).trim() || symbol;
  const assetClass = isRecentSecurityAssetClass(row.assetClass) ? row.assetClass : "equity";
  const market: RecentSecurityMarket = row.market === "IN" ? "IN" : "US";
  const visitedAt = Number.isFinite(Number(row.visitedAt)) ? Number(row.visitedAt) : Date.now();
  const lastPrice = Number.isFinite(Number(row.lastPrice)) ? Number(row.lastPrice) : undefined;
  const changePercent = Number.isFinite(Number(row.changePercent)) ? Number(row.changePercent) : undefined;

  return {
    symbol,
    name,
    assetClass,
    market,
    lastPrice,
    changePercent,
    visitedAt,
  };
}

function sanitizeRecentSecurities(items: unknown): RecentSecurity[] {
  if (!Array.isArray(items)) return [];

  const deduped = new Map<string, RecentSecurity>();
  for (const item of items) {
    const row = sanitizeRecentSecurity(item);
    if (!row) continue;
    const previous = deduped.get(row.symbol);
    if (!previous || row.visitedAt >= previous.visitedAt) {
      deduped.set(row.symbol, row);
    }
  }

  return [...deduped.values()]
    .sort((a, b) => b.visitedAt - a.visitedAt)
    .slice(0, MAX_RECENT_SECURITIES);
}

type SettingsState = {
  selectedCountry: CountryCode;
  selectedMarket: MarketCode;
  displayCurrency: DisplayCurrency;
  realtimeMode: RealtimeMode;
  newsAutoRefresh: boolean;
  newsRefreshSec: number;
  themeVariant: ThemeVariant;
  customAccentColor: string;
  hudOverlayEnabled: boolean;
  recentSecurities: RecentSecurity[];
  setSelectedCountry: (country: CountryCode) => void;
  setSelectedMarket: (market: MarketCode) => void;
  setDisplayCurrency: (currency: DisplayCurrency) => void;
  setRealtimeMode: (mode: RealtimeMode) => void;
  setNewsAutoRefresh: (enabled: boolean) => void;
  setNewsRefreshSec: (seconds: number) => void;
  setThemeVariant: (theme: ThemeVariant) => void;
  setCustomAccentColor: (value: string) => void;
  setHudOverlayEnabled: (enabled: boolean) => void;
  addRecentSecurity: (security: RecentSecurity) => void;
  clearRecentSecurities: () => void;
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
      themeVariant: "terminal-noir",
      customAccentColor: "#FF6B00",
      hudOverlayEnabled: false,
      recentSecurities: [],
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
      setThemeVariant: (theme) => set({ themeVariant: theme }),
      setCustomAccentColor: (value) =>
        set({
          customAccentColor: /^#[0-9A-Fa-f]{6}$/.test(value) ? value.toUpperCase() : "#FF6B00",
        }),
      setHudOverlayEnabled: (enabled) => set({ hudOverlayEnabled: enabled }),
      addRecentSecurity: (security) =>
        set((state) => {
          const next = sanitizeRecentSecurity(security);
          if (!next) return {};

          return {
            recentSecurities: [next, ...state.recentSecurities.filter((item) => item.symbol !== next.symbol)].slice(
              0,
              MAX_RECENT_SECURITIES,
            ),
          };
        }),
      clearRecentSecurities: () => set({ recentSecurities: [] }),
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
          themeVariant:
            persisted.themeVariant === "terminal-noir" ||
            persisted.themeVariant === "classic-bloomberg" ||
            persisted.themeVariant === "light-desk" ||
            persisted.themeVariant === "custom"
              ? persisted.themeVariant
              : current.themeVariant,
          customAccentColor:
            typeof persisted.customAccentColor === "string" && /^#[0-9A-Fa-f]{6}$/.test(persisted.customAccentColor)
              ? persisted.customAccentColor.toUpperCase()
              : current.customAccentColor,
          hudOverlayEnabled:
            typeof persisted.hudOverlayEnabled === "boolean"
              ? persisted.hudOverlayEnabled
              : current.hudOverlayEnabled,
          recentSecurities: sanitizeRecentSecurities((persisted as Partial<SettingsState>).recentSecurities),
        };
      },
    },
  ),
);
