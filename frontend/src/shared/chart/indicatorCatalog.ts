import type { IndicatorConfig, IndicatorRouting, IndicatorScaleBehavior, IndicatorPaneTarget } from "./types";

const INDICATOR_META_KEY = "__otui_indicator";

export const INDICATOR_LIBRARY_UPDATED_EVENT = "chart:indicator-library:updated";
export const INDICATOR_FAVORITES_STORAGE_KEY = "chart:indicator-favorites:v1";

export type IndicatorTemplateRecord = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  indicators: IndicatorConfig[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeIndicatorId(id: string): string {
  return String(id || "").trim().toLowerCase();
}

function normalizeIndicatorInstanceId(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw || null;
}

function cloneParams(params: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!isRecord(params)) return {};
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (isRecord(value)) {
      next[key] = { ...value };
      continue;
    }
    if (Array.isArray(value)) {
      next[key] = value.slice();
      continue;
    }
    next[key] = value;
  }
  return next;
}

function normalizePaneTarget(value: unknown): IndicatorPaneTarget {
  return value === "overlay" || value === "new" || value === "existing" || value === "auto" ? value : "auto";
}

function normalizeScaleBehavior(value: unknown): IndicatorScaleBehavior {
  return value === "separate" ? "separate" : "shared";
}

function normalizeRoutingMeta(input: unknown): IndicatorRouting {
  const row = isRecord(input) ? input : {};
  const paneTarget = normalizePaneTarget(row.paneTarget);
  const paneId = typeof row.paneId === "string" && row.paneId.trim() ? row.paneId.trim() : null;
  const scaleBehavior = normalizeScaleBehavior(row.scaleBehavior);
  if (paneTarget === "overlay") {
    return { paneTarget, paneId: null, scaleBehavior };
  }
  return { paneTarget, paneId, scaleBehavior };
}

function normalizeLineWidth(value: unknown): number | undefined {
  const width = Number(value);
  if (!Number.isFinite(width)) return undefined;
  return Math.max(1, Math.min(4, Math.round(width)));
}

function normalizeTemplateId(name: string): string {
  const base = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (base) {
    return `indicator-template:${base}`;
  }
  return `indicator-template:${Date.now().toString(36)}`;
}

function emitIndicatorLibraryUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(INDICATOR_LIBRARY_UPDATED_EVENT));
}

export function makeIndicatorPaneId(indicatorId: string): string {
  const base = normalizeIndicatorId(indicatorId).replace(/[^a-z0-9_-]+/g, "-") || "indicator";
  return `pane:${base}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`;
}

export function makeIndicatorInstanceId(indicatorId: string): string {
  const base = normalizeIndicatorId(indicatorId).replace(/[^a-z0-9_-]+/g, "-") || "indicator";
  return `indicator:${base}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`;
}

function fallbackIndicatorInstanceId(indicatorId: string, index: number): string {
  const base = normalizeIndicatorId(indicatorId).replace(/[^a-z0-9_-]+/g, "-") || "indicator";
  return `indicator:${base}:${index + 1}`;
}

export function getIndicatorPrivateMetaKey(): string {
  return INDICATOR_META_KEY;
}

export function getIndicatorEditableParams(config: IndicatorConfig): Record<string, unknown> {
  const params = cloneParams(config.params);
  delete params[INDICATOR_META_KEY];
  return params;
}

export function replaceIndicatorEditableParams(
  config: IndicatorConfig,
  params: Record<string, unknown>,
): IndicatorConfig {
  const nextParams = cloneParams(params);
  const currentMeta = isRecord(config.params) ? config.params[INDICATOR_META_KEY] : undefined;
  if (currentMeta !== undefined) {
    nextParams[INDICATOR_META_KEY] = currentMeta;
  }
  return {
    ...config,
    params: nextParams,
  };
}

export function resolveIndicatorRouting(config: IndicatorConfig, defaultOverlay: boolean): IndicatorRouting {
  const routing = normalizeRoutingMeta(isRecord(config.params) ? config.params[INDICATOR_META_KEY] : undefined);
  if (routing.paneTarget !== "auto") {
    return routing;
  }
  return {
    paneTarget: defaultOverlay ? "auto" : "auto",
    paneId: null,
    scaleBehavior: routing.scaleBehavior,
  };
}

