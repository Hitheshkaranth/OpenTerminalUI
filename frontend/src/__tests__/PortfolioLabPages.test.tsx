import React from "react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen } from "@testing-library/react";

import { PortfolioLabPage } from "../pages/PortfolioLab";
import { PortfolioLabDetailPage } from "../pages/PortfolioLabDetail";
import { PortfolioLabRunReportPage } from "../pages/PortfolioLabRunReport";
import { PortfolioLabBlendsPage } from "../pages/PortfolioLabBlends";

vi.mock("../api/portfolioLab", () => ({
  createPortfolioDefinition: vi.fn(async () => ({ id: "pf_1" })),
  listPortfolioDefinitions: vi.fn(async () => ([{
    id: "pf_1",
    name: "Core",
    description: "",
    tags: ["core"],
    benchmark_symbol: "NIFTY50",
    start_date: "2025-01-01",
    end_date: "2025-12-31",
    rebalance_frequency: "WEEKLY",
    weighting_method: "RISK_PARITY",
    created_at: "2026-02-20",
  }])),
  getPortfolioDefinition: vi.fn(async () => ({
    id: "pf_1",
    name: "Core",
    description: "",
    tags: ["core"],
    benchmark_symbol: "NIFTY50",
    start_date: "2025-01-01",
    end_date: "2025-12-31",
    rebalance_frequency: "WEEKLY",
    weighting_method: "RISK_PARITY",
    created_at: "2026-02-20",
    universe_json: { tickers: ["RELIANCE"] },
    constraints_json: {},
    runs: [{ run_id: "pr_1", portfolio_id: "pf_1", status: "succeeded" }],
  })),
  runPortfolioDefinition: vi.fn(async () => ({ run_id: "pr_2", portfolio_id: "pf_1", status: "succeeded" })),
  createStrategyBlend: vi.fn(async () => ({ id: "blend_1" })),
  listStrategyBlends: vi.fn(async () => ([{ id: "blend_1", name: "Blend", strategies_json: [], blend_method: "WEIGHTED_SUM_RETURNS" }])),
  getPortfolioRunReport: vi.fn(async () => ({
    run_id: "pr_1",
    portfolio_id: "pf_1",
    status: "succeeded",
    metrics: { cagr: 0.1, sharpe: 1.2, sortino: 1.4, max_drawdown: 0.08, vol_annual: 0.2, calmar: 1.1, turnover: 0.1, beta: 0.9 },
    series: {
      portfolio_equity: [{ date: "2025-01-01", value: 100000 }],
      benchmark_equity: [],
      drawdown: [{ date: "2025-01-01", value: 0 }],
      underwater: [],
      exposure: [],
      leverage: [],
      returns: [],
      weights_over_time: [],
      turnover_series: [],
      contribution_series: [],
      rolling_sharpe_30: [],
      rolling_sharpe_90: [],
      rolling_volatility: [],
      monthly_returns: [],
    },
    tables: { top_contributors: [], top_detractors: [], worst_drawdowns: [], rebalance_log: [], latest_weights: [] },
    matrices: { correlation: { labels: [], values: [] }, labels: [], cluster_order: [] },
  })),
}));

vi.mock("recharts", () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Stub,
    LineChart: Stub,
    Line: Stub,
    CartesianGrid: Stub,
    XAxis: Stub,
    YAxis: Stub,
    Tooltip: Stub,
    Legend: Stub,
    AreaChart: Stub,
    Area: Stub,
    BarChart: Stub,
    Bar: Stub,
    Cell: Stub,
  };
});

function wrap(ui: React.ReactElement, route = "/") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={[route]}
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

describe("Portfolio Lab pages", () => {
  it("renders list page", async () => {
    wrap(<PortfolioLabPage />);
    expect(await screen.findByText("Mode: Portfolio Lab")).toBeTruthy();
    expect(await screen.findByText("Core")).toBeTruthy();
  });

  it("renders detail page", async () => {
    wrap(
      <Routes>
        <Route path="/portfolio-lab/portfolios/:id" element={<PortfolioLabDetailPage />} />
      </Routes>,
      "/portfolio-lab/portfolios/pf_1",
    );
    expect(await screen.findByText("Run History")).toBeTruthy();
  });

  it("renders report page", async () => {
    wrap(
      <Routes>
        <Route path="/portfolio-lab/runs/:runId" element={<PortfolioLabRunReportPage />} />
      </Routes>,
      "/portfolio-lab/runs/pr_1",
    );
    expect(await screen.findByText("Portfolio Lab / Report")).toBeTruthy();
  });

  it("renders blends page", async () => {
    wrap(<PortfolioLabBlendsPage />);
    expect(await screen.findByText("Blend Builder")).toBeTruthy();
  });
});
