import type { ReactNode } from "react";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchBacktestV1Presets,
  fetchLatestNews,
  fetchPortfolio,
  fetchPortfolioBenchmarkOverlay,
  fetchQuotesBatch,
  fetchWatchlist,
} from "../api/client";
import { fetchChainSummary } from "../fno/api/fnoApi";
import { HomePage } from "../pages/HomePage";

const navigateSpy = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

vi.mock("../components/layout/TerminalShell", () => ({
  TerminalShell: ({
    children,
    statusBarTickerOverride,
  }: {
    children: ReactNode;
    statusBarTickerOverride?: string;
  }) => (
    <div data-testid="terminal-shell" data-status-bar={statusBarTickerOverride}>
      {children}
    </div>
  ),
}));

vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => ({
    user: {
      id: "user-1",
      email: "desk@openterminal.dev",
      role: "trader",
    },
  }),
}));

vi.mock("../store/settingsStore", () => ({
  useSettingsStore: (
    selector: (state: {
      selectedMarket: string;
      displayCurrency: "INR" | "USD";
      realtimeMode: "polling" | "ws";
      newsAutoRefresh: boolean;
      newsRefreshSec: number;
    }) => unknown,
  ) =>
    selector({
      selectedMarket: "NSE",
      displayCurrency: "INR",
      realtimeMode: "polling",
      newsAutoRefresh: true,
      newsRefreshSec: 60,
    }),
}));

vi.mock("../api/client", () => ({
  fetchPortfolio: vi.fn(),
  fetchWatchlist: vi.fn(),
  fetchBacktestV1Presets: vi.fn(),
  fetchPortfolioBenchmarkOverlay: vi.fn(),
  fetchLatestNews: vi.fn(),
  fetchQuotesBatch: vi.fn(),
}));

vi.mock("../fno/api/fnoApi", () => ({
  fetchChainSummary: vi.fn(),
}));

function renderPage() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <HomePage />
    </MemoryRouter>,
  );
}

describe("HomePage mission-control revamp", () => {
  beforeEach(() => {
    vi.useRealTimers();
    navigateSpy.mockReset();
    sessionStorage.clear();

    vi.mocked(fetchPortfolio).mockResolvedValue({
      items: [
        { current_value: 1000000 },
        { current_value: 1480000 },
      ],
      summary: {
        total_cost: 2310000,
        total_value: 2480000,
        overall_pnl: 170000,
      },
    } as any);

    vi.mocked(fetchWatchlist).mockResolvedValue([
      { has_futures: true, has_options: false },
      { has_futures: false, has_options: false },
      { has_futures: false, has_options: true },
    ] as any);

    vi.mocked(fetchBacktestV1Presets).mockResolvedValue([{ id: "preset-1" }, { id: "preset-2" }] as any);

    vi.mocked(fetchChainSummary).mockResolvedValue({
      spot_price: 22345.65,
      pcr: {
        pcr_oi: 0.91,
        signal: "bullish",
      },
    } as any);

    vi.mocked(fetchPortfolioBenchmarkOverlay).mockResolvedValue({
      benchmark: "NIFTY50",
      alpha: 0.02,
      tracking_error: 0.12,
      equity_curve: [
        { date: "2026-02-20", portfolio: 2300000, benchmark: 2210000 },
        { date: "2026-02-27", portfolio: 2380000, benchmark: 2260000 },
        { date: "2026-03-05", portfolio: 2440000, benchmark: 2310000 },
        { date: "2026-03-10", portfolio: 2480000, benchmark: 2350000 },
      ],
    } as any);

    vi.mocked(fetchLatestNews).mockResolvedValue([
      {
        id: "news-1",
        title: "RBI signals steady liquidity support for domestic markets",
        source: "Reuters",
        url: "https://example.com/rbi-liquidity",
        published_at: "2026-03-11T10:15:00.000Z",
        sentiment: {
          label: "Bullish",
          confidence: 0.87,
          score: 0.42,
        },
      },
      {
        id: "news-2",
        title: "Semiconductor rally lifts NASDAQ futures into the open",
        source: "Bloomberg",
        url: "https://example.com/nasdaq-futures",
        published_at: "2026-03-11T09:45:00.000Z",
      },
    ] as any);

    vi.mocked(fetchQuotesBatch).mockResolvedValue({
      market: "NSE",
      quotes: [
        { symbol: "^NSEI", last: 22450.25, change: 145.1, changePct: 0.65, ts: "2026-03-11T12:00:00.000Z" },
        { symbol: "^BSESN", last: 73900.12, change: -120.2, changePct: -0.16, ts: "2026-03-11T12:00:00.000Z" },
        { symbol: "^IXIC", last: 18340.22, change: 88.4, changePct: 0.48, ts: "2026-03-11T12:00:00.000Z" },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it("preserves the existing loaders while rendering the new mission-control layout", async () => {
    renderPage();

    await waitFor(() => {
      expect(fetchPortfolio).toHaveBeenCalledTimes(1);
      expect(fetchWatchlist).toHaveBeenCalledTimes(1);
      expect(fetchBacktestV1Presets).toHaveBeenCalledTimes(1);
      expect(fetchChainSummary).toHaveBeenCalledWith("NIFTY");
      expect(fetchPortfolioBenchmarkOverlay).toHaveBeenCalledTimes(1);
      expect(fetchLatestNews).toHaveBeenCalledWith(15);
      expect(fetchQuotesBatch).toHaveBeenCalledWith(
        ["^NSEI", "^BSESN", "^IXIC", "^GSPC", "GC=F", "SI=F", "CL=F"],
        "NSE",
      );
    });

    expect(screen.getByTestId("terminal-shell")).toHaveAttribute("data-status-bar", "MISSION CONTROL");
    expect(screen.getByRole("list", { name: "Market heat strip" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Portfolio HQ" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "System Health" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Launch Matrix" })).toBeInTheDocument();

    const equityValueLabel = `INR ${2480000..toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
    expect(screen.getAllByText(equityValueLabel).length).toBeGreaterThan(0);
    expect(screen.getByText("+INR 1,70,000 (+7.36%)")).toBeInTheDocument();
    expect(screen.getByText("RBI signals steady liquidity support for domestic markets")).toBeInTheDocument();
    expect(screen.getByText("Bullish 87%")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Workstation. EQUITY desk access" }));
    expect(navigateSpy).toHaveBeenCalledWith("/equity/chart-workstation");
  }, 10000);

  it("preserves the transition loading overlay before revealing the dashboard", async () => {
    vi.useFakeTimers({ now: new Date("2026-03-11T12:00:00.000Z") });
    sessionStorage.setItem("ot-terminal-transition", "1");

    renderPage();

    expect(screen.getByRole("status")).toHaveTextContent("Initializing Mission Control");
    expect(screen.queryByRole("main", { name: "Mission Control Dashboard" })).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1300);
    });
    expect(screen.getByRole("main", { name: "Mission Control Dashboard" })).toBeInTheDocument();
    expect(sessionStorage.getItem("ot-terminal-transition")).toBeNull();
  }, 10000);
});
