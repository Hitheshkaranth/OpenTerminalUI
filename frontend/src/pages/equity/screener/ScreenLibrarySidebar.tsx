import { useMemo, useState } from "react";
import { TerminalButton } from "../../../components/terminal/TerminalButton";
import { TerminalCombobox } from "../../../components/terminal/TerminalCombobox";
import { TerminalPanel } from "../../../components/terminal/TerminalPanel";
import { useScreenerContext } from "./ScreenerContext";

const CATEGORY_ORDER = ["guru", "ideas", "valuation", "quality", "technical", "shareholding", "thematic", "quant"];

export function ScreenLibrarySidebar() {
  const { presets, selectedPresetId, setSelectedPresetId, setTab, run } = useScreenerContext();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const searchablePresets = useMemo(
    () =>
      presets.filter((preset) => {
        const q = query.trim().toLowerCase();
        if (!q) return false;
        return (
          preset.name.toLowerCase().includes(q) ||
          String(preset.category || "").toLowerCase().includes(q) ||
          String(preset.description || "").toLowerCase().includes(q)
        );
      }),
    [presets, query],
  );

  const runPreset = (presetId: string) => {
    setTab("library");
    setSelectedPresetId(presetId);
    void run({ preset_id: presetId });
  };

  return (
    <TerminalPanel title="Screener Library" subtitle="Preset Screens" className="h-full" bodyClassName="space-y-3 overflow-auto">
      <TerminalCombobox
        value={query}
        onChange={(value) => {
          setQuery(value);
          setOpen(Boolean(value.trim()));
          setSelectedIdx(0);
        }}
        onFocus={() => query.trim() && setOpen(true)}
        onKeyDown={(event) => {
          if (!open) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setSelectedIdx((i) => Math.min(i + 1, searchablePresets.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setSelectedIdx((i) => Math.max(i - 1, 0));
          } else if (event.key === "Enter" && searchablePresets[selectedIdx]) {
            event.preventDefault();
            runPreset(searchablePresets[selectedIdx].id);
            setOpen(false);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder="Search presets"
        open={open}
        items={searchablePresets.slice(0, 8)}
        selectedIndex={selectedIdx}
        onSelect={(preset) => {
          runPreset(preset.id);
          setOpen(false);
        }}
        getItemKey={(preset) => preset.id}
        inputClassName="min-h-8 px-2 py-1 text-xs"
        listClassName="max-h-56 overflow-auto rounded-sm border border-terminal-border bg-terminal-panel p-1 shadow-lg"
        itemClassName=""
        renderItem={(preset, meta) => (
          <div className={`rounded-sm px-2 py-1 ${meta.selected ? "bg-terminal-accent/15 text-terminal-accent" : "hover:bg-terminal-bg"}`}>
            <div className="text-xs">{preset.name}</div>
            <div className="text-[10px] text-terminal-muted">{preset.category}</div>
          </div>
        )}
      />
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
                    runPreset(preset.id);
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
