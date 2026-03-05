import { useEffect, useMemo, useState } from "react";

import {
  CUSTOM_JS_INDICATORS_UPDATED_EVENT,
  getIndicatorDefaults,
  listIndicators,
  removeCustomJsIndicator,
  upsertCustomJsIndicator,
} from "./IndicatorManager";
import { IndicatorParamEditor } from "./IndicatorParamEditor";
import type { IndicatorConfig } from "./types";

type Props = {
  symbol: string;
  activeIndicators: IndicatorConfig[];
  onChange: (next: IndicatorConfig[]) => void;
  templateScope?: "equity" | "fno";
};

const MAX_ACTIVE = 8;

export function IndicatorPanel({ symbol, activeIndicators, onChange, templateScope = "equity" }: Props) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [customName, setCustomName] = useState("");
  const [customOverlay, setCustomOverlay] = useState(true);
  const [customScript, setCustomScript] = useState(
    "function calculate(bars, params) {\n  return {\n    plots: {\n      line: bars.map((bar) => ({ time: bar.time, value: Number(bar.close) }))\n    }\n  };\n}",
  );
  const [customError, setCustomError] = useState<string | null>(null);
  const all = useMemo(() => listIndicators(), [catalogVersion]);
  const templateStorageKey = `chart:indicator-templates:${templateScope}`;

  useEffect(() => {
    const onCatalogUpdate = () => setCatalogVersion((v) => v + 1);
    window.addEventListener(CUSTOM_JS_INDICATORS_UPDATED_EVENT, onCatalogUpdate);
    return () => window.removeEventListener(CUSTOM_JS_INDICATORS_UPDATED_EVENT, onCatalogUpdate);
  }, []);

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
  const templates = useMemo(() => {
    try {
      const raw = localStorage.getItem(templateStorageKey);
      const data = raw ? JSON.parse(raw) : {};
      return typeof data === "object" && data ? (data as Record<string, IndicatorConfig[]>) : {};
    } catch {
      return {};
    }
  }, [activeIndicators, templateStorageKey]);

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
  const saveTemplate = () => {
    const name = templateName.trim();
    if (!name || !activeIndicators.length) return;
    const next = { ...templates, [name]: activeIndicators };
    localStorage.setItem(templateStorageKey, JSON.stringify(next));
    setTemplateName("");
    setSelectedTemplate(name);
  };
  const loadTemplate = () => {
    const rows = templates[selectedTemplate];
    if (!rows?.length) return;
    onChange(rows.map((row) => ({ ...row, params: { ...(row.params || {}) } })));
  };
  const toggleVisibility = (id: string) => {
    onChange(activeIndicators.map((row) => (row.id === id ? { ...row, visible: !row.visible } : row)));
  };
  const resetIndicatorParams = (id: string) => {
    const defaults = getIndicatorDefaults(id).params;
    onChange(
      activeIndicators.map((row) => (row.id === id ? { ...row, params: { ...(defaults || {}) } } : row)),
    );
  };
  const resetAllParams = () => {
    onChange(
      activeIndicators.map((row) => {
        const defaults = getIndicatorDefaults(row.id).params;
        return {
          ...row,
          params: { ...(defaults || {}) },
        };
      }),
    );
  };
  const saveCustomScript = () => {
    try {
      setCustomError(null);
      const stored = upsertCustomJsIndicator({
        id: customName || "custom-indicator",
        name: customName || "Custom Indicator",
        category: "Custom JS",
        overlay: customOverlay,
        defaultInputs: {},
        script: customScript,
      });
      setCustomName(stored.name);
      setCatalogVersion((v) => v + 1);
    } catch (error) {
      setCustomError(error instanceof Error ? error.message : "Failed to save custom script");
    }
  };
  const deleteCustomScript = (id: string) => {
    removeCustomJsIndicator(id);
    onChange(activeIndicators.filter((row) => row.id !== id));
    setCatalogVersion((v) => v + 1);
  };

  return (
    <div className="relative rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-terminal-accent">Indicators</div>
        <div className="flex items-center gap-2">
          <div className="text-[11px] text-terminal-muted">Active: {activeIndicators.length}</div>
          <button
            className="rounded border border-terminal-border px-2 py-1 text-[10px] text-terminal-muted hover:text-terminal-text"
            onClick={resetAllParams}
            disabled={!activeIndicators.length}
            data-testid="indicator-reset-all"
          >
            Reset params
          </button>
        </div>
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
                {isOpen ? "v" : ">"} {category}
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
                          {active ? "[x]" : "[ ]"} {item.name}
                        </button>
                        {active && (
                          <>
                            <button
                              className="rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-muted"
                              onClick={() => setEditingId(item.id)}
                            >cfg</button>
                            <button
                              className="rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-muted"
                              onClick={() => toggleVisibility(item.id)}
                              data-testid={`indicator-visibility-${item.id}`}
                            >{current?.visible ? "hide" : "show"}</button>
                            <button
                              className="rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-muted"
                              onClick={() => resetIndicatorParams(item.id)}
                              data-testid={`indicator-reset-${item.id}`}
                            >rst</button>
                            <button
                              className="rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-muted"
                              onClick={() => onChange(activeIndicators.filter((x) => x.id !== item.id))}
                            >del</button>
                          </>
                        )}
                        {active && current?.params && (
                          <div className="hidden text-[10px] text-terminal-muted xl:block">
                            {Object.values(current.params).slice(0, 3).join(",")}
                          </div>
                        )}
                        {!active && item.isCustom ? (
                          <button
                            className="rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-muted"
                            onClick={() => deleteCustomScript(item.id)}
                            title="Delete custom script"
                          >
                            rm
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-2 space-y-2 rounded border border-terminal-border p-2">
        <div className="text-[11px] uppercase tracking-wide text-terminal-muted">Templates</div>
        <div className="flex items-center gap-1">
          <input
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder="Template name"
            className="min-w-0 flex-1 rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs text-terminal-text outline-none focus:border-terminal-accent"
          />
          <button className="rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-accent" onClick={saveTemplate}>
            Save
          </button>
        </div>
        <div className="flex items-center gap-1">
          <select
            className="min-w-0 flex-1 rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs text-terminal-text outline-none"
            value={selectedTemplate}
            onChange={(e) => setSelectedTemplate(e.target.value)}
          >
            <option value="">Select template</option>
            {Object.keys(templates).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button className="rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-accent" onClick={loadTemplate}>
            Load
          </button>
        </div>
        <div className="rounded border border-terminal-border p-2">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-terminal-muted">Custom JS</div>
          <input
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder="Custom indicator name"
            className="mb-1 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs text-terminal-text outline-none focus:border-terminal-accent"
          />
          <label className="mb-1 flex items-center gap-2 text-[11px] text-terminal-muted">
            <input type="checkbox" checked={customOverlay} onChange={(e) => setCustomOverlay(e.target.checked)} />
            Overlay on main chart
          </label>
          <textarea
            value={customScript}
            onChange={(e) => setCustomScript(e.target.value)}
            className="h-28 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs text-terminal-text outline-none focus:border-terminal-accent"
            spellCheck={false}
          />
          <div className="mt-1 flex items-center justify-between gap-2">
            <button
              className="rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-accent"
              onClick={saveCustomScript}
            >
              Save JS
            </button>
            {customError ? <span className="text-[10px] text-terminal-neg">{customError}</span> : null}
          </div>
        </div>
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
