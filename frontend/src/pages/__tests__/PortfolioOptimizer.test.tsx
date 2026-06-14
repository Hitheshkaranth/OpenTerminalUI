import React from "react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";

import { PortfolioOptimizer } from "../PortfolioOptimizer";

vi.mock("../../api/portfolioOptimizer", () => ({
  fetchOptimizerMethods: vi.fn(async () => ({
    objectives: [{ id: "min_risk", label: "Minimum Risk" }],
    risk_measures: [{ id: "MV", label: "Mean Variance" }],
    models: [{ id: "Classic", label: "Classic" }],
    covariance_methods: [{ id: "sample", label: "Sample" }],
  })),
  runOptimize: vi.fn(async () => ({
    weights: { RELIANCE: 1.0 },
    metrics: { expected_return: 0.1, volatility: 0.15, sharpe: 0.6, max_drawdown: 0.1 },
    risk_contributions: { RELIANCE: 1.0 },
    asset_metrics: [{ symbol: "RELIANCE", annual_return: 0.1, annual_vol: 0.15, weight: 1.0 }],
    frontier: [{ risk: 0.15, return: 0.1 }],
    selected_point: { risk: 0.15, return: 0.1 },
  })),
}));

vi.mock("recharts", () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Stub,
    ScatterChart: Stub,
    Scatter: Stub,
    CartesianGrid: Stub,
    XAxis: Stub,
    YAxis: Stub,
    Tooltip: Stub,
    Cell: Stub,
    ZAxis: Stub,
  };
});

function renderWithProviders(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        {ui}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("PortfolioOptimizer", () => {
  it("renders the optimizer page with title", async () => {
    renderWithProviders(<PortfolioOptimizer />);
    expect(await screen.findByText("Portfolio Optimizer")).toBeTruthy();
    expect(await screen.findByText("Universe")).toBeTruthy();
    expect(await screen.findByText("Model & Objective")).toBeTruthy();
  });
});
