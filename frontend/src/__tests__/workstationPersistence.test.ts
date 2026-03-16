import { describe, expect, it } from "vitest";

import {
  WORKSTATION_BOUNDARY_SUMMARY,
  buildWorkstationExportFilename,
  buildWorkstationSnapshotPayload,
  createWorkstationSnapshotRecord,
  decodeWorkstationSharePayload,
  encodeWorkstationSharePayload,
  isolateWorkstationLayoutConfig,
  normalizeStoredWorkstationSnapshots,
} from "../shared/chart/workstationPersistence";

describe("workstationPersistence", () => {
  it("isolates slot ids for reusable layout payloads and remaps keyed slot records", () => {
    const isolated = isolateWorkstationLayoutConfig(
      {
        slots: [
          { id: "slot-1", ticker: "AAPL", timeframe: "1D" },
          { id: "slot-2", ticker: "MSFT", timeframe: "1h" },
        ],
        linkGroups: { "slot-1": "A", "slot-2": "B" },
        link_groups: { "slot-1": "A", "slot-2": "B" },
        rangePresets: { "slot-1": "6M", "slot-2": "1Y" },
      },
      (() => {
        const ids = ["fresh-1", "fresh-2"];
        return () => ids.shift() ?? "fallback";
      })(),
    );

    expect(isolated).toMatchObject({
      slots: [
        { id: "fresh-1", ticker: "AAPL", timeframe: "1D" },
        { id: "fresh-2", ticker: "MSFT", timeframe: "1h" },
      ],
      linkGroups: { "fresh-1": "A", "fresh-2": "B" },
      link_groups: { "fresh-1": "A", "fresh-2": "B" },
      rangePresets: { "fresh-1": "6M", "fresh-2": "1Y" },
    });
  });

  it("round-trips deterministic share payloads", () => {
    const payload = buildWorkstationSnapshotPayload("Desk A", {
      slots: [{ id: "slot-1", ticker: "AAPL", timeframe: "1D" }],
      gridTemplate: { cols: 1, rows: 1, arrangement: "grid" },
      compareSymbols: ["QQQ"],
    });

    const encoded = encodeWorkstationSharePayload(payload);
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(decodeWorkstationSharePayload(encoded)).toEqual(payload);
  });

  it("normalizes stored snapshot records and ignores invalid rows", () => {
    const valid = createWorkstationSnapshotRecord(
      "Desk A",
      { slots: [{ id: "slot-1", ticker: "AAPL" }] },
      "2026-03-12T10:00:00.000Z",
    );

    expect(
      normalizeStoredWorkstationSnapshots([
        valid,
        { bad: true },
        { id: "missing-payload", name: "Broken" },
      ]),
    ).toEqual([valid]);
  });

  it("builds deterministic filenames and boundary copy", () => {
    expect(buildWorkstationExportFilename("Linked Desk", "json")).toBe("chart-workstation-linked-desk.json");
    expect(WORKSTATION_BOUNDARY_SUMMARY).toContain("Drawings and chart-surface controls stay pane-scoped");
  });
});
