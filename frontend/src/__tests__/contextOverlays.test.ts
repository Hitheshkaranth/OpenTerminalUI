import { describe, expect, it } from "vitest";

import {
  buildContextOverlayMarkers,
  classifyContextEvent,
  describeMarketState,
  describeSessionState,
  pickFundamentalContext,
} from "../shared/chart/contextOverlays";
import type { CorporateEvent, PitFundamentalsResponse } from "../types";

function event(overrides: Partial<CorporateEvent>): CorporateEvent {
  return {
    symbol: "AAPL",
    event_type: "earnings",
    title: "Quarterly earnings",
    description: "Quarterly earnings",
    event_date: "2026-03-03",
    source: "fixture",
    impact: "neutral",
    ...overrides,
  };
}

describe("contextOverlays helpers", () => {
  it("classifies corporate actions separately from general events", () => {
    expect(classifyContextEvent("dividend")).toBe("action");
    expect(classifyContextEvent("split")).toBe("action");
    expect(classifyContextEvent("earnings")).toBe("event");
  });

  it("maps events onto matching trading days and groups duplicate-day markers", () => {
    const markers = buildContextOverlayMarkers(
      [
        event({ event_type: "earnings", title: "Earnings call", event_date: "2026-03-03" }),
        event({ event_type: "board_meeting", title: "Board update", event_date: "2026-03-03" }),
        event({ event_type: "dividend", title: "Dividend ex-date", event_date: "2026-03-01", ex_date: "2026-03-02" }),
      ],
      [
        { time: Math.floor(new Date("2026-03-02T15:30:00Z").getTime() / 1000), session: "rth" },
        { time: Math.floor(new Date("2026-03-03T15:30:00Z").getTime() / 1000), session: "rth" },
      ],
    );

    expect(markers).toEqual([
      expect.objectContaining({ kind: "action", label: "DIV", time: Math.floor(new Date("2026-03-02T15:30:00Z").getTime() / 1000) }),
      expect.objectContaining({ kind: "event", label: "ER+1", count: 2, time: Math.floor(new Date("2026-03-03T15:30:00Z").getTime() / 1000) }),
    ]);
  });

  it("filters markers outside the current bar range", () => {
    const markers = buildContextOverlayMarkers(
      [event({ event_type: "earnings", title: "Future event", event_date: "2026-03-10" })],
      [{ time: Math.floor(new Date("2026-03-03T15:30:00Z").getTime() / 1000), session: "rth" }],
    );

    expect(markers).toEqual([]);
  });

  it("selects and formats preferred fundamentals", () => {
    const fundamentals: PitFundamentalsResponse = {
      symbol: "AAPL",
      as_of: "2026-03-03",
      data_version_id: "dv-1",
      metrics: {
        market_cap: 1_200_000_000_000,
        pe_ratio: 22.4,
        roe: 0.28,
        dividend_yield: 0.012,
        debt_equity: 0.4,
      },
    };

    expect(pickFundamentalContext(fundamentals)).toEqual([
      { key: "market_cap", label: "Mkt Cap", value: "1.2T" },
      { key: "pe_ratio", label: "P/E", value: "22.4x" },
      { key: "roe", label: "ROE", value: "28.0%" },
      { key: "dividend_yield", label: "Div Yld", value: "1.2%" },
    ]);
  });

  it("derives replay-aware session and market states", () => {
    const bar = { time: Math.floor(new Date("2026-03-03T13:00:00Z").getTime() / 1000), session: "pre" };
    expect(describeSessionState(bar, false)).toEqual(
      expect.objectContaining({ label: "PRE", tone: "info" }),
    );
    expect(describeMarketState({ market: "US", replayEnabled: true, bar, liveMarketStatus: null })).toEqual(
      expect.objectContaining({ label: "REPLAY PRE", tone: "info" }),
    );
    expect(
      describeMarketState({
        market: "IN",
        replayEnabled: false,
        bar,
        liveMarketStatus: { marketState: [{ marketStatus: "OPEN" }] },
      }),
    ).toEqual(expect.objectContaining({ label: "OPEN", tone: "positive" }));
  });
});