export function upsertIndicatorRouting(
  config: IndicatorConfig,
  next: Partial<IndicatorRouting>,
  defaultOverlay: boolean,
): IndicatorConfig {
  const current = resolveIndicatorRouting(config, defaultOverlay);
  const paneTarget = normalizePaneTarget(next.paneTarget ?? current.paneTarget);
  const scaleBehavior = normalizeScaleBehavior(next.scaleBehavior ?? current.scaleBehavior);
  let paneId =
    typeof next.paneId === "string"
      ? next.paneId.trim() || null
      : next.paneId === null
        ? null
        : current.paneId;

  if (paneTarget === "new" && !paneId) {
    paneId = makeIndicatorPaneId(config.id);
  }
  if (paneTarget === "overlay" || paneTarget === "auto") {
    paneId = null;
  }

  const params = cloneParams(config.params);
  params[INDICATOR_META_KEY] = {
    paneTarget,
    paneId,
    scaleBehavior,
  } satisfies IndicatorRouting;
  return {
    ...config,
    params,
  };
}

export function resolveIndicatorPaneKey(
  config: IndicatorConfig,
  defaultOverlay: boolean,
): { overlay: boolean; paneKey: string | null; scaleBehavior: IndicatorScaleBehavior } {
  const routing = resolveIndicatorRouting(config, defaultOverlay);
  if (routing.paneTarget === "overlay") {
    return {
      overlay: true,
      paneKey: null,
      scaleBehavior: routing.scaleBehavior,
    };
  }
  if (routing.paneTarget === "existing") {
    return {
      overlay: false,
      paneKey: routing.paneId || `auto:${normalizeIndicatorId(config.id)}`,
      scaleBehavior: routing.scaleBehavior,
    };
  }
  if (routing.paneTarget === "new") {
    return {
      overlay: false,
      paneKey: routing.paneId || `new:${normalizeIndicatorId(config.id)}`,
      scaleBehavior: routing.scaleBehavior,
    };
  }
  if (defaultOverlay) {
    return {
      overlay: true,
      paneKey: null,
      scaleBehavior: routing.scaleBehavior,
    };
  }
  return {
    overlay: false,
    paneKey: `auto:${normalizeIndicatorId(config.id)}`,
    scaleBehavior: routing.scaleBehavior,
  };
}

export function cloneIndicatorConfig(config: IndicatorConfig): IndicatorConfig {
  return {
    id: String(config.id || "").trim(),
    instanceId: normalizeIndicatorInstanceId(config.instanceId) ?? makeIndicatorInstanceId(config.id),
    params: cloneParams(config.params),
    visible: typeof config.visible === "boolean" ? config.visible : true,
    color: typeof config.color === "string" ? config.color : undefined,
    lineWidth: normalizeLineWidth(config.lineWidth),
  };
}

export function normalizeIndicatorConfigs(input: unknown): IndicatorConfig[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  return input
    .map((row, index) => {
      if (!row) return null;
      if (typeof row === "string") {
        const instanceId = fallbackIndicatorInstanceId(row, index);
        seen.add(instanceId);
        return {
          id: row,
          instanceId,
          params: {},
          visible: true,
        } satisfies IndicatorConfig;
      }
      if (!isRecord(row)) return null;
      const id = typeof row.id === "string" ? row.id.trim() : "";
      if (!id) return null;
      let instanceId = normalizeIndicatorInstanceId(row.instanceId) ?? fallbackIndicatorInstanceId(id, index);
      if (seen.has(instanceId)) {
        instanceId = makeIndicatorInstanceId(id);
      }
      seen.add(instanceId);
      return cloneIndicatorConfig({
        id,
        instanceId,
        params: isRecord(row.params) ? (row.params as Record<string, unknown>) : {},
        visible: typeof row.visible === "boolean" ? row.visible : true,
        color: typeof row.color === "string" ? row.color : undefined,
        lineWidth: normalizeLineWidth(row.lineWidth),
      });
    })
    .filter((row): row is IndicatorConfig => Boolean(row));
}

export function normalizeIndicatorFavoriteIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(
      input
        .map((value) => normalizeIndicatorId(String(value || "")))
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

export function toggleIndicatorFavoriteIds(ids: string[], indicatorId: string): string[] {
  const normalizedId = normalizeIndicatorId(indicatorId);
  if (!normalizedId) return normalizeIndicatorFavoriteIds(ids);
  const set = new Set(normalizeIndicatorFavoriteIds(ids));
  if (set.has(normalizedId)) {
    set.delete(normalizedId);
  } else {
    set.add(normalizedId);
  }
  return Array.from(set).sort((left, right) => left.localeCompare(right));
}

export function readIndicatorFavorites(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return normalizeIndicatorFavoriteIds(JSON.parse(window.localStorage.getItem(INDICATOR_FAVORITES_STORAGE_KEY) || "[]"));
  } catch {
    return [];
  }
}

