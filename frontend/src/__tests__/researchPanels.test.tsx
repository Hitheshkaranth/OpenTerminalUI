import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AllocationPanel, PeersPanel, RiskMetricsPanel } from "../components/layout/ResearchPanels";
import { fetchSectorAllocation, fetchPeers, fetchPortfolioRiskMetrics } from "../api/client";
import type { LaunchpadPanelConfig } from "../components/layout/LaunchpadContext";
vi.mock("../api/client", () => ({ fetchSectorAllocation: vi.fn(), fetchPeers: vi.fn(), fetchPortfolioRiskMetrics: vi.fn(), fetchMacroIndicators: vi.fn(), fetchPortfolioBenchmarkOverlay: vi.fn() }));
vi.mock("../agent/components/artifacts", () => ({ ArtifactView: () => null }));
function wrap(ui: React.ReactNode) { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>); }
const panel: LaunchpadPanelConfig = { id: "p", type: "peers", title: "Peers", symbol: "AAPL", x: 0, y: 0, w: 6, h: 4 };
describe("Research workspace data panels", () => {
  beforeEach(() => vi.clearAllMocks());
  it("renders returned sector allocations", async () => {
    vi.mocked(fetchSectorAllocation).mockResolvedValue({ total_value: 100, sectors: [{ sector: "Technology", value: 80, weight_pct: 80 }], industries: [] });
    wrap(<AllocationPanel />);
    expect(await screen.findByText("Technology")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
  });
  it("shows unavailable peer values rather than inventing zeroes", async () => {
    vi.mocked(fetchPeers).mockResolvedValue({ ticker: "AAPL", universe: "Technology", metrics: [{ metric: "P/E", target_value: 25, peer_median: null, peer_mean: null, target_percentile: null }] });
    wrap(<PeersPanel panel={panel} />);
    expect(await screen.findByText("Unavailable")).toBeInTheDocument();
    expect(fetchPeers).toHaveBeenCalledWith("AAPL");
  });
  it("offers provider recovery on API failure", async () => {
    vi.mocked(fetchPortfolioRiskMetrics).mockRejectedValue(new Error("Provider offline"));
    wrap(<RiskMetricsPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Data is unavailable");
    expect(screen.getByRole("link", { name: "Check data providers" })).toHaveAttribute("href", "/equity/settings?section=providers");
  });
});
