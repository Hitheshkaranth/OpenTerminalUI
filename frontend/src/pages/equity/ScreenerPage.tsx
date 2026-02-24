import { useEffect, useState } from "react";

import { TerminalBadge } from "../../components/terminal/TerminalBadge";
import { TerminalButton } from "../../components/terminal/TerminalButton";
import { TerminalInput } from "../../components/terminal/TerminalInput";
import { TerminalPanel } from "../../components/terminal/TerminalPanel";

import { AlternateDataFilter } from "./screener/AlternateDataFilter";
import { AdvancedArithmetic } from "./screener/AdvancedArithmetic";
import { CompanyDetailDrawer } from "./screener/CompanyDetailDrawer";
import { FilterChips } from "./screener/FilterChips";
import { PublicScreens } from "./screener/PublicScreens";
import { QueryBar } from "./screener/QueryBar";
import { QueryBuilder } from "./screener/QueryBuilder";
import { ResultsTable } from "./screener/ResultsTable";
import { SaveScreenDialog } from "./screener/SaveScreenDialog";
import { SavedScreens } from "./screener/SavedScreens";
import { ScreenLibrarySidebar } from "./screener/ScreenLibrarySidebar";
import { ScreenerProvider, useScreenerContext } from "./screener/ScreenerContext";
import { StatusBar } from "./screener/StatusBar";
import { ViewToggle } from "./screener/ViewToggle";
import { ScreenVizLoader } from "./screener/viz/ScreenVizLoader";

function ScreenerWorkspace() {
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const {
    error,
    loading,
    tab,
    setTab,
    result,
    view,
    selectedPresetId,
    presets,
    setSelectedPresetId,
    run,
    selectedRow,
  } = useScreenerContext();

  useEffect(() => {
    if (!selectedRow) {
      setMobileDetailOpen(false);
    }
  }, [selectedRow]);

  return (
    <div className="grid h-full grid-cols-1 gap-3 p-3 md:p-4 xl:grid-cols-[260px_minmax(0,1fr)_340px]">
      <div className="hidden xl:block">
        <ScreenLibrarySidebar />
      </div>

      <main className="min-w-0 space-y-3">
        <TerminalPanel title="Quick Preset" subtitle="Mobile Selector" className="xl:hidden">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <TerminalInput
              as="select"
              value={selectedPresetId || ""}
              onChange={(event) => setSelectedPresetId(event.target.value || null)}
            >
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </TerminalInput>
            <TerminalButton
              variant="accent"
              onClick={() => {
                if (!selectedPresetId) return;
                void run({ preset_id: selectedPresetId });
              }}
            >
              Run
            </TerminalButton>
          </div>
        </TerminalPanel>

        <TerminalPanel title="Workspace" subtitle="Screener" actions={<TerminalBadge variant="live">revamped</TerminalBadge>}>
          <div className="flex flex-wrap gap-1 text-xs">
            {[
              ["library", "Screens Library"],
              ["custom", "Custom Query"],
              ["saved", "Saved Screens"],
              ["public", "Public Screens"],
            ].map(([id, label]) => (
              <TerminalButton key={id} variant={tab === id ? "accent" : "default"} onClick={() => setTab(id as typeof tab)}>
                {label}
              </TerminalButton>
            ))}
          </div>
        </TerminalPanel>

        <QueryBar />
        <FilterChips />
        <ViewToggle />

        {error ? <div className="rounded-sm border border-terminal-neg bg-terminal-neg/10 p-2 text-xs text-terminal-neg">{error}</div> : null}
        {loading ? <div className="rounded-sm border border-terminal-border p-2 text-xs text-terminal-muted">Running screener...</div> : null}

        {tab === "custom" ? (
          <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <QueryBuilder />
            <div className="space-y-3">
              <AlternateDataFilter />
              <AdvancedArithmetic />
              <SaveScreenDialog />
            </div>
          </section>
        ) : null}

        {tab === "saved" ? <SavedScreens /> : null}
        {tab === "public" ? <PublicScreens /> : null}

        {view === "table" || view === "split" ? <ResultsTable /> : null}
        {view !== "table" ? <ScreenVizLoader screenId={selectedPresetId} vizData={(result?.viz_data || {}) as Record<string, unknown>} /> : null}
        {selectedRow && mobileDetailOpen ? (
          <div className="xl:hidden">
            <CompanyDetailDrawer />
          </div>
        ) : null}

        <StatusBar />
      </main>

      <div className="hidden xl:block">
        <CompanyDetailDrawer />
      </div>

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
