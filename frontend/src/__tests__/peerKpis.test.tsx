import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { PeerKpiComparison } from "../components/peers/PeerKpiComparison";

vi.mock("../api/peerKpis", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    usePeerKpiComparison: vi.fn(),
  };
});

import { usePeerKpiComparison } from "../api/peerKpis";

const table = {
  symbol: "TATA",
  peers: ["REL", "INFY"],
  rows: [
    {
      key: "order_book",
      label: "Order Book",
      unit: "crore",
      higher_is_better: true,
      values: {
        TATA: { value: 5000, unit: "crore", period: "FY25", citation: null },
        REL: { value: 3000, unit: "crore", period: "FY25", citation: null },
        INFY: { value: null, unit: null, period: null, citation: null },
      },
    },
    {
      key: "pe",
      label: "P/E",
      unit: null,
      higher_is_better: false,
      values: {
        TATA: { value: 18, unit: null, period: null, citation: null },
        REL: { value: 22, unit: null, period: null, citation: null },
        INFY: { value: 14, unit: null, period: null, citation: null },
      },
    },
  ],
  financial_rows: [
    {
      key: "revenue_growth",
      label: "Revenue Growth %",
      unit: "%",
      higher_is_better: true,
      values: {
        TATA: { value: 12, unit: "%", period: null, citation: null },
        REL: { value: 8, unit: "%", period: null, citation: null },
        INFY: { value: 15, unit: "%", period: null, citation: null },
      },
    },
  ],
  missing: ["MSP"],
  warnings: ["Some peers have no KPI coverage."],
};

beforeEach(() => {
  (usePeerKpiComparison as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    data: table,
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => Promise.resolve(),
  });
});

describe("PeerKpiComparison", () => {
  it("renders the matrix, highlights the best value per row, and links missing peers", () => {
    render(
      <MemoryRouter>
        <PeerKpiComparison symbol="TATA" market="NSE" />
      </MemoryRouter>,
    );

    // Company + peer column headers.
    expect(screen.getAllByText("TATA").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\bREL\b/).length).toBeGreaterThan(0);

    // Metric labels render.
    expect(screen.getByText("Order Book")).toBeInTheDocument();
    expect(screen.getByText("Financial comparison")).toBeInTheDocument();

    // Best values (Order Book -> TATA 5,000 crore; P/E -> INFY 14; growth -> INFY 15%)
    // are highlighted across both tables, in an order-independent way.
    const best = document.querySelectorAll("[data-best='true']");
    expect(best.length).toBeGreaterThanOrEqual(3);
    const bestText = Array.from(best).map((el) => el.textContent ?? "").join("|");
    expect(bestText).toContain("5,000 crore");
    expect(bestText).toContain("14");

    // Null-safe dash is rendered where a peer has no value.
    expect(screen.getByText("—")).toBeInTheDocument();

    // Missing peers link to the Hub Filings tab.
    const missingLinks = document.querySelectorAll("a[href*='MSP'][href*='tab=filings']");
    expect(missingLinks.length).toBeGreaterThan(0);
  });
});