import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { InsiderActivityPage } from "../pages/InsiderActivityPage";

vi.mock("../api/client", () => ({
  fetchRecentInsiderTrades: vi.fn(async () => ({
    trades: [
      {
        date: "2026-04-02",
        symbol: "RELIANCE",
        name: "Reliance Industries",
        insider_name: "Mukesh D Ambani",
        designation: "Chairman",
        type: "buy",
        quantity: 2500,
        price: 2800,
        value: 7_000_000,
        post_holding_pct: null,
      },
    ],
  })),
  fetchTopInsiderBuyers: vi.fn(async () => ({
    buyers: [
      {
        symbol: "RELIANCE",
        name: "Reliance Industries",
        total_value: 15_000_000,
        trade_count: 3,
        avg_price: 2825,
        latest_date: "2026-04-02",
      },
    ],
  })),
  fetchTopInsiderSellers: vi.fn(async () => ({
    sellers: [
      {
        symbol: "TCS",
        name: "Tata Consultancy Services",
        total_value: 9_000_000,
        trade_count: 2,
        avg_price: 4100,
        latest_date: "2026-04-01",
      },
    ],
  })),
  fetchInsiderClusterBuys: vi.fn(async () => ({
    clusters: [
      {
        symbol: "RELIANCE",
        name: "Reliance Industries",
        insider_count: 3,
        total_value: 18_000_000,
        insiders: [
          { name: "Mukesh D Ambani", designation: "Chairman", value: 7_000_000, date: "2026-04-02" },
          { name: "Sandeep Batra", designation: "Executive Director", value: 6_000_000, date: "2026-04-01" },
          { name: "Keki M Mistry", designation: "Independent Director", value: 5_000_000, date: "2026-03-30" },
        ],
      },
    ],
  })),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <InsiderActivityPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("InsiderActivityPage", () => {
  it("renders summary cards and switches tabs", async () => {
    renderPage();

    await screen.findByText("Total Buy Value (30d)");
    await screen.findByText("Cluster Buy Stocks");
    await screen.findByText("Dense Table");

    fireEvent.click(screen.getByRole("tab", { name: "Cluster Buys" }));
    await screen.findByTestId("cluster-buy-card");

    fireEvent.click(screen.getByRole("tab", { name: "Top Buyers" }));
    await screen.findByText("Value Ladder");
  });
});
