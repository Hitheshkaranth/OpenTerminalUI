import { describe, expect, it } from "vitest";

import {
  CUSTOM_SPLIT_TEMPLATE,
  makeDefaultLinkGroups,
  normalizeCompareSymbols,
  normalizeWorkspaceLinkSettings,
  parseWorkspaceTemplateConfig,
  propagateLinkedSlots,
  resolveCompareSlotIds,
} from "../pages/ChartWorkstationPage";
import type { ChartSlot } from "../store/chartWorkstationStore";

function slot(id: string, ticker: string | null): ChartSlot {
  return {
    id,
    ticker,
    companyName: null,
    market: "US",
    timeframe: "1D",
    chartType: "candle",
    indicators: [],
    extendedHours: {
      enabled: true,
      showPreMarket: true,
      showAfterHours: true,
      visualMode: "merged",
      colorScheme: "dimmed",
    },
    preMarketLevels: {
      showPMHigh: true,
      showPMLow: true,
      showPMOpen: false,
      showPMVWAP: false,
      extendIntoRTH: true,
      daysToShow: 1,
    },
  };
}

describe("chart workstation linking helpers", () => {
  it("builds default link groups with first slot linked to A", () => {
    const groups = makeDefaultLinkGroups([slot("s1", "AAPL"), slot("s2", "MSFT")]);
    expect(groups.s1).toBe("A");
    expect(groups.s2).toBe("off");
  });

  it("propagates updates only within same link group", () => {
    const slots = [slot("s1", "AAPL"), slot("s2", "MSFT"), slot("s3", "NVDA")];
    const groups = { s1: "A", s2: "A", s3: "B" } as const;
    const next = propagateLinkedSlots(slots, groups, "s1", (row) => ({ ...row, ticker: "TSLA" }));

    expect(next.find((s) => s.id === "s2")?.ticker).toBe("TSLA");
    expect(next.find((s) => s.id === "s3")?.ticker).toBe("NVDA");
  });

  it("does not propagate when source slot is unlinked", () => {
    const slots = [slot("s1", "AAPL"), slot("s2", "MSFT"), slot("s3", "NVDA")];
    const groups = { s1: "off", s2: "A", s3: "A" } as const;
    const next = propagateLinkedSlots(slots, groups, "s1", (row) => ({ ...row, ticker: "TSLA" }));

    expect(next.find((s) => s.id === "s1")?.ticker).toBe("AAPL");
    expect(next.find((s) => s.id === "s2")?.ticker).toBe("MSFT");
    expect(next.find((s) => s.id === "s3")?.ticker).toBe("NVDA");
  });

  it("exposes custom split layout template", () => {
    expect(CUSTOM_SPLIT_TEMPLATE.arrangement).toBe("custom");
    expect(CUSTOM_SPLIT_TEMPLATE.customAreas).toContain("a a b");
  });

  it("normalizes compare symbols by uppercasing, deduping, and excluding active", () => {
    expect(normalizeCompareSymbols([" msft ", "nvda", "MSFT", "AAPL", "qqq"], "AAPL")).toEqual(["MSFT", "NVDA", "QQQ"]);
  });

  it("normalizes explicit link settings with legacy sync fallbacks", () => {
    expect(normalizeWorkspaceLinkSettings(null, { syncCrosshair: false, syncTimeframe: false })).toEqual({
      symbol: true,
      interval: false,
      crosshair: false,
      replay: false,
      dateRange: false,
    });
    expect(normalizeWorkspaceLinkSettings({ symbol: false, replay: true, dateRange: true })).toMatchObject({
      symbol: false,
      replay: true,
      dateRange: true,
      interval: true,
      crosshair: true,
    });
  });

  it("resolves compare placement across active, linked, and all panes", () => {
    const slots = [slot("s1", "AAPL"), slot("s2", "MSFT"), slot("s3", "NVDA")];
    const groups = { s1: "A", s2: "A", s3: "B" } as const;

    expect(resolveCompareSlotIds(slots, "s1", groups, "active")).toEqual(["s1"]);
    expect(resolveCompareSlotIds(slots, "s1", groups, "linked")).toEqual(["s1", "s2"]);
    expect(resolveCompareSlotIds(slots, "s1", groups, "all")).toEqual(["s1", "s2", "s3"]);
  });

  it("parses saved workstation template config and legacy panel templates", () => {
    const saved = parseWorkspaceTemplateConfig({
      slots: [
        { ticker: "AAPL", market: "US", timeframe: "1D", chartType: "candle" },
        { ticker: "MSFT", market: "US", timeframe: "1h", chartType: "line" },
      ],
      gridTemplate: { cols: 2, rows: 1, arrangement: "grid" },
      syncCrosshair: false,
      syncTimeframe: false,
      linkSettings: { replay: true, dateRange: true },
      linkGroups: { placeholder: "off" },
      compareSymbols: ["NVDA", "QQQ"],
      compareConfig: { mode: "price", placement: "linked" },
      rangePresets: { placeholder: "1Y" },
    });
    expect(saved?.snapshot.slots).toHaveLength(2);
    expect(saved?.snapshot.gridTemplate.cols).toBe(2);
    expect(saved?.snapshot.syncCrosshair).toBe(false);
    expect(saved?.compareSymbols).toEqual(["NVDA", "QQQ"]);
    expect(saved?.linkSettings.interval).toBe(false);
    expect(saved?.linkSettings.replay).toBe(true);
    expect(saved?.compareConfig).toEqual({ mode: "price", placement: "linked" });
    expect(saved?.rangePresets[saved?.snapshot.slots[0]?.id ?? ""]).toBe("6M");

    const legacy = parseWorkspaceTemplateConfig({
      panels: [
        { ticker: "TSLA", timeframe: "15m", market: "US" },
        { ticker: "AMD", timeframe: "1D", market: "US" },
      ],
      link_groups: { ignored: "A" },
    });
    expect(legacy?.snapshot.slots).toHaveLength(2);
    expect(legacy?.snapshot.gridTemplate.cols).toBe(2);
    expect(legacy?.snapshot.slots[0]?.ticker).toBe("TSLA");
    expect(legacy?.snapshot.slots[1]?.timeframe).toBe("1D");
    expect(legacy?.compareConfig).toEqual({ mode: "normalized", placement: "active" });
  });

  it("defaults imported layouts without market metadata to the workstation market baseline", () => {
    const parsed = parseWorkspaceTemplateConfig({
      slots: [{ ticker: "INFY", timeframe: "1D", chartType: "candle" }],
    });

    expect(parsed?.snapshot.slots[0]?.market).toBe("IN");
  });
});
