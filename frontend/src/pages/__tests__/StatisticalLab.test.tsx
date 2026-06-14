/** @vitest-environment jsdom */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";

import { StatisticalLab } from "../StatisticalLab";

vi.mock("../../api/statlab", () => ({
  fetchStatlabMethods: vi.fn(async () => ({
    forecast_methods: [{ id: "arima", label: "ARIMA" }],
  })),
  postForecast: vi.fn(),
  postCointegration: vi.fn(),
  postStationarity: vi.fn(),
  postDecomposition: vi.fn(),
  postRegression: vi.fn(),
  postAutocorrelation: vi.fn(),
  postCausality: vi.fn(),
  postRegimes: vi.fn(),
}));

vi.mock("recharts", () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Stub,
    LineChart: Stub,
    Line: Stub,
    AreaChart: Stub,
    Area: Stub,
    XAxis: Stub,
    YAxis: Stub,
    CartesianGrid: Stub,
    Tooltip: Stub,
    Legend: Stub,
    ReferenceLine: Stub,
    BarChart: Stub,
    Bar: Stub,
    ScatterChart: Stub,
    Scatter: Stub,
    ZAxis: Stub,
    Cell: Stub,
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

describe("StatisticalLab", () => {
  it("renders the statistical lab page with title", async () => {
    renderWithProviders(<StatisticalLab />);
    expect(await screen.findByText("Statistical Lab")).toBeTruthy();
    expect(await screen.findByText("Forecasting Configuration")).toBeTruthy();
  });
});
