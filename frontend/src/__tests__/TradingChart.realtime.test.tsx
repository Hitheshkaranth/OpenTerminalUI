import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useRealtimeChart } from "../shared/chart/useRealtimeChart";

type LegacyStoreState = {
  connectionState: "connected" | "connecting" | "disconnected";
  ticksByToken: Record<string, any>;
  candlesByKey: Record<string, any>;
};

type USStoreState = {
  connectionState: "connected" | "connecting" | "disconnected";
  lastMessageAt: number | null;
  lastTradeBySymbol: Record<string, any>;
  closedBars1mBySymbol: Record<string, any[]>;
  partialBar1mBySymbol: Record<string, any>;
};

const subscribeMock = vi.fn();
const unsubscribeMock = vi.fn();
const subscribeUSMock = vi.fn();
const unsubscribeUSMock = vi.fn();

let legacyStore: LegacyStoreState;
let usStore: USStoreState;

vi.mock("../realtime/useQuotesStream", () => ({
  useQuotesStore: vi.fn((selector: (state: LegacyStoreState) => unknown) => selector(legacyStore)),
  useQuotesStream: vi.fn(() => ({
    subscribe: subscribeMock,
    unsubscribe: unsubscribeMock,
  })),
}));

vi.mock("../realtime/useUsQuotesStream", () => ({
  isUSMarketCode: (market: string) => market.toUpperCase() === "US",
  useUSQuotesStore: vi.fn((selector: (state: USStoreState) => unknown) => selector(usStore)),
  useUSQuotesStream: vi.fn(() => ({
    subscribe: subscribeUSMock,
    unsubscribe: unsubscribeUSMock,
  })),
}));

describe("TradingChart realtime data hooks", () => {
  beforeEach(() => {
    subscribeMock.mockReset();
    unsubscribeMock.mockReset();
    subscribeUSMock.mockReset();
    unsubscribeUSMock.mockReset();

    legacyStore = {
      connectionState: "connected",
      ticksByToken: {},
      candlesByKey: {},
    };
    usStore = {
      connectionState: "connected",
      lastMessageAt: null,
      lastTradeBySymbol: {},
      closedBars1mBySymbol: {},
      partialBar1mBySymbol: {},
    };
  });

  it("subscribes to the legacy stream and applies live intraday candles", async () => {
    const seedBars = [{ time: 60, open: 100, high: 101, low: 99, close: 100.5, volume: 10 }];
    const { result, rerender, unmount } = renderHook(
      ({ revision }: { revision: number }) => {
        void revision;
        return useRealtimeChart(
          "NSE",
          "AAPL",
          "1m",
          seedBars,
          true,
        );
      },
      { initialProps: { revision: 0 } },
    );

    expect(subscribeMock).toHaveBeenCalledWith(["AAPL"]);

    await act(async () => {
      legacyStore.candlesByKey["NSE:AAPL|1m"] = {
        t: 120_000,
        o: 101,
        h: 103,
        l: 100,
        c: 102,
        v: 14,
      };
      rerender({ revision: 1 });
    });

    await waitFor(() => {
      expect(result.current.bars).toEqual([
        { time: 60, open: 100, high: 101, low: 99, close: 100.5, volume: 10 },
        { time: 120, open: 101, high: 103, low: 100, close: 102, volume: 14 },
      ]);
      expect(result.current.realtimeMeta.currentBar).toMatchObject({
        time: 120,
        close: 102,
        volume: 14,
      });
    });

    unmount();
    expect(unsubscribeMock).toHaveBeenCalledWith(["AAPL"]);
  });

  it("aggregates legacy quote ticks into the active bar and reports live metadata", async () => {
    const tickTs = new Date().toISOString();
    const dayBoundary = Math.floor(Date.now() / 86_400_000) * 86_400;
    const seedBars = [{ time: dayBoundary, open: 100, high: 101, low: 99, close: 100.5, volume: 10 }];
    const { result, rerender } = renderHook(
      ({ revision }: { revision: number }) => {
        void revision;
        return useRealtimeChart(
          "NSE",
          "AAPL",
          "1D",
          seedBars,
          true,
        );
      },
      { initialProps: { revision: 0 } },
    );

    await act(async () => {
      legacyStore.ticksByToken["NSE:AAPL"] = {
        ltp: 104,
        change_pct: 1.2,
        volume: 5,
        ts: tickTs,
      };
      rerender({ revision: 1 });
    });

    await waitFor(() => {
      expect(result.current.liveTick).toEqual({ ltp: 104, change_pct: 1.2 });
      expect(result.current.realtimeMeta.status).toBe("live");
      expect(result.current.realtimeMeta.currentBar).toMatchObject({
        close: 104,
        high: 104,
        volume: 15,
      });
    });
  });

  it("prefers US streaming bars and aggregates them into the requested timeframe", async () => {
    usStore.lastMessageAt = Date.now();
    usStore.lastTradeBySymbol.AAPL = { p: 12.4, t: Date.now() };
    usStore.closedBars1mBySymbol.AAPL = [
      { t: 0, o: 10, h: 11, l: 9, c: 10.5, v: 100 },
      { t: 60_000, o: 10.5, h: 12, l: 10, c: 11.2, v: 120 },
    ];
    usStore.partialBar1mBySymbol.AAPL = {
      t: 120_000,
      o: 11.2,
      h: 12.5,
      l: 11,
      c: 12.4,
      v: 80,
    };

    const { result } = renderHook(() => useRealtimeChart("US", "AAPL", "5m", [], true));

    await waitFor(() => {
      expect(subscribeUSMock).toHaveBeenCalledWith(["AAPL"], ["bars", "trades"]);
      expect(result.current.bars).toEqual([
        { time: 0, open: 10, high: 12.5, low: 9, close: 12.4, volume: 300 },
      ]);
      expect(result.current.liveTick).toEqual({ ltp: 12.4, change_pct: 0 });
      expect(result.current.realtimeMeta).toMatchObject({
        status: "live",
        currentBar: {
          time: 0,
          close: 12.4,
          volume: 300,
        },
      });
    });
  });
});
