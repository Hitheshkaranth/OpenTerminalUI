import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Bookmark,
  ChevronDown,
  Columns3,
  Filter,
  LayoutDashboard,
  LineChart,
  Play,
  Search,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Table2,
  Trees,
} from "lucide-react";

import { TerminalBadge } from "../../components/terminal/TerminalBadge";
import { TerminalButton } from "../../components/terminal/TerminalButton";
import { TerminalInput } from "../../components/terminal/TerminalInput";
import { TerminalPanel } from "../../components/terminal/TerminalPanel";
import { AiInsightCard } from "../../components/terminal/AiInsightCard";
import { SavedViewsControl } from "../../components/savedViews/SavedViewsControl";

import { fetchCollectionBriefing } from "../../api/client";

import { AlternateDataFilter } from "./screener/AlternateDataFilter";
import { AdvancedArithmetic } from "./screener/AdvancedArithmetic";
import { CompanyDetailDrawer } from "./screener/CompanyDetailDrawer";
import { CustomFormulaScreener } from "./screener/CustomFormulaScreener";
import { PublicScreens } from "./screener/PublicScreens";
import { QueryBar } from "./screener/QueryBar";
import { QueryBuilder } from "./screener/QueryBuilder";
import { ResultsTable } from "./screener/ResultsTable";
import { SaveScreenDialog } from "./screener/SaveScreenDialog";
import { SavedScreens } from "./screener/SavedScreens";
import { ScreenerProvider, useScreenerContext } from "./screener/ScreenerContext";
import { StatusBar } from "./screener/StatusBar";
import { MultiMarketScanPanel } from "./screener/MultiMarketScanPanel";
import { ScreenVizLoader } from "./screener/viz/ScreenVizLoader";
import type { ScreenerTab, ScreenerView } from "./screener/ScreenerContext";

const categoryLabels: Record<string, string> = {
  guru: "Guru",
  ideas: "Ideas",
  valuation: "Value",
  quality: "Quality",
  technical: "Technical",
  shareholding: "Ownership",
  thematic: "Themes",
  quant: "Quant",
};

const tabItems: Array<{ id: ScreenerTab; label: string; icon: typeof Sparkles }> = [
  { id: "library", label: "Library", icon: Sparkles },
  { id: "custom", label: "Custom", icon: SlidersHorizontal },
  { id: "formula", label: "Custom Formula", icon: Columns3 },
  { id: "saved", label: "Saved", icon: Bookmark },
  { id: "public", label: "Public", icon: Share2 },
];

const viewItems: Array<{ id: ScreenerView; label: string; icon: typeof Table2 }> = [
  { id: "table", label: "Table", icon: Table2 },
  { id: "split", label: "Split", icon: LayoutDashboard },
  { id: "charts", label: "Charts", icon: LineChart },
  { id: "treemap", label: "Map", icon: Trees },
  { id: "scatter", label: "Scatter", icon: BarChart3 },
  { id: "scorecard", label: "Scores", icon: Sparkles },
];

function splitFilters(query: string) {
  return query.split(/\bAND\b/i).map((piece) => piece.trim()).filter(Boolean);
}

