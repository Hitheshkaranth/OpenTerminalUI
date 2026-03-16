import Fuse from "fuse.js";
import { useEffect, useMemo, useState } from "react";

import {
  CUSTOM_JS_INDICATORS_UPDATED_EVENT,
  getIndicatorDefaults,
  listIndicators,
  removeCustomJsIndicator,
  upsertCustomJsIndicator,
} from "./IndicatorManager";
import { IndicatorParamEditor } from "./IndicatorParamEditor";
import {
  INDICATOR_LIBRARY_UPDATED_EVENT,
  cloneIndicatorConfig,
  deleteIndicatorTemplate,
  getIndicatorTemplateStorageKey,
  makeIndicatorInstanceId,
  readIndicatorFavorites,
  readIndicatorTemplates,
  replaceIndicatorEditableParams,
  resolveIndicatorPaneKey,
  resolveIndicatorRouting,
  toggleStoredIndicatorFavorite,
  upsertIndicatorTemplate,
  writeIndicatorTemplates,
  type IndicatorTemplateRecord,
} from "./indicatorCatalog";
import type { IndicatorConfig, IndicatorRegistryView } from "./types";

type Props = {
  symbol: string;
  activeIndicators: IndicatorConfig[];
  onChange: (next: IndicatorConfig[]) => void;
  templateScope?: "equity" | "fno";
  onCreateAlert?: (config: IndicatorConfig) => void;
};

type PaneOption = {
  id: string;
  label: string;
};

const MAX_ACTIVE = 8;
const BASE_CATEGORY_TABS = ["favorites", "active", "all"] as const;

function normalizeFavoriteId(id: string): string {
  return String(id || "").trim().toLowerCase();
}

function titleizeCategory(id: string): string {
  if (id === "favorites") return "Favorites";
  if (id === "active") return "Active";
  if (id === "all") return "All";
  return id;
}

function buildRouteSummary(
  config: IndicatorConfig,
  defaultOverlay: boolean,
  paneOptions: PaneOption[],
): string {
  const routing = resolveIndicatorRouting(config, defaultOverlay);
  const resolved = resolveIndicatorPaneKey(config, defaultOverlay);
  const paneLabel =
    resolved.paneKey
      ? (paneOptions.find((option) => option.id === resolved.paneKey)?.label ?? "Shared pane")
      : "Price overlay";
  const routeLabel =
    routing.paneTarget === "overlay"
      ? "Overlay"
      : routing.paneTarget === "new"
        ? "New pane"
        : routing.paneTarget === "existing"
          ? paneLabel
          : defaultOverlay
            ? "Auto overlay"
            : paneLabel;
  const visibilityLabel = config.visible ? "Visible" : "Hidden";
  const scaleLabel = resolved.scaleBehavior === "separate" ? "Separate scale" : "Shared scale";
  return `${visibilityLabel} | ${routeLabel} | ${scaleLabel}`;
}

function buildPaneOptions(
  activeIndicators: IndicatorConfig[],
  infoById: Map<string, IndicatorRegistryView>,
): PaneOption[] {
  const seen = new Set<string>();
  const out: PaneOption[] = [];
  let paneIndex = 1;
  for (const config of activeIndicators) {
    const info = infoById.get(config.id);
    const resolved = resolveIndicatorPaneKey(config, info?.overlay ?? false);
    if (resolved.overlay || !resolved.paneKey || seen.has(resolved.paneKey)) continue;
    seen.add(resolved.paneKey);
    const routing = resolveIndicatorRouting(config, info?.overlay ?? false);
    const labelBase = info?.name || config.id.toUpperCase();
    const routeLabel =
      routing.paneTarget === "existing"
        ? "shared"
        : routing.paneTarget === "new"
          ? "dedicated"
          : "auto";
    out.push({
      id: resolved.paneKey,
      label: `Pane ${paneIndex} | ${labelBase} | ${routeLabel}`,
    });
    paneIndex += 1;
  }
  return out;
}

