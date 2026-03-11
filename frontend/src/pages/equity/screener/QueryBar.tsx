import { TerminalBadge } from "../../../components/terminal/TerminalBadge";
import { TerminalButton } from "../../../components/terminal/TerminalButton";
import { TerminalInput } from "../../../components/terminal/TerminalInput";
import { TerminalPanel } from "../../../components/terminal/TerminalPanel";
import { useScreenerContext } from "./ScreenerContext";

export function QueryBar() {
  const {
    query,
    setQuery,
    run,
    loading,
    selectedPresetId,
    presets,
    activeSavedScreenId,
    savedScreens,
    tab,
    universe,
  } = useScreenerContext();
  const activePreset = presets.find((preset) => preset.id === selectedPresetId) ?? null;
  const activeSavedScreen = savedScreens.find((screen) => screen.id === activeSavedScreenId) ?? null;
  const activeLabel = activeSavedScreen
    ? `Saved screen: ${activeSavedScreen.name}`
    : activePreset
      ? `Preset: ${activePreset.name}`
      : "Custom query";

  return (
    <TerminalPanel
      title="Query"
      subtitle={activeLabel}
      actions={(
        <div className="flex gap-1">
          <TerminalButton variant="default" size="sm" onClick={() => void run({ query, preset_id: activeSavedScreen ? null : selectedPresetId })} disabled={loading}>
            {loading ? "Running" : "Run"}
          </TerminalButton>
          {activeSavedScreen || activePreset ? (
            <TerminalButton
              variant="accent"
              size="sm"
              onClick={() => void run({ query: activeSavedScreen?.query ?? query, preset_id: activeSavedScreen ? null : activePreset?.id ?? null })}
              disabled={loading}
            >
              Run Active
            </TerminalButton>
          ) : null}
        </div>
      )}
    >
      <div className="mb-2 flex flex-wrap gap-1">
        <TerminalBadge variant="accent">{tab}</TerminalBadge>
        <TerminalBadge variant="neutral">{universe}</TerminalBadge>
        {activePreset ? <TerminalBadge variant="info">{activePreset.category}</TerminalBadge> : null}
        {activeSavedScreen ? <TerminalBadge variant="live">{activeSavedScreen.name}</TerminalBadge> : null}
      </div>
      <TerminalInput
        as="textarea"
        rows={5}
        className="font-mono text-[11px]"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
    </TerminalPanel>
  );
}
