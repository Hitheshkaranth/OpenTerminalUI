import { useState } from "react";

import { TerminalPanel } from "../../components/terminal/TerminalPanel";
import { TerminalButton } from "../../components/terminal/TerminalButton";
import { TerminalInput } from "../../components/terminal/TerminalInput";
import { TerminalModal } from "../../components/terminal/TerminalModal";

import type { ShortcutDefinition, ShortcutCategory } from "../../lib/shortcuts";
import { SHORTCUT_DEFINITIONS, getShortcutsByCategory } from "../../lib/shortcuts";

const CATEGORY_COLORS: Record<string, string> = {
  global: "text-terminal-accent",
  navigation: "text-terminal-pos",
  charts: "text-terminal-warn",
  trading: "text-terminal-neg",
  screener: "text-terminal-accent",
};

function ShortcutKeyCombo({ keys }: { keys: string }) {
  const parts = keys.split(",").map((s) => s.trim());
  if (parts.length === 1) {
    const chords = parts[0].split("+");
    if (chords.length > 1) {
      return (
        <span className="inline-flex items-center gap-0.5">
          {chords.map((ch, i) => (
            <kbd key={i} className="inline-flex items-center justify-center rounded border border-terminal-border bg-terminal-bg px-1.5 py-0.5 font-mono text-[11px] font-semibold text-terminal-accent shadow-sm min-w-[22px]">
              {ch}
            </kbd>
          ))}
        </span>
      );
    }
    return (
      <kbd className="inline-flex items-center justify-center rounded border border-terminal-border bg-terminal-bg px-2 py-0.5 font-mono text-[11px] font-semibold text-terminal-accent shadow-sm min-w-[24px]">
        {parts[0]}
      </kbd>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5">
      {parts.map((chord, i) => {
        const keysArr = chord.split("+");
        return (
          <span key={i} className="inline-flex items-center gap-0.5">
            {keysArr.map((k, j) => (
              <kbd key={j} className="inline-flex items-center justify-center rounded border border-terminal-border bg-terminal-bg px-1.5 py-0.5 font-mono text-[11px] font-semibold text-terminal-accent shadow-sm min-w-[22px]">
                {k}
              </kbd>
            ))}
            {i < parts.length - 1 && <span className="px-0.5 text-[9px] text-terminal-muted">→</span>}
          </span>
        );
      })}
    </span>
  );
}

export function ShortcutsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<ShortcutCategory>("global");

  if (!isOpen) return null;

  const groups = getShortcutsByCategory();
  const categories: ShortcutCategory[] = ["global", "navigation", "charts", "trading", "screener"];

  let filteredDefs: ShortcutDefinition[] = SHORTCUT_DEFINITIONS;
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    filteredDefs = SHORTCUT_DEFINITIONS.filter(
      (s) => s.label.toLowerCase().includes(q) || s.keys.toLowerCase().includes(q) || s.category.toLowerCase().includes(q),
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl">
        <TerminalPanel
          title="Keyboard Shortcuts"
          subtitle={`Press Esc or click outside to close`}
          bodyClassName="p-0"
        >
          <div className="flex items-center justify-between border-b border-terminal-border px-4 py-2">
            <TerminalInput
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search shortcuts..."
              className="max-w-xs"
            />
            <TerminalButton variant="ghost" size="sm" onClick={onClose}>
              Close (Esc)
            </TerminalButton>
          </div>

          <div className="flex border-b border-terminal-border">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                className={`px-3 py-1.5 text-[11px] uppercase tracking-wider transition-colors ${
                  activeCategory === cat
                    ? `border-b-2 border-terminal-accent ${CATEGORY_COLORS[cat]}`
                    : "text-terminal-muted hover:text-terminal-text"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="overflow-y-auto" style={{ maxHeight: "60vh" }}>
            <table className="min-w-full border-collapse">
              <thead className="sticky top-0 bg-terminal-panel">
                <tr className="border-b border-terminal-border text-left">
                  <th className="px-4 py-1.5 text-[10px] uppercase tracking-wider text-terminal-muted font-normal">Shortcut</th>
                  <th className="px-4 py-1.5 text-[10px] uppercase tracking-wider text-terminal-muted font-normal">Action</th>
                  <th className="px-4 py-1.5 text-[10px] uppercase tracking-wider text-terminal-muted font-normal">Category</th>
                </tr>
              </thead>
              <tbody>
                {filteredDefs
                  .filter((s) => activeCategory === "global" || s.category === activeCategory)
                  .map((s) => (
                    <tr key={s.id} className="border-b border-terminal-border/40 hover:bg-terminal-bg/60">
                      <td className="px-4 py-2">
                        <ShortcutKeyCombo keys={s.keys} />
                      </td>
                      <td className="px-4 py-2 text-xs text-terminal-text">{s.label}</td>
                      <td className="px-4 py-2">
                        <span className={`text-[10px] uppercase tracking-wider ${CATEGORY_COLORS[s.category]}`}>
                          {s.category}
                        </span>
                      </td>
                    </tr>
                  ))}
                {filteredDefs.filter((s) => activeCategory === "global" || s.category === activeCategory).length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-xs text-terminal-muted">
                      No shortcuts found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </TerminalPanel>
      </div>
    </div>
  );
}