export function IndicatorPanel({ symbol, activeIndicators, onChange, templateScope = "equity", onCreateAlert }: Props) {
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [activeCategory, setActiveCategory] = useState<string>("favorites");
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => readIndicatorFavorites());
  const [templates, setTemplates] = useState<IndicatorTemplateRecord[]>(() => readIndicatorTemplates(templateScope));
  const [customName, setCustomName] = useState("");
  const [customOverlay, setCustomOverlay] = useState(true);
  const [customScript, setCustomScript] = useState(
    "function calculate(bars, params) {\n  return {\n    plots: {\n      line: bars.map((bar) => ({ time: bar.time, value: Number(bar.close) }))\n    }\n  };\n}",
  );
  const [customError, setCustomError] = useState<string | null>(null);

  const all = useMemo(() => listIndicators(), [catalogVersion]);
  const infoById = useMemo(() => new Map(all.map((item) => [item.id, item])), [all]);
  const activeCounts = useMemo(() => {
    const next = new Map<string, number>();
    for (const indicator of activeIndicators) {
      next.set(indicator.id, (next.get(indicator.id) ?? 0) + 1);
    }
    return next;
  }, [activeIndicators]);
  const activeSet = useMemo(() => new Set(activeCounts.keys()), [activeCounts]);
  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const paneOptions = useMemo(() => buildPaneOptions(activeIndicators, infoById), [activeIndicators, infoById]);
  const editingConfig = useMemo(
    () => activeIndicators.find((item) => item.instanceId === editingId) || null,
    [activeIndicators, editingId],
  );
  const fuse = useMemo(
    () =>
      new Fuse(all, {
        keys: ["name", "id", "category"],
        threshold: 0.28,
        ignoreLocation: true,
      }),
    [all],
  );
  const normalizedSearch = search.trim();
  const searchResults = useMemo(() => {
    if (!normalizedSearch) return all;
    return fuse.search(normalizedSearch).map((result) => result.item);
  }, [all, fuse, normalizedSearch]);
  const categories = useMemo(
    () => Array.from(new Set(all.map((item) => item.category))).sort((left, right) => left.localeCompare(right)),
    [all],
  );
  const categoryTabs = useMemo(() => [...BASE_CATEGORY_TABS, ...categories], [categories]);

  useEffect(() => {
    const refreshLibrary = () => {
      setCatalogVersion((version) => version + 1);
      setFavoriteIds(readIndicatorFavorites());
      setTemplates(readIndicatorTemplates(templateScope));
    };
    window.addEventListener(CUSTOM_JS_INDICATORS_UPDATED_EVENT, refreshLibrary);
    window.addEventListener(INDICATOR_LIBRARY_UPDATED_EVENT, refreshLibrary);
    return () => {
      window.removeEventListener(CUSTOM_JS_INDICATORS_UPDATED_EVENT, refreshLibrary);
      window.removeEventListener(INDICATOR_LIBRARY_UPDATED_EVENT, refreshLibrary);
    };
  }, [templateScope]);

  useEffect(() => {
    setTemplates(readIndicatorTemplates(templateScope));
  }, [templateScope]);

  useEffect(() => {
    if (activeCategory === "favorites" && favoriteIds.length) return;
    if (activeCategory !== "favorites") return;
    setActiveCategory("all");
  }, [activeCategory, favoriteIds.length]);

  const filteredCatalog = useMemo(() => {
    const rows = searchResults.filter((item) => {
      if (activeCategory === "favorites") return favoriteSet.has(normalizeFavoriteId(item.id));
      if (activeCategory === "active") return activeSet.has(item.id);
      if (activeCategory === "all") return true;
      return item.category === activeCategory;
    });
    return rows.sort((left, right) => {
      const leftActive = activeSet.has(left.id);
      const rightActive = activeSet.has(right.id);
      if (leftActive !== rightActive) return leftActive ? -1 : 1;
      const leftFavorite = favoriteSet.has(normalizeFavoriteId(left.id));
      const rightFavorite = favoriteSet.has(normalizeFavoriteId(right.id));
      if (leftFavorite !== rightFavorite) return leftFavorite ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
  }, [activeCategory, activeSet, favoriteSet, searchResults]);

  const groupedCatalog = useMemo(() => {
    const map = new Map<string, IndicatorRegistryView[]>();
    for (const item of filteredCatalog) {
      const key = activeCategory === "all" || activeCategory === "favorites" || activeCategory === "active" ? item.category : activeCategory;
      if (!map.has(key)) map.set(key, []);
      map.get(key)?.push(item);
    }
    return Array.from(map.entries()).sort((left, right) => left[0].localeCompare(right[0]));
  }, [activeCategory, filteredCatalog]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    counts.set("favorites", all.filter((item) => favoriteSet.has(normalizeFavoriteId(item.id))).length);
    counts.set("active", activeIndicators.length);
    counts.set("all", all.length);
    categories.forEach((category) => {
      counts.set(category, all.filter((item) => item.category === category).length);
    });
    return counts;
  }, [activeIndicators.length, all, categories, favoriteSet]);

  const addIndicator = (id: string) => {
    if (activeIndicators.length >= MAX_ACTIVE) return;
    const defaults = getIndicatorDefaults(id);
    onChange([
      ...activeIndicators,
      {
        id,
        instanceId: makeIndicatorInstanceId(id),
        params: { ...defaults.params },
        visible: true,
      },
    ]);
  };

  const saveTemplate = () => {
    const next = writeIndicatorTemplates(
      templateScope,
      upsertIndicatorTemplate(templates, templateName, activeIndicators),
    );
    setTemplates(next);
    const matched = next.find((row) => row.name.toLowerCase() === templateName.trim().toLowerCase());
    setSelectedTemplateId(matched?.id ?? "");
    setTemplateName("");
  };

  const loadTemplate = () => {
    const rows = templates.find((template) => template.id === selectedTemplateId)?.indicators;
    if (!rows?.length) return;
    onChange(rows.map((row) => cloneIndicatorConfig({ ...row, instanceId: makeIndicatorInstanceId(row.id) })));
  };

  const deleteTemplate = () => {
    if (!selectedTemplateId) return;
    const next = writeIndicatorTemplates(
      templateScope,
      deleteIndicatorTemplate(templates, selectedTemplateId),
    );
    setTemplates(next);
    setSelectedTemplateId("");
  };

  const toggleVisibility = (instanceId: string) => {
    onChange(
      activeIndicators.map((indicator) =>
        indicator.instanceId === instanceId ? { ...indicator, visible: !indicator.visible } : indicator,
      ),
    );
  };

  const resetIndicatorParams = (instanceId: string, indicatorId: string) => {
    const defaults = getIndicatorDefaults(indicatorId).params;
    onChange(
      activeIndicators.map((indicator) =>
        indicator.instanceId === instanceId ? replaceIndicatorEditableParams(indicator, { ...defaults }) : indicator,
      ),
    );
  };

  const resetAllParams = () => {
    onChange(
      activeIndicators.map((indicator) => {
        const defaults = getIndicatorDefaults(indicator.id).params;
        return replaceIndicatorEditableParams(indicator, { ...defaults });
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
      setCatalogVersion((version) => version + 1);
    } catch (error) {
      setCustomError(error instanceof Error ? error.message : "Failed to save custom script");
    }
  };

  const deleteCustomScript = (id: string) => {
    removeCustomJsIndicator(id);
    onChange(activeIndicators.filter((indicator) => indicator.id !== id));
    setCatalogVersion((version) => version + 1);
  };

  return (
    <div className="relative rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-terminal-accent">Indicators</div>
          <div className="mt-1 text-[11px] text-terminal-muted">
            {activeIndicators.length}/{MAX_ACTIVE} active | {favoriteIds.length} favorites | {symbol.toUpperCase()}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-[11px] text-terminal-muted">
            Templates in <span className="text-terminal-text">{getIndicatorTemplateStorageKey(templateScope)}</span>
          </div>
          <button
            type="button"
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
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search indicators, aliases, or categories"
        className="mb-2 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs text-terminal-text outline-none focus:border-terminal-accent"
      />

      <div className="mb-3 flex flex-wrap gap-1">
        {categoryTabs.map((category) => {
          const count = categoryCounts.get(category) ?? 0;
          const isActive = activeCategory === category;
          return (
            <button
              key={category}
              type="button"
              className={`rounded border px-2 py-1 text-[10px] uppercase tracking-[0.14em] ${
                isActive
                  ? "border-terminal-accent bg-terminal-accent/10 text-terminal-accent"
                  : "border-terminal-border text-terminal-muted"
              }`}
              onClick={() => setActiveCategory(category)}
              data-testid={`indicator-category-${category.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {titleizeCategory(category)} {count}
            </button>
          );
        })}
      </div>

      <div className="max-h-80 space-y-3 overflow-auto pr-1">
        {groupedCatalog.length ? (
          groupedCatalog.map(([category, items]) => (
            <section key={category}>
              {(activeCategory === "all" || activeCategory === "favorites" || activeCategory === "active") ? (
                <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-terminal-muted">{category}</div>
              ) : null}
              <div className="space-y-2">
                {items.map((item) => {
                  const instances = activeIndicators.filter((indicator) => indicator.id === item.id);
                  const active = instances.length > 0;
                  const defaultOverlay = item.overlay;
                  return (
                    <div
                      key={item.id}
                      className={`rounded border px-2 py-2 ${
                        active
                          ? "border-terminal-accent/60 bg-terminal-accent/5"
                          : "border-terminal-border bg-terminal-bg/40"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <button
                          type="button"
                          className={`rounded border px-1.5 py-1 text-[10px] ${
                            favoriteSet.has(normalizeFavoriteId(item.id))
                              ? "border-terminal-accent text-terminal-accent"
                              : "border-terminal-border text-terminal-muted"
                          }`}
                          onClick={() => setFavoriteIds(toggleStoredIndicatorFavorite(item.id))}
                          aria-label={favoriteSet.has(normalizeFavoriteId(item.id)) ? `Remove ${item.name} from favorites` : `Favorite ${item.name}`}
                          data-testid={`indicator-favorite-${item.id}`}
                        >
                          {favoriteSet.has(normalizeFavoriteId(item.id)) ? "Fav" : "Star"}
                        </button>
                        <button
                          type="button"
                          className={`min-w-0 flex-1 rounded border px-2 py-1 text-left text-xs ${
                            active
                              ? "border-terminal-accent bg-terminal-accent/10 text-terminal-accent"
                              : "border-terminal-border text-terminal-text"
                          }`}
                          onClick={() => addIndicator(item.id)}
                          title={item.id}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate">
                              {active ? (instances.length > 1 ? `[x${instances.length}]` : "[x]") : "[ ]"} {item.name}
                            </span>
                            <span className="rounded border border-terminal-border px-1 py-0.5 text-[9px] uppercase tracking-[0.14em] text-terminal-muted">
                              {item.overlay ? "Overlay" : "Pane"}
                            </span>
                          </div>
                          <div className="mt-1 truncate text-[10px] text-terminal-muted">{item.id}</div>
                        </button>
                        {!active && item.isCustom ? (
                          <button
                            type="button"
                            className="rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-muted"
                            onClick={() => deleteCustomScript(item.id)}
                            title="Delete custom script"
                          >
                            rm
                          </button>
                        ) : null}
                      </div>
                      {active ? (
                        <>
                          {instances.map((current, instanceIndex) => {
                            const testSuffix = instanceIndex === 0 ? item.id : `${item.id}-${current.instanceId}`;
                            return (
                              <div
                                key={current.instanceId}
                                className="mt-2 rounded border border-terminal-border/60 bg-terminal-bg/40 px-2 py-2"
                              >
                                <div
                                  className="text-[10px] text-terminal-muted"
                                  data-testid={`indicator-route-summary-${testSuffix}`}
                                >
                                  {instances.length > 1 ? `Instance ${instanceIndex + 1} | ` : ""}
                                  {buildRouteSummary(current, defaultOverlay, paneOptions)}
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-1">
                                  <button
                                    type="button"
                                    className="rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-muted"
                                    onClick={() => setEditingId(current.instanceId)}
                                  >
                                    cfg
                                  </button>
                                  <button
                                    type="button"
                                    className="rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-muted"
                                    onClick={() => toggleVisibility(current.instanceId)}
                                    data-testid={`indicator-visibility-${testSuffix}`}
                                  >
                                    {current.visible ? "hide" : "show"}
                                  </button>
                                  <button
                                    type="button"
                                    className="rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-muted"
                                    onClick={() => resetIndicatorParams(current.instanceId, item.id)}
                                    data-testid={`indicator-reset-${testSuffix}`}
                                  >
                                    rst
                                  </button>
                                  {onCreateAlert ? (
                                    <button
                                      type="button"
                                      className="rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-muted"
                                      onClick={() => onCreateAlert(current)}
                                      data-testid={`indicator-alert-${testSuffix}`}
                                    >
                                      alert
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    className="rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-muted"
                                    onClick={() =>
                                      onChange(activeIndicators.filter((indicator) => indicator.instanceId !== current.instanceId))
                                    }
                                  >
                                    del
                                  </button>
                                </div>
                                {Object.keys(current.params || {}).length ? (
                                  <div className="mt-2 truncate text-[10px] text-terminal-muted">
                                    {Object.entries(current.params)
                                      .filter(([key]) => !key.startsWith("__otui"))
                                      .slice(0, 4)
                                      .map(([key, value]) => `${key}:${String(value)}`)
                                      .join(" | ")}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        ) : (
          <div className="rounded border border-dashed border-terminal-border px-3 py-4 text-center text-[11px] text-terminal-muted">
            No indicators match this view.
          </div>
        )}
      </div>

      <div className="mt-3 space-y-2 rounded border border-terminal-border p-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] uppercase tracking-wide text-terminal-muted">Templates</div>
          <div className="text-[10px] text-terminal-muted">{templates.length} saved</div>
        </div>
        <div className="flex items-center gap-1">
          <input
            value={templateName}
            onChange={(event) => setTemplateName(event.target.value)}
            placeholder="Template name"
            className="min-w-0 flex-1 rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs text-terminal-text outline-none focus:border-terminal-accent"
          />
          <button
            type="button"
            className="rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-accent disabled:opacity-50"
            onClick={saveTemplate}
            disabled={!templateName.trim() || !activeIndicators.length}
          >
            Save
          </button>
        </div>
        <div className="flex items-center gap-1">
          <select
            className="min-w-0 flex-1 rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs text-terminal-text outline-none"
            value={selectedTemplateId}
            onChange={(event) => setSelectedTemplateId(event.target.value)}
            data-testid="indicator-template-select"
          >
            <option value="">Select template</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-accent disabled:opacity-50"
            onClick={loadTemplate}
            disabled={!selectedTemplateId}
          >
            Load
          </button>
          <button
            type="button"
            className="rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-muted disabled:opacity-50"
            onClick={deleteTemplate}
            disabled={!selectedTemplateId}
            data-testid="indicator-template-delete"
          >
            Del
          </button>
        </div>

        <div className="rounded border border-terminal-border p-2">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-terminal-muted">Custom JS</div>
          <input
            value={customName}
            onChange={(event) => setCustomName(event.target.value)}
            placeholder="Custom indicator name"
            className="mb-1 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs text-terminal-text outline-none focus:border-terminal-accent"
          />
          <label className="mb-1 flex items-center gap-2 text-[11px] text-terminal-muted">
            <input type="checkbox" checked={customOverlay} onChange={(event) => setCustomOverlay(event.target.checked)} />
            Overlay on main chart
          </label>
          <textarea
            value={customScript}
            onChange={(event) => setCustomScript(event.target.value)}
            className="h-28 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs text-terminal-text outline-none focus:border-terminal-accent"
            spellCheck={false}
          />
          <div className="mt-1 flex items-center justify-between gap-2">
            <button
              type="button"
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
        <button type="button" className="text-[11px] text-terminal-accent" onClick={() => onChange([])}>
          Clear all
        </button>
      </div>

      {editingConfig ? (
        <IndicatorParamEditor
          config={editingConfig}
          defaultOverlay={Boolean(infoById.get(editingConfig.id)?.overlay)}
          paneOptions={paneOptions}
          onClose={() => setEditingId(null)}
          onSave={(next) => {
            onChange(activeIndicators.map((indicator) => (indicator.instanceId === next.instanceId ? next : indicator)));
            setEditingId(null);
          }}
        />
      ) : null}
    </div>
  );
}
