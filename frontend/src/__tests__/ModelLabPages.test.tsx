import React from "react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen } from "@testing-library/react";

import { ModelLabPage } from "../pages/ModelLab";
import { ModelLabExperimentDetailPage } from "../pages/ModelLabExperimentDetail";
import { ModelLabRunReportPage } from "../pages/ModelLabRunReport";
import { ModelLabComparePage } from "../pages/ModelLabCompare";

vi.mock("../api/modelLab", () => ({
  createModelExperiment: vi.fn(async () => ({ id: "exp_1" })),
  listModelExperiments: vi.fn(async () => ([
    {
      id: "exp_1",
      name: "Alpha",
      description: "Desc",
      tags: ["daily"],
      model_key: "sma_crossover",
      benchmark_symbol: "NIFTY50",
      start_date: "2025-01-01",
      end_date: "2025-12-31",
      created_at: "2026-02-19",
    },
  ])),
  getModelExperiment: vi.fn(async () => ({
    id: "exp_1",
    name: "Alpha",
    description: "Desc",
    tags: ["daily"],
    model_key: "sma_crossover",
    benchmark_symbol: "NIFTY50",
    start_date: "2025-01-01",
    end_date: "2025-12-31",
    created_at: "2026-02-19",
    params_json: {},
    universe_json: {},
    cost_model_json: {},
    runs: [{ id: "run_1", status: "succeeded", started_at: "2026-02-19", finished_at: "2026-02-19", error: null }],
  })),
  runModelExperiment: vi.fn(async () => ({ run_id: "run_2", status: "queued" })),
  runModelWalkForward: vi.fn(async () => ({ validation: {} })),
  runModelParamSweep: vi.fn(async () => ({ results: [] })),
  getModelRunReport: vi.fn(async () => ({
    run_id: "run_1",
    status: "succeeded",
    experiment_id: "exp_1",
    metrics: { cagr: 0.1, sharpe: 1.2, sortino: 1.4, max_drawdown: 0.08, vol_annual: 0.2, calmar: 1.1, win_rate: 0.55, turnover: 0.1, total_return: 0.12 },
    series: {
      equity_curve: [{ date: "2025-01-01", value: 100000 }, { date: "2025-01-02", value: 101000 }],
      benchmark_curve: [],
      drawdown: [{ date: "2025-01-01", value: 0 }, { date: "2025-01-02", value: -0.01 }],
      underwater: [],
      rolling_sharpe_30: [1.0],
      rolling_sharpe_90: [1.1],
      monthly_returns: [{ year: 2025, month: 1, return_pct: 2 }],
      returns_histogram: { bins: [0.1], counts: [1] },
      trades: [{ date: "2025-01-02", action: "BUY", quantity: 10, price: 100 }],
    },
  })),
  compareModelRuns: vi.fn(async () => ({
    runs: [{ run_id: "run_1", series: { equity_curve: [{ date: "2025-01-01", value: 100000 }], drawdown: [{ date: "2025-01-01", value: -0.01 }] } }],
    summary: [{ run_id: "run_1", status: "succeeded", total_return: 0.12, sharpe: 1.2, sortino: 1.4, max_drawdown: 0.08, calmar: 1.1, vol_annual: 0.2, turnover: 0.1, pareto: true }],
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
    ScatterChart: Stub,
    Scatter: Stub,
    ZAxis: Stub,
  };
});

function renderWithProviders(ui: React.ReactElement, route = "/") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Model Lab pages", () => {
  it("renders list page", async () => {
    renderWithProviders(<ModelLabPage />);
    expect(await screen.findByText("Model Lab")).toBeTruthy();
    expect(await screen.findByText("Alpha")).toBeTruthy();
  });

  it("renders experiment detail", async () => {
    renderWithProviders(
      <Routes>
        <Route path="/model-lab/experiments/:id" element={<ModelLabExperimentDetailPage />} />
      </Routes>,
      "/model-lab/experiments/exp_1",
    );
    expect(await screen.findByText("Runs")).toBeTruthy();
    expect(await screen.findByText("Alpha")).toBeTruthy();
  });

  it("renders run report", async () => {
    renderWithProviders(
      <Routes>
        <Route path="/model-lab/runs/:runId" element={<ModelLabRunReportPage />} />
      </Routes>,
      "/model-lab/runs/run_1",
    );
    expect(await screen.findByText("Model Lab / Report")).toBeTruthy();
    expect(await screen.findByText("Worst Drawdowns")).toBeTruthy();
  });

  it("renders compare page", async () => {
    renderWithProviders(<ModelLabComparePage />);
    expect(await screen.findByText("Model Lab / Compare")).toBeTruthy();
  });
});
