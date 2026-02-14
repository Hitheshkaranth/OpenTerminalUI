import { useMemo, useState } from "react";

import { getIndicatorDefaults, listIndicators } from "./IndicatorManager";
import { IndicatorParamEditor } from "./IndicatorParamEditor";
import type { IndicatorConfig } from "./types";

type Props = {
  symbol: string;
  activeIndicators: IndicatorConfig[];
  onChange: (next: IndicatorConfig[]) => void;
};

const MAX_ACTIVE = 8;

export function IndicatorPanel({ symbol, activeIndicators, onChange }: Props) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const all = useMemo(() => listIndicators(), []);

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = all.filter((i) => !q || i.name.toLowerCase().includes(q) || i.id.includes(q));
    const map = new Map<string, typeof rows>();
    for (const r of rows) {
      if (!map.has(r.category)) map.set(r.category, []);
      map.get(r.category)?.push(r);
    }
    return Array.from(map.entries());
  }, [all, search]);

  const activeSet = useMemo(() => new Set(activeIndicators.map((a) => a.id)), [activeIndicators]);
  const editingConfig = useMemo(() => activeIndicators.find((x) => x.id === editingId) || null, [activeIndicators, editingId]);

  const toggle = (id: string) => {
    if (activeSet.has(id)) {
      onChange(activeIndicators.filter((a) => a.id !== id));
      return;
    }
    if (activeIndicators.length >= MAX_ACTIVE) return;
    const defaults = getIndicatorDefaults(id);
    onChange([
      ...activeIndicators,
      {
        id,
        params: defaults.params,
        visible: true,
      },
    ]);
  };

  return (
    <div className="relative rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-terminal-accent">Indicators</div>
        <div className="text-[11px] text-terminal-muted">Active: {activeIndicators.length}</div>
      </div>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search indicator"
        className="mb-2 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs text-terminal-text outline-none focus:border-terminal-accent"
      />
      <div className="max-h-72 space-y-2 overflow-auto pr-1">
        {grouped.map(([category, items]) => {
          const isOpen = expanded[category] ?? true;
          return (
            <div key={category}>
              <button
                className="mb-1 w-full text-left text-[11px] uppercase tracking-wide text-terminal-muted"
                onClick={() => setExpanded((prev) => ({ ...prev, [category]: !isOpen }))}
              >
                {isOpen ? "▼" : "▶"} {category}
              </button>
              {isOpen && (
                <div className="space-y-1">
                  {items.map((item) => {
                    const active = activeSet.has(item.id);
                    const current = activeIndicators.find((x) => x.id === item.id);
                    return (
                      <div key={item.id} className="flex items-center gap-1">
                        <button
                          className={`flex-1 rounded border px-2 py-1 text-left text-xs ${
                            active
                              ? "border-terminal-accent bg-terminal-accent/20 text-terminal-accent"
                              : "border-terminal-border text-terminal-text"
                          }`}
                          onClick={() => toggle(item.id)}
                          title={item.id}
                        >
                          {active ? "☑" : "☐"} {item.name}
                        </button>
                        {active && (
                          <>
                            <button
                              className="rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-muted"
                              onClick={() => setEditingId(item.id)}
                            >
                              ⚙
                            </button>
                            <button
                              className="rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-muted"
                              onClick={() => onChange(activeIndicators.filter((x) => x.id !== item.id))}
                            >
                              ✕
                            </button>
                          </>
                        )}
                        {active && current?.params && (
                          <div className="hidden text-[10px] text-terminal-muted xl:block">
                            {Object.values(current.params).slice(0, 3).join(",")}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <div className="text-[11px] text-terminal-muted">{symbol.toUpperCase()}</div>
        <button className="text-[11px] text-terminal-accent" onClick={() => onChange([])}>
          Clear all
        </button>
      </div>
      {editingConfig && (
        <IndicatorParamEditor
          config={editingConfig}
          onClose={() => setEditingId(null)}
          onSave={(next) => {
            onChange(activeIndicators.map((x) => (x.id === next.id ? next : x)));
            setEditingId(null);
          }}
        />
      )}
    </div>
  );
}
