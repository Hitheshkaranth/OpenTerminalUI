import { describe, expect, it } from "vitest";

import {
  DRAWING_SCHEMA_VERSION,
  applyDrawingHandleDrag,
  buildDrawingSyncPlan,
  buildRemoteDrawingPayload,
  createDrawing,
  findDrawingHit,
  moveDrawingLayer,
  normalizeRemoteDrawingRecord,
  normalizeStoredDrawingCollection,
  snapDrawingPoint,
} from "../shared/chart/drawingEngine";

describe("drawingEngine", () => {
  it("migrates legacy local drawings into the normalized schema deterministically", () => {
    const legacy = [
      {
        type: "trendline",
        p1: { time: 200, price: 12 },
        p2: { time: 100, price: 10 },
        style: { color: "#ff8800", lineWidth: 3 },
      },
      {
        id: "fixed-hline",
        type: "hline",
        price: 101.5,
      },
    ];

    const first = normalizeStoredDrawingCollection(legacy, { timeframe: "5m", workspaceId: "slot-A" });
    const second = normalizeStoredDrawingCollection(legacy, { timeframe: "5m", workspaceId: "slot-A" });

    expect(first).toHaveLength(2);
    expect(first[0]?.id).toBe(second[0]?.id);
    expect(first[0]?.tool.type).toBe("trendline");
    expect(first[0]?.anchors.map((anchor) => anchor.time)).toEqual([100, 200]);
    expect(first[0]?.style.color).toBe("#ff8800");
    expect(first[0]?.visible).toBe(true);
    expect(first[0]?.locked).toBe(false);
    expect(first[0]?.meta.timeframe).toBe("5m");
    expect(first[0]?.meta.workspaceId).toBe("slot-A");
    expect(first[0]?.version).toBe(DRAWING_SCHEMA_VERSION);
    expect(first[1]?.id).toBe("fixed-hline");
    expect(first[1]?.anchors[0]?.price).toBe(101.5);
  });

  it("normalizes remote payloads with visibility, locking, scope metadata, and layer order", () => {
    const drawing = normalizeRemoteDrawingRecord(
      {
        id: "remote-1",
        tool_type: "rectangle",
        coordinates: {
          drawing_id: "local-box",
          timeframe: "1D",
          workspace_id: "slot-3",
          visible: false,
          locked: true,
          layer_order: 5,
          anchors: [
            { time: 100, price: 10 },
            { time: 120, price: 12 },
          ],
        },
        style: { color: "#11aaee", lineWidth: 4, lineStyle: "dashed", fillColor: "#11aaee", fillOpacity: 28 },
        created_at: "2026-03-12T00:00:00Z",
      },
      { timeframe: "5m", workspaceId: "fallback" },
    );

    expect(drawing).not.toBeNull();
    expect(drawing?.id).toBe("local-box");
    expect(drawing?.remoteId).toBe("remote-1");
    expect(drawing?.visible).toBe(false);
    expect(drawing?.locked).toBe(true);
    expect(drawing?.order).toBe(5);
    expect(drawing?.meta.timeframe).toBe("1D");
    expect(drawing?.meta.workspaceId).toBe("slot-3");
    expect(drawing?.style).toEqual({
      color: "#11aaee",
      lineWidth: 4,
      lineStyle: "dashed",
      fillColor: "#11aaee",
      fillOpacity: 28,
    });
  });

  it("builds deterministic sync plans for creates, updates, and deletes including layer metadata", () => {
    const unchanged = createDrawing("hline", [{ time: 100, price: 20 }], { timeframe: "1D", workspaceId: "slot" }, { id: "same", order: 0 });
    const updated = createDrawing(
      "ray",
      [
        { time: 100, price: 10 },
        { time: 120, price: 12 },
      ],
      { timeframe: "1D", workspaceId: "slot" },
      { id: "update-me", order: 2, style: { color: "#ffaa00", lineWidth: 2 } },
    );
    const created = createDrawing("vline", [{ time: 90, price: 15 }], { timeframe: "1D", workspaceId: "slot" }, { id: "create-me", order: 1 });

    if (!unchanged || !updated || !created) {
      throw new Error("expected fixture drawings");
    }

    const remoteUnchanged = {
      id: "remote-same",
      ...buildRemoteDrawingPayload({ ...unchanged, remoteId: "remote-same" }),
    };
    const remoteUpdated = {
      id: "remote-update",
      ...buildRemoteDrawingPayload({ ...updated, remoteId: "remote-update" }),
      coordinates: { ...buildRemoteDrawingPayload({ ...updated, remoteId: "remote-update" }).coordinates, layer_order: 0 },
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
    expect(plan.update).toHaveLength(1);
    expect(plan.update[0]?.remoteId).toBe("remote-update");
    expect(plan.update[0]?.drawing.id).toBe("update-me");
    expect(plan.update[0]?.drawing.order).toBe(2);
    expect(plan.delete).toEqual(["remote-delete"]);
  });

  it("reorders drawings for object-tree layer operations without corrupting order", () => {
    const a = createDrawing("trendline", [{ time: 10, price: 10 }, { time: 20, price: 20 }], undefined, { id: "a", order: 0 });
    const b = createDrawing("rectangle", [{ time: 30, price: 30 }, { time: 40, price: 20 }], undefined, { id: "b", order: 1 });
    const c = createDrawing("vline", [{ time: 50, price: 25 }], undefined, { id: "c", order: 2 });
    if (!a || !b || !c) throw new Error("expected drawings");

    const moved = moveDrawingLayer([a, b, c], "a", "front");
    expect(moved.map((drawing) => `${drawing.id}:${drawing.order}`)).toEqual(["b:0", "c:1", "a:2"]);
  });

  it("snaps time to the nearest candle and price to ohlc levels within tolerance", () => {
    const snapped = snapDrawingPoint(
      { time: 106, price: 101.1 },
      [
        { time: 100, open: 100, high: 102, low: 99, close: 101 },
        { time: 110, open: 103, high: 104, low: 102, close: 103.5 },
      ],
    );

    expect(snapped.time).toBe(110);
    expect(snapped.price).toBe(103);
    expect(snapped.snappedTime).toBe(true);
    expect(snapped.snappedPrice).toBe(true);
  });

  it("finds drawing hits across the new tool families", () => {
    const trendline = createDrawing(
      "trendline",
      [
        { time: 10, price: 10 },
        { time: 20, price: 20 },
      ],
      { timeframe: "1D", workspaceId: "slot" },
      { id: "trend" },
    );
    const rectangle = createDrawing(
      "rectangle",
      [
        { time: 25, price: 30 },
        { time: 40, price: 20 },
      ],
      { timeframe: "1D", workspaceId: "slot" },
      { id: "box", order: 1 },
    );
    const vline = createDrawing("vline", [{ time: 55, price: 15 }], { timeframe: "1D", workspaceId: "slot" }, { id: "marker", order: 2 });

    if (!trendline || !rectangle || !vline) {
      throw new Error("expected fixture drawings");
    }

    expect(
      findDrawingHit(
        [trendline, rectangle, vline],
        { x: 30, y: 24 },
        {
          timeToX: (time) => time,
          priceToY: (price) => price,
          fallbackX: 12,
        },
      )?.drawingId,
    ).toBe("box");

    expect(
      findDrawingHit(
        [trendline, rectangle, vline],
        { x: 55, y: 10 },
        {
          timeToX: (time) => time,
          priceToY: (price) => price,
          fallbackX: 12,
        },
      )?.drawingId,
    ).toBe("marker");
  });

  it("does not move locked drawings during drag edits", () => {
    const locked = createDrawing("hline", [{ time: 10, price: 40 }], { timeframe: "1D", workspaceId: "slot" }, {
      id: "locked-level",
      locked: true,
    });
    if (!locked) {
      throw new Error("expected fixture drawing");
    }

    const dragged = applyDrawingHandleDrag(
      locked,
      "level",
      { time: 20, price: 50 },
      [{ time: 20, open: 50, high: 50, low: 50, close: 50 }],
    );

    expect(dragged).toEqual(locked);
  });
});
