import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LaunchpadWatchlistPanel } from "../components/layout/LaunchpadPanels";

const navigateMock = vi.fn();
const subscribeMock = vi.fn();
const unsubscribeMock = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(() => ({
    data: [
      { id: "1", ticker: "AAPL", watchlist_name: "Default" },
      { id: "2", ticker: "MSFT", watchlist_name: "Default" },
    ],
  })),
}));

vi.mock("../store/settingsStore", () => ({
  useSettingsStore: vi.fn((selector: (state: { selectedMarket: string }) => unknown) => selector({ selectedMarket: "NASDAQ" })),
}));

vi.mock("../realtime/useQuotesStream", () => ({
  useQuotesStream: vi.fn(() => ({
    subscribe: subscribeMock,
    unsubscribe: unsubscribeMock,
    connectionState: "connected",
  })),
  useQuotesStore: vi.fn((selector: (state: { ticksByToken: Record<string, { ltp: number; change_pct: number }> }) => unknown) =>
    selector({
      ticksByToken: {
        "NASDAQ:AAPL": { ltp: 123.45, change_pct: 1.23 },
        "NASDAQ:MSFT": { ltp: 321.0, change_pct: -0.45 },
      },
    }),
  ),
}));

describe("LaunchpadWatchlistPanel", () => {
  it("renders route-consistent live status affordances", () => {
    render(<LaunchpadWatchlistPanel panel={{ id: "p-watch" } as any} />);

    expect(screen.getByText("NASDAQ feed: connected")).toBeInTheDocument();
    expect(screen.getByText("2 symbols")).toBeInTheDocument();
    expect(screen.getByText("123.45")).toBeInTheDocument();
    expect(screen.getByText("1.23%")).toBeInTheDocument();
    expect(screen.getByText("-0.45%")).toBeInTheDocument();
  });
});
