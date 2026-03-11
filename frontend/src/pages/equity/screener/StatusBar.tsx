import { useState } from "react";

import { exportScreenerV3 } from "../../../api/client";
import { TerminalBadge } from "../../../components/terminal/TerminalBadge";
import { TerminalButton } from "../../../components/terminal/TerminalButton";
import { TerminalPanel } from "../../../components/terminal/TerminalPanel";
import { useScreenerContext } from "./ScreenerContext";

export function StatusBar() {
  const {
    result,
    universe,
    tab,
    selectedPresetId,
    presets,
    activeSavedScreenId,
    savedScreens,
  } = useScreenerContext();
  const [exporting, setExporting] = useState<"csv" | "xlsx" | "pdf" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = result?.results || [];
  const activePreset = presets.find((preset) => preset.id === selectedPresetId) ?? null;
  const activeSavedScreen = savedScreens.find((screen) => screen.id === activeSavedScreenId) ?? null;
  const activeLabel = activeSavedScreen
    ? `Saved: ${activeSavedScreen.name}`
    : activePreset
      ? `Preset: ${activePreset.name}`
      : "Custom query";

  async function runExport(format: "csv" | "xlsx" | "pdf") {
    if (!rows.length) return;
    setError(null);
    setExporting(format);
    try {
      const blob = await exportScreenerV3(format, {
        rows,
        title: "Screener Export",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `screener-${Date.now()}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export results");
    } finally {
      setExporting(null);
    }
  }

  return (
    <TerminalPanel title="Status" subtitle="Result Snapshot">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="text-terminal-muted">
          {result?.total_results ?? 0} results | Universe: {universe} | Tab: {tab} | {activeLabel}
        </div>
        <div className="flex flex-wrap gap-1">
          <TerminalButton size="sm" variant="default" loading={exporting === "csv"} disabled={!rows.length} onClick={() => void runExport("csv")}>Export CSV</TerminalButton>
          <TerminalButton size="sm" variant="default" loading={exporting === "xlsx"} disabled={!rows.length} onClick={() => void runExport("xlsx")}>Export XLSX</TerminalButton>
          <TerminalButton size="sm" variant="default" loading={exporting === "pdf"} disabled={!rows.length} onClick={() => void runExport("pdf")}>Export PDF</TerminalButton>
        </div>
      </div>
      {error ? <div className="mt-2 rounded-sm border border-terminal-neg bg-terminal-neg/10 px-2 py-1 text-xs text-terminal-neg">{error}</div> : null}
      {!rows.length ? <div className="mt-2 text-[11px] text-terminal-muted">Run a screen to enable exports.</div> : null}
      {rows.length ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <TerminalBadge variant="live">{rows.length} preview rows ready</TerminalBadge>
          <TerminalBadge variant="neutral">{result?.execution_time_ms ?? 0} ms</TerminalBadge>
          <TerminalBadge variant="info">{activeLabel}</TerminalBadge>
        </div>
      ) : null}
    </TerminalPanel>
  );
}
