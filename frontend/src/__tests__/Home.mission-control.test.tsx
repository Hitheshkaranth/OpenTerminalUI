import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MissionControlGrid } from "../components/home/MissionControlGrid";

const subscribeSpy = vi.fn();
const unsubscribeSpy = vi.fn();

vi.mock("../hooks/useStocks", () => ({
  useMarketStatus: () => ({ data: { marketState: [{ marketStatus: "OPEN" }] } }),
}));

vi.mock("../store/settingsStore", () => ({
  useSettingsStore: (selector: (state: { selectedMarket: string }) => unknown) =>
    selector({ selectedMarket: "NSE" }),
}));

vi.mock("../realtime/useQuotesStream", () => ({
  useQuotesStream: () => ({ subscribe: subscribeSpy, unsubscribe: unsubscribeSpy }),
  useQuotesStore: (selector: (state: { ticksByToken: Record<string, { ltp: number; change_pct: number }> }) => unknown) =>
    selector({
      ticksByToken: {
        "NSE:NIFTY": { ltp: 22400.5, change_pct: 0.83 },
        "NSE:BANKNIFTY": { ltp: 47890.25, change_pct: -0.24 },
        "NSE:INDIAVIX": { ltp: 12.35, change_pct: 0.11 },
      },
    }),
}));

describe("MissionControlGrid", () => {
  afterEach(() => {
    subscribeSpy.mockClear();
    unsubscribeSpy.mockClear();
  });

  it("renders mission panels and binds websocket subscriptions", () => {
    const { unmount } = render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <MissionControlGrid />
      </MemoryRouter>,
    );

    expect(screen.getByText("Market Pulse")).toBeInTheDocument();
    expect(screen.getByText("Launch Matrix")).toBeInTheDocument();
    expect(screen.getByText("System Snapshot")).toBeInTheDocument();
    expect(screen.getByText("22,400.50")).toBeInTheDocument();
    expect(screen.getByText("+0.83%")).toBeInTheDocument();

    expect(subscribeSpy).toHaveBeenCalledWith(["NIFTY", "BANKNIFTY", "INDIAVIX"]);

    unmount();
    expect(unsubscribeSpy).toHaveBeenCalledWith(["NIFTY", "BANKNIFTY", "INDIAVIX"]);
  });
});