function ScreenerWorkspace() {
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [queryOpen, setQueryOpen] = useState(true);
  const [scanOpen, setScanOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const {
    error,
    loading,
    tab,
    setTab,
    result,
    view,
    query,
    universe,
    selectedPresetId,
    presets,
    setSelectedPresetId,
    activeSavedScreenId,
    savedScreens,
    run,
    selectedRow,
    universes,
    setUniverse,
    setView,
  } = useScreenerContext();

  const activePreset = presets.find((preset) => preset.id === selectedPresetId) ?? null;
  const activeSavedScreen = savedScreens.find((screen) => screen.id === activeSavedScreenId) ?? null;
  const activeLabel = activeSavedScreen?.name ?? activePreset?.name ?? "Custom query";
  const filters = useMemo(() => splitFilters(query), [query]);
  const resultCount = result?.total_results ?? result?.results.length ?? 0;
  const executionMs = result?.execution_time_ms ?? 0;
  const filteredPresets = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const base = q
      ? presets.filter((preset) =>
          [preset.name, preset.category, preset.description].some((value) => String(value || "").toLowerCase().includes(q)),
        )
      : presets;
    return base.slice(0, q ? 12 : 10);
  }, [presets, searchTerm]);
  const featuredPresets = useMemo(() => {
    const seen = new Set<string>();
    const out = [];
    for (const preset of presets) {
      const category = String(preset.category || "ideas");
      if (seen.has(category)) continue;
      seen.add(category);
      out.push(preset);
      if (out.length >= 8) break;
    }
    return out;
  }, [presets]);

  useEffect(() => {
    if (!selectedRow) {
      setMobileDetailOpen(false);
    }
  }, [selectedRow]);

  const runActive = () => {
    void run({ query: activeSavedScreen?.query ?? query, preset_id: activeSavedScreen ? null : selectedPresetId });
  };

  const runPreset = (presetId: string) => {
    setTab("library");
    setSelectedPresetId(presetId);
    void run({ preset_id: presetId });
  };

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_top_left,rgba(255,107,0,0.08),transparent_34rem)] p-3 md:p-5">
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-4">
        <section className="rounded-md border border-terminal-border/70 bg-terminal-panel/95 p-4 shadow-[0_10px_30px_rgba(0,0,0,0.18)] md:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <TerminalBadge variant="accent">Equity Screener</TerminalBadge>
                <TerminalBadge variant="neutral">{universe}</TerminalBadge>
                {activePreset?.category ? <TerminalBadge variant="info">{categoryLabels[activePreset.category] ?? activePreset.category}</TerminalBadge> : null}
              </div>
              <h1 className="max-w-4xl font-sans text-2xl font-semibold tracking-normal text-terminal-text md:text-3xl">
                Find stocks that match your investing style.
              </h1>
              <p className="mt-2 max-w-3xl font-sans text-sm leading-6 text-terminal-muted">
                Start from a proven screen, adjust the rules only when needed, then inspect why each result ranked.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs md:min-w-[420px]">
              <div className="rounded-md border border-terminal-border bg-terminal-bg/70 p-3">
                <div className="font-sans text-[11px] text-terminal-muted">Matches</div>
                <div className="mt-1 text-xl font-semibold text-terminal-text">{resultCount.toLocaleString("en-IN")}</div>
              </div>
              <div className="rounded-md border border-terminal-border bg-terminal-bg/70 p-3">
                <div className="font-sans text-[11px] text-terminal-muted">Active screen</div>
                <div className="mt-1 truncate text-sm font-semibold text-terminal-text" title={activeLabel}>{activeLabel}</div>
              </div>
              <div className="rounded-md border border-terminal-border bg-terminal-bg/70 p-3">
                <div className="font-sans text-[11px] text-terminal-muted">Runtime</div>
                <div className="mt-1 text-xl font-semibold text-terminal-text">{executionMs ? `${executionMs} ms` : "--"}</div>
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
              <label className="block">
                <span className="mb-1 block font-sans text-xs text-terminal-muted">Search screens</span>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-terminal-muted" aria-hidden="true" />
                  <TerminalInput
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    className="pl-9"
                    tone="ui"
                    placeholder="Quality, value, momentum, dividend..."
                  />
                </div>
              </label>
              <label className="block">
                <span className="mb-1 block font-sans text-xs text-terminal-muted">Universe</span>
                <TerminalInput as="select" value={universe} onChange={(event) => setUniverse(event.target.value)} tone="ui">
                  {universes.length > 0 ? (
                    universes.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))
                  ) : (
                    <option value={universe}>{universe}</option>
                  )}
                </TerminalInput>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <SavedViewsControl
                pageLabel="Screener"
                capture={() => ({
                  filters: { query, universe, selectedPresetId },
                  activeTabs: { tab, view },
                  tableColumns: "results-default",
                  selectedTicker: typeof selectedRow?.ticker === "string" ? selectedRow.ticker : undefined,
                })}
              />
              <TerminalButton variant="accent" size="lg" loading={loading} onClick={runActive} leftIcon={<Play className="h-4 w-4" />}>
                Run screen
              </TerminalButton>
            </div>
          </div>

          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {(searchTerm ? filteredPresets : featuredPresets).map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={[
                  "min-w-[180px] rounded-md border p-3 text-left transition-colors",
                  selectedPresetId === preset.id
                    ? "border-terminal-accent bg-terminal-accent/15 text-terminal-text"
                    : "border-terminal-border bg-terminal-bg/60 text-terminal-muted hover:border-terminal-border-hover hover:text-terminal-text",
                ].join(" ")}
                onClick={() => runPreset(preset.id)}
                title={preset.description}
              >
                <div className="font-sans text-sm font-semibold normal-case tracking-normal">{preset.name}</div>
                <div className="mt-1 font-sans text-[11px] text-terminal-muted">{categoryLabels[preset.category] ?? preset.category ?? "Screen"}</div>
              </button>
            ))}
          </div>
        </section>

        <section className={`grid gap-4 ${selectedRow ? "xl:grid-cols-[minmax(0,1fr)_360px]" : "xl:grid-cols-1"}`}>
          <div className="min-w-0 space-y-4">
            <TerminalPanel
              title="Screen Setup"
              subtitle={activeLabel}
              actions={
                <div className="flex flex-wrap gap-1">
                  {tabItems.map((item) => {
                    const Icon = item.icon;
                    return (
                      <TerminalButton key={item.id} size="sm" variant={tab === item.id ? "accent" : "ghost"} onClick={() => setTab(item.id)} leftIcon={<Icon className="h-3.5 w-3.5" />}>
                        {item.label}
                      </TerminalButton>
                    );
                  })}
                </div>
              }
            >
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                <div className="min-w-0">
                  <div className="mb-2 flex items-center gap-2 font-sans text-xs text-terminal-muted">
                    <Filter className="h-4 w-4" aria-hidden="true" />
                    <span>{filters.length} active filters</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {filters.slice(0, 6).map((chip, idx) => (
                      <span key={`${chip}-${idx}`} className="rounded-full border border-terminal-border bg-terminal-bg px-2.5 py-1 font-sans text-[11px] text-terminal-text">
                        {chip}
                      </span>
                    ))}
                    {filters.length > 6 ? <span className="rounded-full border border-terminal-border px-2.5 py-1 font-sans text-[11px] text-terminal-muted">+{filters.length - 6} more</span> : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <TerminalButton size="sm" variant={queryOpen ? "accent" : "default"} onClick={() => setQueryOpen((open) => !open)} rightIcon={<ChevronDown className="h-3.5 w-3.5" />}>
                    Edit rules
                  </TerminalButton>
                  <TerminalButton size="sm" variant={scanOpen ? "accent" : "default"} onClick={() => setScanOpen((open) => !open)} rightIcon={<ChevronDown className="h-3.5 w-3.5" />}>
                    Multi-market
                  </TerminalButton>
                  <TerminalButton size="sm" variant={aiOpen ? "accent" : "default"} onClick={() => setAiOpen((open) => !open)} rightIcon={<ChevronDown className="h-3.5 w-3.5" />}>
                    AI brief
                  </TerminalButton>
                </div>
              </div>
            </TerminalPanel>

            {error ? <div className="rounded-md border border-terminal-neg bg-terminal-neg/10 p-3 font-sans text-sm text-terminal-neg">{error}</div> : null}
            {loading ? <div className="rounded-md border border-terminal-border bg-terminal-bg/80 p-3 font-sans text-sm text-terminal-muted">Running screen and ranking results...</div> : null}

            {queryOpen ? (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <QueryBar />
                {tab === "custom" ? (
                  <div className="space-y-3">
                    <QueryBuilder />
                    <AlternateDataFilter />
                    <AdvancedArithmetic />
                    <SaveScreenDialog />
                  </div>
                ) : null}
              </div>
            ) : null}

            {scanOpen ? <MultiMarketScanPanel /> : null}

            {tab === "formula" ? <CustomFormulaScreener /> : null}
            {tab === "saved" ? <SavedScreens /> : null}
            {tab === "public" ? <PublicScreens /> : null}

            {aiOpen && tab !== "saved" && tab !== "public" && result && result.results.length > 0 ? (
              <AiInsightCard
                title="AI Screener Analysis"
                description={`Assessment of the top ${Math.min(result.results.length, 10)} results in this screen`}
                fetcher={() => fetchCollectionBriefing(result.results.slice(0, 10).map((i: any) => String(i.ticker || i.symbol || "")), "screen results")}
              />
            ) : null}

            <TerminalPanel
              title="Results"
              subtitle={result ? `${resultCount.toLocaleString("en-IN")} matches` : "Run a screen to populate ranked stocks"}
              actions={
                <div className="flex flex-wrap gap-1">
                  {viewItems.map((item) => {
                    const Icon = item.icon;
                    return (
                      <TerminalButton key={item.id} size="sm" variant={view === item.id ? "accent" : "ghost"} onClick={() => setView(item.id)} leftIcon={<Icon className="h-3.5 w-3.5" />}>
                        {item.label}
                      </TerminalButton>
                    );
                  })}
                </div>
              }
            >
              {view === "table" || view === "split" ? <ResultsTable framed={false} /> : null}
              {view !== "table" ? (
                <div className={view === "split" ? "mt-3" : ""}>
                  <ScreenVizLoader screenId={selectedPresetId} view={view} vizData={(result?.viz_data || {}) as Record<string, unknown>} rows={(result?.results || []) as Array<Record<string, unknown>>} />
                </div>
              ) : null}
            </TerminalPanel>

            {result ? <StatusBar /> : null}
          </div>

          {selectedRow ? <aside className="hidden xl:block">
            <CompanyDetailDrawer />
          </aside> : null}
        </section>

      {selectedRow ? (
        <div className="fixed bottom-16 left-0 right-0 z-20 border-t border-terminal-border bg-terminal-panel/95 px-3 py-2 backdrop-blur md:hidden">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 text-xs text-terminal-muted">
              Selected:{" "}
              <span className="truncate text-terminal-text">
                {String(selectedRow.company || selectedRow.ticker || "Company")}
              </span>
            </div>
            <TerminalButton
              variant={mobileDetailOpen ? "default" : "accent"}
              className="min-h-9 px-3 py-1 text-[10px]"
              onClick={() => setMobileDetailOpen((open) => !open)}
            >
              {mobileDetailOpen ? "Hide Details" : "Open Details"}
            </TerminalButton>
          </div>
        </div>
      ) : null}
      {selectedRow && mobileDetailOpen ? (
        <div className="xl:hidden">
          <CompanyDetailDrawer />
        </div>
      ) : null}
      </main>
    </div>
  );
}

export function ScreenerPage() {
  return (
    <ScreenerProvider>
      <ScreenerWorkspace />
    </ScreenerProvider>
  );
}
