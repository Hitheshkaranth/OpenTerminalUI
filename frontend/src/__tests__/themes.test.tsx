import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SectorRotationPage } from "../pages/SectorRotation";
import {
  fetchThemeDetail,
  fetchThemes,
  type ThemeDetail,
  type ThemeSummary,
} from "../api/ideasThemes";

vi.mock("../api/ideasThemes", async (importActual) => {
  const actual = await importActual<typeof import("../api/ideasThemes")>();
  return {
    ...actual,
    fetchThemes: vi.fn(),
    fetchThemeDetail: vi.fn(),
  };
});

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function renderThemes(viewParam = "themes") {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[`/sector-rotation?view=${viewParam}`]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <SectorRotationPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Sector Rotation Themes view", () => {
  beforeEach(() => {
    queryClient.clear();

    const themes: ThemeSummary[] = [
      {
        id: "emerging-motors",
        name: "Emerging Motors",
        description: "Electrification supply chain",
        market: "IN",
        constituents: 42,
        return_1m: 3.1,
        return_3m: 7.4,
        return_6m: 12.0,
        return_1y: 21.5,
        vs_benchmark_1y: 6.1,
      },
      {
        id: "clean-energy",
        name: "Clean Energy",
        description: "Solar and wind",
        market: "IN",
        constituents: 31,
        return_1m: -1.2,
        return_3m: 2.0,
        return_6m: 4.5,
        return_1y: 8.0,
        vs_benchmark_1y: -1.4,
      },
    ];

    (fetchThemes as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      market: "IN",
      benchmark: "NIFTY Green",
      themes,
    });

    (fetchThemeDetail as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "emerging-motors",
      name: "Emerging Motors",
      description: "Electrification supply chain",
      market: "IN",
      constituents: 42,
      return_1m: 3.1,
      return_3m: 7.4,
      return_6m: 12.0,
      return_1y: 21.5,
      vs_benchmark_1y: 6.1,
      benchmark: "NIFTY Green",
      series: [
        { date: "2026-01-01", index: 100, benchmark: 100 },
        { date: "2026-02-01", index: 110, benchmark: 104 },
        { date: "2026-03-01", index: 121, benchmark: 108 },
      ],
      members: [
        { symbol: "TATA MOTORS", name: "Tata Motors", weight: 18.5, last: 1024.5, return_1y: 30.2 },
        { symbol: "AAPL", name: "Apple", weight: 5.1, last: 182.3, return_1y: 12.0 },
      ],
    } as unknown as ThemeDetail);
  });

  it("renders the themes table", async () => {
    renderThemes();
    await screen.findByText("Emerging Motors");
    expect(screen.getByText("Clean Energy")).toBeInTheDocument();
    expect(screen.getByText(/NIFTY Green/)).toBeInTheDocument();
  });

  it("switches the market toggle and re-loads the desk", async () => {
    renderThemes();
    await screen.findByText("Emerging Motors");

    (fetchThemes as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      market: "US",
      benchmark: "S&P 500",
      themes: [
        {
          id: "ai-semis",
          name: "AI Semiconductors",
          description: "Compute supply chain",
          market: "US",
          constituents: 18,
          return_1m: 4.2,
          return_3m: 15.1,
          return_6m: 28.0,
          return_1y: 54.0,
          vs_benchmark_1y: 12.3,
        },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: /us/i }));
    await screen.findByText("AI Semiconductors");
    expect(screen.queryByText("Emerging Motors")).not.toBeInTheDocument();
  });

  it("opens theme detail with the series chart and members table", async () => {
    renderThemes();
    await screen.findByText("Emerging Motors");

    fireEvent.click(screen.getByRole("button", { name: /emerging motors/i }));

    await screen.findByText(/rebased to 100/i);
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText("Tata Motors")).toBeInTheDocument();
  });
});