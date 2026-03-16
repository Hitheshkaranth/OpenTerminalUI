import type { ChartSlot } from "../../store/chartWorkstationStore";

export const WORKSTATION_SNAPSHOT_STORAGE_KEY = "ot:chart-workstation:snapshots:v1";
export const WORKSTATION_SHARE_QUERY_PARAM = "share";
export const LEGACY_WORKSTATION_STORE_KEY = "ot_chart_workstation";

export const WORKSTATION_PERSISTENCE_BOUNDARIES = {
  autosaveIncludes: [
    "layout",
    "symbols-timeframes-chart-types",
    "active-indicators",
    "link-matrix",
    "compare-scope",
    "range-presets",
  ],
  reusablePayloadIncludes: [
    "layout",
    "symbols-timeframes-chart-types",
    "active-indicators",
    "link-matrix",
    "compare-scope",
    "range-presets",
  ],
  workspaceScoped: [
    "drawings",
    "chart-surface-controls",
    "replay-position",
    "crosshair-position",
  ],
  globalScoped: [
    "indicator-templates",
    "indicator-favorites",
    "drawing-style-templates",
  ],
  reusablePayloadExcludes: [
    "drawings",
    "chart-surface-controls",
    "replay-position",
    "crosshair-position",
    "live-market-data",
  ],
} as const;

export const WORKSTATION_BOUNDARY_SUMMARY =
  "Autosave persists layout, chart setup, indicators, and link/compare/range settings per workspace tab. " +
  "Drawings and chart-surface controls stay pane-scoped. Templates, defaults, snapshots, and share links restore with fresh pane scopes.";

export type WorkstationSnapshotPayload = {
  version: 1;
  kind: "chart-workstation";
  name: string;
  boundaries: typeof WORKSTATION_PERSISTENCE_BOUNDARIES;
  layout_config: Record<string, unknown>;
};

export type WorkstationSnapshotRecord = {
  id: string;
  name: string;
  createdAt: string;
  payload: WorkstationSnapshotPayload;
};

type SlotIdFactory = () => string;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeSnapshotName(name: unknown): string {
  const trimmed = typeof name === "string" ? name.trim() : "";
  return trimmed || "Workspace";
}

function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const binary = atob(normalized + padding);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function remapRecordKeys<T>(
  input: Record<string, T> | null | undefined,
  idMap: Record<string, string>,
): Record<string, T> | undefined {
  if (!input) return undefined;
  const next: Record<string, T> = {};
  Object.entries(input).forEach(([key, value]) => {
    next[idMap[key] ?? key] = value;
  });
  return next;
}

function normalizeSnapshotPayload(input: unknown): WorkstationSnapshotPayload | null {
  if (!isRecord(input)) return null;
  if (input.kind !== "chart-workstation" || input.version !== 1) return null;
  if (!isRecord(input.layout_config)) return null;
  return {
    version: 1,
    kind: "chart-workstation",
    name: sanitizeSnapshotName(input.name),
    boundaries: WORKSTATION_PERSISTENCE_BOUNDARIES,
    layout_config: { ...input.layout_config },
  };
}

