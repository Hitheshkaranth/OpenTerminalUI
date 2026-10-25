import type { LaunchpadLayoutPreset, LaunchpadPanelConfig } from "../components/layout/LaunchpadContext";

import { validateGroupContext, type WorkspaceGroupContext } from "./groupContext";

export const WORKSPACE_SCHEMA_VERSION = 1;
const MAX_PANELS = 48;
const FORBIDDEN_KEYS = /^(?:__proto__|prototype|constructor|password|token|api[_-]?key|secret|authorization|cookie)$/i;

function safeProps(value: unknown, depth = 0): unknown {
  if (depth > 12) throw new Error("Panel settings are nested too deeply.");
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 100_000);
  if (Array.isArray(value)) return value.slice(0, 5000).map((item) => safeProps(item, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !FORBIDDEN_KEYS.test(key)).map(([key, item]) => [key, safeProps(item, depth + 1)]));
  return null;
}

export function serializeWorkspace(layout: LaunchpadLayoutPreset): string {
  return JSON.stringify({ format: "openterminal-workspace", version: WORKSPACE_SCHEMA_VERSION, exported_at: new Date().toISOString(), layout: { ...layout, panels: layout.panels.map((panel) => ({ ...panel, poppedOut: false, props: safeProps(panel.props ?? {}) })) } }, null, 2);
}

export function parseWorkspace(raw: string, supported: readonly string[]): LaunchpadLayoutPreset {
  if (raw.length > 2_000_000) throw new Error("Workspace file exceeds 2 MB.");
  let envelope: any;
  try { envelope = JSON.parse(raw); } catch { throw new Error("Choose a valid workspace JSON file."); }
  if (envelope?.format !== "openterminal-workspace" || envelope.version !== WORKSPACE_SCHEMA_VERSION) throw new Error("Unsupported workspace format or version.");
  const layout = envelope.layout;
  if (!layout || typeof layout.name !== "string" || !layout.name.trim() || !Array.isArray(layout.panels) || layout.panels.length > MAX_PANELS) throw new Error("Workspace must have a name and at most 48 panels.");
  const importId = `import-${crypto.randomUUID()}`;
  const panels: LaunchpadPanelConfig[] = layout.panels.map((panel: any, index: number) => {
    if (!panel || !supported.includes(panel.type)) throw new Error(`Unsupported panel type: ${String(panel?.type)}`);
    for (const key of ["x", "y", "w", "h"]) if (!Number.isInteger(panel[key]) || panel[key] < (key === "w" || key === "h" ? 1 : 0)) throw new Error(`Invalid panel ${key}.`);
    if (panel.w > 12 || panel.x + panel.w > 12 || panel.h > 100 || panel.y > 1000) throw new Error("Panel is outside the supported workspace grid.");
    const linkGroup = ["red", "blue", "green", "yellow"].includes(panel.linkGroup) ? panel.linkGroup : "none";
    return { id: `${importId}-${index}`, type: panel.type, title: String(panel.title || panel.type).slice(0, 100), symbol: typeof panel.symbol === "string" ? panel.symbol.slice(0, 100) : undefined, x: panel.x, y: panel.y, w: panel.w, h: panel.h, linkGroup, linked: linkGroup !== "none", poppedOut: false, props: safeProps(panel.props ?? {}) as Record<string, unknown> };
  });
  const groups: LaunchpadLayoutPreset["groups"] = {};
  if (layout.groups && typeof layout.groups === "object") for (const group of ["red", "blue", "green", "yellow"] as const) {
    if (layout.groups[group]) groups[group] = validateGroupContext(layout.groups[group] as WorkspaceGroupContext);
  }
  return { id: importId, name: layout.name.trim().slice(0, 100), panels, groups };
}
