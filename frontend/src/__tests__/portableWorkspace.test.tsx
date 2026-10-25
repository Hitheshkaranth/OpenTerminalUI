import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { LaunchpadProvider, useLaunchpad, registerWorkspaceWidget, SUPPORTED_LAUNCHPAD_PANEL_TYPES, type LaunchpadLayoutPreset } from "../components/layout/LaunchpadContext";
import { parseWorkspace, serializeWorkspace } from "../workspace/portableLayout";
import { queuePinnedArtifact } from "../workspace/pinnedArtifacts";

const layout: LaunchpadLayoutPreset = { id: "source", name: "Research", panels: [{ id: "p1", type: "chart", title: "AAPL", symbol: "AAPL", x: 0, y: 0, w: 6, h: 4, linkGroup: "red", poppedOut: true, props: { timeframe: "1D", api_key: "must-not-export" } }] };
const wrapper = ({ children }: { children: React.ReactNode }) => <LaunchpadProvider>{children}</LaunchpadProvider>;

describe("Portable workspaces", () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false }))); });
  afterEach(() => { vi.unstubAllGlobals(); });
  it("registers bundled widget extensions for portable layout validation", () => {
    registerWorkspaceWidget({ id: "plugin:test-metric", title: "Test metric", version: 1, component: () => null });
    const custom = { ...layout, panels: [{ ...layout.panels[0], type: "plugin:test-metric" as const }] };
    expect(parseWorkspace(serializeWorkspace(custom), SUPPORTED_LAUNCHPAD_PANEL_TYPES).panels[0].type).toBe("plugin:test-metric");
    expect(() => registerWorkspaceWidget({ id: "plugin:test-metric", title: "Duplicate", version: 1, component: () => null })).toThrow(/already registered/);
  });
  it("roundtrips a layout with fresh IDs and without credentials or popout state", () => {
    const text = serializeWorkspace(layout);
    expect(text).not.toContain("must-not-export");
    const imported = parseWorkspace(text, ["chart"]);
    expect(imported.id).not.toBe(layout.id);
    expect(imported.panels[0]).toMatchObject({ symbol: "AAPL", linkGroup: "red", poppedOut: false, props: { timeframe: "1D" } });
  });
  it("rejects unsupported versions, widgets and invalid grids before importing", () => {
    const envelope = JSON.parse(serializeWorkspace(layout));
    expect(() => parseWorkspace(JSON.stringify({ ...envelope, version: 99 }), ["chart"])).toThrow(/version/);
    expect(() => parseWorkspace(JSON.stringify(envelope), [])).toThrow(/panel type/);
    envelope.layout.panels[0].w = 13;
    expect(() => parseWorkspace(JSON.stringify(envelope), ["chart"])).toThrow(/grid/);
  });
  it("can undo an import and a panel removal without losing the previous layout", async () => {
    const { result } = renderHook(() => useLaunchpad(), { wrapper });
    await waitFor(() => expect(result.current.loadingLayouts).toBe(false));
    const previous = result.current.savedLayouts.length;
    act(() => result.current.importWorkspace(serializeWorkspace(layout)));
    const id = result.current.activeLayout!.panels[0].id;
    expect(result.current.savedLayouts).toHaveLength(previous + 1);
    act(() => result.current.closePanel(id));
    expect(result.current.activeLayout!.panels).toHaveLength(0);
    act(() => result.current.undo());
    expect(result.current.activeLayout!.panels[0].id).toBe(id);
    act(() => result.current.undo());
    expect(result.current.savedLayouts).toHaveLength(previous);
  });
  it("shares named date and currency context only inside its link group and exports it", async () => {
    const { result } = renderHook(() => useLaunchpad(), { wrapper });
    await waitFor(() => expect(result.current.loadingLayouts).toBe(false));
    act(() => result.current.importWorkspace(serializeWorkspace({ ...layout, panels: [...layout.panels, { ...layout.panels[0], id: "p2", linkGroup: "blue" }] })));
    act(() => result.current.updateGroupContext("red", { name: "Earnings review", symbol: "MSFT", currency: "USD", dateRange: { from: "2026-01-01", to: "2026-06-30" } }));
    expect(result.current.activeLayout!.panels[0]).toMatchObject({ symbol: "MSFT", props: { reportingCurrency: "USD", contextName: "Earnings review", dateRange: { from: "2026-01-01", to: "2026-06-30" } } });
    expect(result.current.activeLayout!.panels[1].symbol).toBe("AAPL");
    const portable = parseWorkspace(result.current.exportWorkspace(), SUPPORTED_LAUNCHPAD_PANEL_TYPES);
    expect(portable.groups?.red?.name).toBe("Earnings review");
    expect(() => result.current.updateGroupContext("red", { name: "Invalid", dateRange: { from: "2026-07-01", to: "2026-01-01" } })).toThrow(/Start date/);
  });
  it("pins queued evidence after hydration and does not duplicate the same artifact", async () => {
    const item = { artifact: { id: "answer-1", kind: "table", name: "Evidence", data: { rows: [] } }, savedAt: "2026-10-25T00:00:00Z" };
    queuePinnedArtifact(item);
    const { result } = renderHook(() => useLaunchpad(), { wrapper });
    await waitFor(() => expect(result.current.activeLayout?.panels.some((panel) => panel.type === "research-artifact")).toBe(true));
    act(() => queuePinnedArtifact(item));
    expect(result.current.activeLayout?.panels.filter((panel) => panel.id === "artifact-answer-1")).toHaveLength(1);
  });
});
