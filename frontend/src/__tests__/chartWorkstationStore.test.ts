import { describe, it, expect, beforeEach } from "vitest";
import { useChartWorkstationStore } from "../store/chartWorkstationStore";

describe("chartWorkstationStore", () => {
  beforeEach(() => {
    useChartWorkstationStore.setState({
      slots: [{ id: "test-init", ticker: null, market: "IN", timeframe: "1D", chartType: "candle", indicators: [] }],
      activeSlotId: null,
      gridTemplate: { cols: 1, rows: 1, arrangement: "grid" },
      syncCrosshair: true,
      syncTimeframe: false,
    });
  });

  it("starts with one empty slot", () => {
    const { slots } = useChartWorkstationStore.getState();
    expect(slots).toHaveLength(1);
    expect(slots[0].ticker).toBeNull();
  });

  it("addSlot appends a new empty slot (max 6)", () => {
    const store = useChartWorkstationStore.getState();
    store.addSlot();
    expect(useChartWorkstationStore.getState().slots).toHaveLength(2);
    for (let i = 0; i < 4; i++) useChartWorkstationStore.getState().addSlot();
    expect(useChartWorkstationStore.getState().slots).toHaveLength(6);
    useChartWorkstationStore.getState().addSlot();
    expect(useChartWorkstationStore.getState().slots).toHaveLength(6);
  });

  it("removeSlot removes a slot by id", () => {
    const store = useChartWorkstationStore.getState();
    store.addSlot();
    const { slots } = useChartWorkstationStore.getState();
    const idToRemove = slots[1].id;
    useChartWorkstationStore.getState().removeSlot(idToRemove);
    expect(useChartWorkstationStore.getState().slots).toHaveLength(1);
  });

  it("does not remove last slot", () => {
    const { slots, removeSlot } = useChartWorkstationStore.getState();
    removeSlot(slots[0].id);
    expect(useChartWorkstationStore.getState().slots).toHaveLength(1);
  });

  it("updateSlotTicker changes ticker and market", () => {
    const { slots, updateSlotTicker } = useChartWorkstationStore.getState();
    updateSlotTicker(slots[0].id, "RELIANCE", "IN");
    const updated = useChartWorkstationStore.getState().slots[0];
    expect(updated.ticker).toBe("RELIANCE");
    expect(updated.market).toBe("IN");
  });

  it("setGridTemplate updates template", () => {
    const { setGridTemplate } = useChartWorkstationStore.getState();
    setGridTemplate({ cols: 3, rows: 2, arrangement: "grid" });
    expect(useChartWorkstationStore.getState().gridTemplate.cols).toBe(3);
    expect(useChartWorkstationStore.getState().gridTemplate.rows).toBe(2);
  });
});
