import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DrawingObjectTree } from "../components/chart/DrawingObjectTree";
import {
  buildDrawingSyncPlan,
  createDrawing,
  normalizeStoredDrawingCollection,
} from "../shared/chart/drawingEngine";
import { buildDrawingAlertDraft } from "../shared/chart/chartAlerts";

describe("drawing scope workflows", () => {
  it("restores scoped local drawings and drops invalid legacy records", () => {
    const restored = normalizeStoredDrawingCollection(
      [
        { id: "hl-1", type: "hline", price: 123.45, style: { color: "#00ff00", lineWidth: 1 } },
        { id: "bad", type: "hline", price: "nan" },
      ],
      { timeframe: "1D", workspaceId: "slot-local" },
    );

    expect(restored).toEqual([
      expect.objectContaining({
        id: "hl-1",
        tool: expect.objectContaining({ type: "hline", label: "Horizontal Line" }),
        anchors: [{ key: "level", role: "level", time: 0, price: 123.45 }],
        style: expect.objectContaining({
          color: "#00ff00",
          lineWidth: 1,
          lineStyle: "dashed",
        }),
        meta: expect.objectContaining({
          timeframe: "1D",
          workspaceId: "slot-local",
        }),
      }),
    ]);
  });

  it("builds create/update/delete sync plans for a scoped workspace", () => {
    const unchanged = createDrawing("hline", [{ time: 100, price: 20 }], { timeframe: "1D", workspaceId: "slot" }, {
      id: "same",
      order: 0,
      remoteId: "remote-same",
    });
    const updated = createDrawing(
      "ray",
      [
        { time: 100, price: 10 },
        { time: 120, price: 12 },
      ],
      { timeframe: "1D", workspaceId: "slot" },
      { id: "update-me", order: 2, remoteId: "remote-update", style: { color: "#ffaa00", lineWidth: 2 } },
    );
    const created = createDrawing("vline", [{ time: 90, price: 15 }], { timeframe: "1D", workspaceId: "slot" }, {
      id: "create-me",
      order: 1,
    });

    if (!unchanged || !updated || !created) throw new Error("expected fixture drawings");

    const remoteUnchanged = {
      id: "remote-same",
      tool_type: "hline",
      coordinates: {
        drawing_id: "same",
        timeframe: "1D",
        workspace_id: "slot",
        price: 20,
        layer_order: 0,
      },
      style: { color: unchanged.style.color, lineWidth: unchanged.style.lineWidth, lineStyle: unchanged.style.lineStyle },
    };
    const remoteUpdated = {
      id: "remote-update",
      tool_type: "ray",
      coordinates: {
        drawing_id: "update-me",
        timeframe: "1D",
        workspace_id: "slot",
        anchors: updated.anchors,
        layer_order: 0,
      },
      style: { color: updated.style.color, lineWidth: updated.style.lineWidth, lineStyle: updated.style.lineStyle },
    };
    const remoteDeleted = {
      id: "remote-delete",
      tool_type: "hline",
      coordinates: {
        drawing_id: "delete-me",
        timeframe: "1D",
        workspace_id: "slot",
        price: 88,
      },
      style: { color: "#00ff00", lineWidth: 1 },
    };

    const plan = buildDrawingSyncPlan([unchanged, updated, created], [remoteUnchanged, remoteUpdated, remoteDeleted], {
      timeframe: "1D",
      workspaceId: "slot",
    });

    expect(plan.create.map((drawing) => drawing.id)).toEqual(["create-me"]);
    expect(plan.update).toEqual([
      expect.objectContaining({
        remoteId: "remote-same",
        drawing: expect.objectContaining({ id: "same", order: 0 }),
      }),
      expect.objectContaining({
        remoteId: "remote-update",
        drawing: expect.objectContaining({ id: "update-me", order: 2 }),
      }),
    ]);
    expect(plan.delete).toEqual(["remote-delete"]);
  });

  it("renders the object tree for persisted drawings and emits alert drafts", () => {
    const drawing = createDrawing("hline", [{ time: 100, price: 123.45 }], { timeframe: "1D", workspaceId: "slot-alerts" }, {
      id: "hl-1",
      order: 0,
      style: { color: "#4dd0e1", lineWidth: 1, lineStyle: "dashed" },
    });
    if (!drawing) throw new Error("expected fixture drawing");

    const onSelect = vi.fn();
    const onToggleVisibility = vi.fn();
    const onToggleLocked = vi.fn();
    const onMoveLayer = vi.fn();
    const onRequestCreateAlert = vi.fn();

    render(
      <DrawingObjectTree
        drawings={[drawing]}
        selectedDrawingId={null}
        onSelect={onSelect}
        onToggleVisibility={onToggleVisibility}
        onToggleLocked={onToggleLocked}
        onMoveLayer={onMoveLayer}
        onCreateAlert={(drawingId) => {
          const draft = buildDrawingAlertDraft({
            symbol: "AAPL",
            market: "US",
            timeframe: "1D",
            panelId: "slot-alerts",
            workspaceId: "slot-alerts",
            currentPrice: 121.5,
            referenceTime: 1_700_000_000,
            drawing: drawingId === drawing.id ? drawing : null,
          });
          if (draft) onRequestCreateAlert(draft);
        }}
        alertableDrawingIds={[drawing.id]}
      />,
    );

    expect(screen.getByTestId("drawing-object-tree")).toBeInTheDocument();
    expect(screen.getByText("Horizontal Line")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Horizontal Line" }));
    fireEvent.click(screen.getByTestId("drawing-alert-hl-1"));

    expect(onSelect).toHaveBeenCalledWith("hl-1");
    expect(onRequestCreateAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        threshold: 123.45,
        chartContext: expect.objectContaining({
          source: "drawing",
          sourceLabel: "Horizontal Line",
          workspaceId: "slot-alerts",
        }),
      }),
    );
  });
});
