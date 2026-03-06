import type { ScannerPreset } from "../../types";

type Props = {
  presets: ScannerPreset[];
  selectedPresetId: string;
  limit: number;
  setupTypes: string[];
  selectedSetupType: string;
  minScore: number;
  sortBy: string;
  loading: boolean;
  onPresetChange: (value: string) => void;
  onLimitChange: (value: number) => void;
  onSetupTypeChange: (value: string) => void;
  onMinScoreChange: (value: number) => void;
  onSortByChange: (value: string) => void;
  onRun: () => void;
};

export function BreakoutScannerControls({
  presets,
  selectedPresetId,
  limit,
  setupTypes,
  selectedSetupType,
  minScore,
  sortBy,
  loading,
  onPresetChange,
  onLimitChange,
  onSetupTypeChange,
  onMinScoreChange,
  onSortByChange,
  onRun,
}: Props) {
  return (
    <section className="space-y-2 rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="text-sm font-semibold text-terminal-accent">Breakout Scanner</div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
        <label className="space-y-1">
          <div className="text-[11px] text-terminal-muted">Preset</div>
          <select
            data-testid="breakout-preset-select"
            className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs"
            value={selectedPresetId}
            onChange={(e) => onPresetChange(e.target.value)}
          >
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <div className="text-[11px] text-terminal-muted">Rows</div>
          <input
            data-testid="breakout-limit-input"
            type="number"
            min={5}
            max={200}
            value={limit}
            className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs"
            onChange={(e) => onLimitChange(Number(e.target.value))}
          />
        </label>
        <label className="space-y-1">
          <div className="text-[11px] text-terminal-muted">Setup</div>
          <select
            data-testid="breakout-setup-filter"
            className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs"
            value={selectedSetupType}
            onChange={(e) => onSetupTypeChange(e.target.value)}
          >
            <option value="ALL">All setups</option>
            {setupTypes.map((setup) => (
              <option key={setup} value={setup}>
                {setup.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <div className="text-[11px] text-terminal-muted">Min confidence</div>
          <input
            data-testid="breakout-min-score-input"
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={minScore}
            className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs"
            onChange={(e) => onMinScoreChange(Number(e.target.value))}
          />
        </label>
        <label className="space-y-1">
          <div className="text-[11px] text-terminal-muted">Sort</div>
          <select
            data-testid="breakout-sort-select"
            className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs"
            value={sortBy}
            onChange={(e) => onSortByChange(e.target.value)}
          >
            <option value="score_desc">Score (high-low)</option>
            <option value="score_asc">Score (low-high)</option>
            <option value="symbol_asc">Symbol (A-Z)</option>
            <option value="symbol_desc">Symbol (Z-A)</option>
            <option value="signal_desc">Signal (newest)</option>
          </select>
        </label>
        <div className="flex items-end justify-start">
          <button
            data-testid="breakout-run-button"
            type="button"
            className="rounded border border-terminal-accent bg-terminal-accent/20 px-3 py-1.5 text-xs text-terminal-accent disabled:opacity-60"
            onClick={onRun}
            disabled={loading || !selectedPresetId}
          >
            {loading ? "Running..." : "Run Breakout Scan"}
          </button>
        </div>
      </div>
    </section>
  );
}
