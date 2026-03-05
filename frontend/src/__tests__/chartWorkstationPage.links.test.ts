import { describe, expect, it } from "vitest";

import { CUSTOM_SPLIT_TEMPLATE, makeDefaultLinkGroups, propagateLinkedSlots } from "../pages/ChartWorkstationPage";
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

  it("exposes custom split layout template", () => {
    expect(CUSTOM_SPLIT_TEMPLATE.arrangement).toBe("custom");
    expect(CUSTOM_SPLIT_TEMPLATE.customAreas).toContain("a a b");
  });
});