export function writeIndicatorFavorites(ids: string[]): string[] {
  const normalized = normalizeIndicatorFavoriteIds(ids);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(INDICATOR_FAVORITES_STORAGE_KEY, JSON.stringify(normalized));
    emitIndicatorLibraryUpdated();
  }
  return normalized;
}

export function toggleStoredIndicatorFavorite(indicatorId: string): string[] {
  return writeIndicatorFavorites(toggleIndicatorFavoriteIds(readIndicatorFavorites(), indicatorId));
}

function normalizeTemplateConfigEntry(input: unknown): IndicatorConfig | null {
  return normalizeIndicatorConfigs([input])[0] ?? null;
}

function sortTemplates(left: IndicatorTemplateRecord, right: IndicatorTemplateRecord): number {
  if (left.updatedAt !== right.updatedAt) {
    return right.updatedAt - left.updatedAt;
  }
  return left.name.localeCompare(right.name);
}

export function normalizeStoredIndicatorTemplates(input: unknown): IndicatorTemplateRecord[] {
  const out: IndicatorTemplateRecord[] = [];
  if (Array.isArray(input)) {
    for (const row of input) {
      if (!isRecord(row)) continue;
      const name = typeof row.name === "string" ? row.name.trim() : "";
      const indicators = Array.isArray(row.indicators)
        ? row.indicators.map(normalizeTemplateConfigEntry).filter((value): value is IndicatorConfig => Boolean(value))
        : [];
      if (!name || !indicators.length) continue;
      const createdAt = Number(row.createdAt);
      const updatedAt = Number(row.updatedAt);
      out.push({
        id: typeof row.id === "string" && row.id.trim() ? row.id.trim() : normalizeTemplateId(name),
        name,
        createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
        updatedAt: Number.isFinite(updatedAt) ? updatedAt : Number.isFinite(createdAt) ? createdAt : Date.now(),
        indicators,
      });
    }
    return out.sort(sortTemplates);
  }

  if (isRecord(input)) {
    for (const [name, indicatorsRaw] of Object.entries(input)) {
      const indicators = Array.isArray(indicatorsRaw)
        ? indicatorsRaw.map(normalizeTemplateConfigEntry).filter((value): value is IndicatorConfig => Boolean(value))
        : [];
      if (!name.trim() || !indicators.length) continue;
      out.push({
        id: normalizeTemplateId(name),
        name: name.trim(),
        createdAt: 0,
        updatedAt: 0,
        indicators,
      });
    }
  }

  return out.sort(sortTemplates);
}

export function getIndicatorTemplateStorageKey(scope: string): string {
  return `chart:indicator-templates:${scope}`;
}

export function readIndicatorTemplates(scope: string): IndicatorTemplateRecord[] {
  if (typeof window === "undefined") return [];
  try {
    return normalizeStoredIndicatorTemplates(JSON.parse(window.localStorage.getItem(getIndicatorTemplateStorageKey(scope)) || "[]"));
  } catch {
    return [];
  }
}

export function writeIndicatorTemplates(scope: string, templates: IndicatorTemplateRecord[]): IndicatorTemplateRecord[] {
  const normalized = normalizeStoredIndicatorTemplates(templates);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(getIndicatorTemplateStorageKey(scope), JSON.stringify(normalized));
    emitIndicatorLibraryUpdated();
  }
  return normalized;
}

export function upsertIndicatorTemplate(
  templates: IndicatorTemplateRecord[],
  name: string,
  indicators: IndicatorConfig[],
): IndicatorTemplateRecord[] {
  const trimmedName = String(name || "").trim();
  if (!trimmedName) return normalizeStoredIndicatorTemplates(templates);
  const clonedIndicators = indicators.map(cloneIndicatorConfig);
  if (!clonedIndicators.length) return normalizeStoredIndicatorTemplates(templates);

  const existing = templates.find((row) => row.name.toLowerCase() === trimmedName.toLowerCase());
  const now = Date.now();
  const nextRecord: IndicatorTemplateRecord = {
    id: existing?.id || normalizeTemplateId(trimmedName),
    name: trimmedName,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    indicators: clonedIndicators,
  };
  return normalizeStoredIndicatorTemplates([
    ...templates.filter((row) => row.id !== existing?.id),
    nextRecord,
  ]);
}

export function deleteIndicatorTemplate(
  templates: IndicatorTemplateRecord[],
  templateId: string,
): IndicatorTemplateRecord[] {
  return normalizeStoredIndicatorTemplates(templates.filter((row) => row.id !== templateId));
}
