import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import {
  fetchPublicScreensV3,
  fetchSavedScreensV3,
  fetchScreenerPresetsV3,
  runScreenerV3,
} from "../../../api/client";
import type {
  ScreenerPresetV3,
  ScreenerRunResponseV3,
  UserScreenV3,
} from "../../../types";

export type ScreenerView = "table" | "charts" | "treemap" | "scatter" | "scorecard" | "split";
export type ScreenerTab = "library" | "custom" | "saved" | "public";

type ScreenerContextValue = {
  loading: boolean;
  error: string | null;
  presets: ScreenerPresetV3[];
  savedScreens: UserScreenV3[];
  publicScreens: UserScreenV3[];
  tab: ScreenerTab;
  setTab: (tab: ScreenerTab) => void;
  selectedPresetId: string | null;
  setSelectedPresetId: (id: string | null) => void;
  query: string;
  setQuery: (query: string) => void;
  universe: string;
  setUniverse: (universe: string) => void;
  view: ScreenerView;
  setView: (view: ScreenerView) => void;
  result: ScreenerRunResponseV3 | null;
  selectedRow: Record<string, unknown> | null;
  setSelectedRow: (row: Record<string, unknown> | null) => void;
  refreshScreens: () => Promise<void>;
  run: (override?: Partial<{ query: string; preset_id: string | null }>) => Promise<void>;
};

const ScreenerContext = createContext<ScreenerContextValue | null>(null);

export function ScreenerProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [presets, setPresets] = useState<ScreenerPresetV3[]>([]);
  const [savedScreens, setSavedScreens] = useState<UserScreenV3[]>([]);
  const [publicScreens, setPublicScreens] = useState<UserScreenV3[]>([]);
  const [tab, setTab] = useState<ScreenerTab>("library");
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [query, setQuery] = useState("Market Capitalization > 500 AND ROE > 15 AND Debt to equity < 0.5");
  const [universe, setUniverse] = useState("nse_500");
  const [view, setView] = useState<ScreenerView>("table");
  const [result, setResult] = useState<ScreenerRunResponseV3 | null>(null);
  const [selectedRow, setSelectedRow] = useState<Record<string, unknown> | null>(null);

  const refreshScreens = useCallback(async () => {
    const [presetItems, savedItems, publicItems] = await Promise.all([
      fetchScreenerPresetsV3(),
      fetchSavedScreensV3(),
      fetchPublicScreensV3(),
    ]);
    setPresets(presetItems);
    setSavedScreens(savedItems);
    setPublicScreens(publicItems);
    if (!selectedPresetId && presetItems.length > 0) {
      setSelectedPresetId(presetItems[0].id);
      setQuery(presetItems[0].query);
    }
  }, [selectedPresetId]);

  useEffect(() => {
    void refreshScreens();
  }, [refreshScreens]);

  useEffect(() => {
    if (!selectedPresetId) return;
    const selected = presets.find((preset) => preset.id === selectedPresetId);
    if (selected) {
      setQuery(selected.query);
    }
  }, [selectedPresetId, presets]);

  const run = useCallback(
    async (override?: Partial<{ query: string; preset_id: string | null }>) => {
      setLoading(true);
      setError(null);
      try {
        const payloadPresetId = override?.preset_id === undefined ? selectedPresetId : override.preset_id;
        const data = await runScreenerV3({
          query: override?.query ?? query,
          preset_id: payloadPresetId ?? undefined,
          universe,
          limit: 250,
          offset: 0,
          sort_order: "desc",
          include_sparklines: true,
        });
        setResult(data);
        if (data.results.length > 0) {
          setSelectedRow(data.results[0]);
        }
      } catch (err) {
        if (typeof err === "object" && err !== null && "response" in err) {
          const response = (err as { response?: { data?: { detail?: unknown } } }).response;
          if (typeof response?.data?.detail === "string") {
            setError(response.data.detail);
          } else if (Array.isArray(response?.data?.detail)) {
            setError(`Validation failed: ${response.data.detail.map((item) => JSON.stringify(item)).join("; ")}`);
          } else {
            setError("Failed to run screener");
          }
        } else {
          setError(err instanceof Error ? err.message : "Failed to run screener");
        }
      } finally {
        setLoading(false);
      }
    },
    [query, selectedPresetId, universe],
  );

  const value = useMemo<ScreenerContextValue>(
    () => ({
      loading,
      error,
      presets,
      savedScreens,
      publicScreens,
      tab,
      setTab,
      selectedPresetId,
      setSelectedPresetId,
      query,
      setQuery,
      universe,
      setUniverse,
      view,
      setView,
      result,
      selectedRow,
      setSelectedRow,
      refreshScreens,
      run,
    }),
    [
      loading,
      error,
      presets,
      savedScreens,
      publicScreens,
      tab,
      selectedPresetId,
      query,
      universe,
      view,
      result,
      selectedRow,
      refreshScreens,
      run,
    ],
  );

  return <ScreenerContext.Provider value={value}>{children}</ScreenerContext.Provider>;
}

export function useScreenerContext() {
  const ctx = useContext(ScreenerContext);
  if (!ctx) {
    throw new Error("useScreenerContext must be used inside ScreenerProvider");
  }
  return ctx;
}
