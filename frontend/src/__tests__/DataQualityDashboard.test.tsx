import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchDataQualityHealth } from "../api/dataQuality";
import { DataQualityDashboard } from "../pages/DataQualityDashboard";
vi.mock("../api/dataQuality", async (original) => ({ ...await original<typeof import("../api/dataQuality")>(), fetchDataQualityHealth: vi.fn() }));
const renderPage = () => render(<MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><DataQualityDashboard /></QueryClientProvider></MemoryRouter>);
describe("Data Quality Dashboard", () => {
  beforeEach(() => vi.clearAllMocks());
  it("shows closed and unknown sessions separately with their calendar scope", async () => {
    vi.mocked(fetchDataQualityHealth).mockResolvedValue({ status: "unknown", coverage: { monitored: 2, known_sessions: 1, closed: 1, unknown: 1 }, symbols: [
      { symbol: "NSE:TCS", provider_source: "kite", market: "NSE", health_status: "closed", session_state: "closed", session_scope: "regular", timezone: "Asia/Kolkata", calendar_coverage: "bundled_years:2026", bars_expected_today: 375, bars_received_today: 370, last_tick_time: null, average_latency_ms: 0, ticks_per_minute: 0 },
      { symbol: "XYZ", provider_source: "custom", health_status: "unknown", session_state: "unknown", bars_expected_today: null, bars_received_today: 0, last_tick_time: null, average_latency_ms: 0, ticks_per_minute: 0 },
    ] });
    renderPage();
    expect(await screen.findByRole("link", { name: "NSE:TCS" })).toHaveAttribute("href", "/equity/security?ticker=NSE%3ATCS");
    expect(screen.getByText("Asia/Kolkata", { exact: false })).toBeInTheDocument();
    const unknownRow = screen.getByRole("link", { name: "XYZ" }).closest("tr")!;
    expect(within(unknownRow).getByText("0 / Unknown")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter feed coverage"), { target: { value: "closed" } });
    expect(screen.queryByRole("link", { name: "XYZ" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Search monitored symbols"), { target: { value: "no-match" } });
    expect(screen.getByText("No feeds match your filters")).toBeInTheDocument();
  });
  it("explains empty monitoring without implying healthy live data", async () => {
    vi.mocked(fetchDataQualityHealth).mockResolvedValue({ status: "no_data", symbols: [], coverage: { monitored: 0, known_sessions: 0, closed: 0, unknown: 0 } });
    renderPage();
    expect(await screen.findByText("No monitored symbols yet")).toBeInTheDocument();
    expect(screen.getByText(/empty monitor does not establish live coverage/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open watchlists" })).toHaveAttribute("href", "/equity/watchlist");
  });
  it("distinguishes unavailable monitoring from an empty feed monitor", async () => {
    vi.mocked(fetchDataQualityHealth).mockResolvedValue({ status: "partial", unavailable_sources: ["Feed monitoring"] });
    renderPage();
    expect(await screen.findByText("Feed monitoring unavailable")).toBeInTheDocument();
    expect(screen.queryByText("No monitored symbols yet")).toBeNull();
  });
});