export function isolateWorkstationLayoutConfig(
  layoutConfig: Record<string, unknown>,
  createId: SlotIdFactory = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36),
): Record<string, unknown> {
  if (!isRecord(layoutConfig)) return {};

  const next = { ...layoutConfig };
  const sourceKey = Array.isArray(layoutConfig.slots)
    ? "slots"
    : Array.isArray(layoutConfig.panels)
      ? "panels"
      : null;

  if (!sourceKey) return next;

  const source = layoutConfig[sourceKey];
  if (!Array.isArray(source) || !source.length) return next;

  const idMap: Record<string, string> = {};
  next[sourceKey] = source.map((row) => {
    if (!isRecord(row)) return row;
    const freshId = createId();
    if (typeof row.id === "string" && row.id.trim()) {
      idMap[row.id] = freshId;
    }
    return {
      ...row,
      id: freshId,
    };
  });

  const remappedLinkGroups = remapRecordKeys(
    isRecord(layoutConfig.linkGroups) ? (layoutConfig.linkGroups as Record<string, string>) : null,
    idMap,
  );
  if (remappedLinkGroups) {
    next.linkGroups = remappedLinkGroups;
  }

  const remappedLegacyLinkGroups = remapRecordKeys(
    isRecord(layoutConfig.link_groups) ? (layoutConfig.link_groups as Record<string, string>) : null,
    idMap,
  );
  if (remappedLegacyLinkGroups) {
    next.link_groups = remappedLegacyLinkGroups;
  }

  const remappedRangePresets = remapRecordKeys(
    isRecord(layoutConfig.rangePresets) ? (layoutConfig.rangePresets as Record<string, string>) : null,
    idMap,
  );
  if (remappedRangePresets) {
    next.rangePresets = remappedRangePresets;
  }

  return next;
}

export function buildWorkstationSnapshotPayload(
  name: string,
  layoutConfig: Record<string, unknown>,
): WorkstationSnapshotPayload {
  return {
    version: 1,
    kind: "chart-workstation",
    name: sanitizeSnapshotName(name),
    boundaries: WORKSTATION_PERSISTENCE_BOUNDARIES,
    layout_config: { ...layoutConfig },
  };
}

export function createWorkstationSnapshotRecord(
  name: string,
  layoutConfig: Record<string, unknown>,
  createdAt = new Date().toISOString(),
): WorkstationSnapshotRecord {
  return {
    id: `snapshot-${Date.parse(createdAt).toString(36)}-${sanitizeSnapshotName(name).toLowerCase().replace(/[^a-z0-9]+/g, "-") || "workspace"}`,
    name: sanitizeSnapshotName(name),
    createdAt,
    payload: buildWorkstationSnapshotPayload(name, layoutConfig),
  };
}

export function normalizeStoredWorkstationSnapshots(input: unknown): WorkstationSnapshotRecord[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((row) => {
      if (!isRecord(row)) return null;
      const payload = normalizeSnapshotPayload(row.payload);
      if (!payload) return null;
      return {
        id: typeof row.id === "string" && row.id.trim() ? row.id : `snapshot-${payload.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "workspace"}`,
        name: sanitizeSnapshotName(row.name ?? payload.name),
        createdAt:
          typeof row.createdAt === "string" && row.createdAt.trim()
            ? row.createdAt
            : new Date(0).toISOString(),
        payload,
      } satisfies WorkstationSnapshotRecord;
    })
    .filter((row): row is WorkstationSnapshotRecord => row !== null);
}

export function encodeWorkstationSharePayload(payload: WorkstationSnapshotPayload): string {
  return toBase64Url(JSON.stringify(payload));
}

export function decodeWorkstationSharePayload(raw: string): WorkstationSnapshotPayload | null {
  try {
    return normalizeSnapshotPayload(JSON.parse(fromBase64Url(raw)));
  } catch {
    return null;
  }
}

export function buildWorkstationExportFilename(
  name: string,
  extension: "json" | "png" | "csv",
): string {
  const slug = sanitizeSnapshotName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `chart-workstation-${slug || "workspace"}.${extension}`;
}

export function downloadTextFile(
  filename: string,
  contents: string,
  mimeType = "application/json",
): void {
  const blob = new Blob([contents], { type: mimeType });
  if (typeof URL.createObjectURL !== "function") return;
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.download = filename;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}

export function cloneSlotIdsForWorkspace(slots: ChartSlot[]): ChartSlot[] {
  const isolated = isolateWorkstationLayoutConfig({ slots });
  const next = Array.isArray(isolated.slots) ? isolated.slots : [];
  return next.filter((row): row is ChartSlot => isRecord(row)) as ChartSlot[];
}
