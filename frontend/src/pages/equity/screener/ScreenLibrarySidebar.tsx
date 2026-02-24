import { TerminalButton } from "../../../components/terminal/TerminalButton";
import { TerminalPanel } from "../../../components/terminal/TerminalPanel";
import { useScreenerContext } from "./ScreenerContext";

const CATEGORY_ORDER = ["guru", "ideas", "valuation", "quality", "technical", "shareholding", "thematic", "quant"];

export function ScreenLibrarySidebar() {
  const { presets, selectedPresetId, setSelectedPresetId, setTab, run } = useScreenerContext();

  return (
    <TerminalPanel title="Screener Library" subtitle="Preset Screens" className="h-full" bodyClassName="space-y-3 overflow-auto">
      {CATEGORY_ORDER.map((category) => {
        const items = presets.filter((preset) => preset.category === category);
        if (!items.length) return null;
        return (
          <section key={category} className="space-y-1">
            <div className="text-[10px] uppercase tracking-wide text-terminal-muted">{category}</div>
            <div className="space-y-1">
              {items.map((preset) => (
                <TerminalButton
                  key={preset.id}
                  variant={selectedPresetId === preset.id ? "accent" : "default"}
                  className="w-full justify-start text-left normal-case tracking-normal"
                  title={preset.description}
                  onClick={() => {
                    setTab("library");
                    setSelectedPresetId(preset.id);
                    void run({ preset_id: preset.id });
                  }}
                >
                  {preset.name}
                </TerminalButton>
              ))}
            </div>
          </section>
        );
      })}
    </TerminalPanel>
  );
}
