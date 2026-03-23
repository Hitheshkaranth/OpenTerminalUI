/** @vitest-environment jsdom */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ETFAnalyticsPage } from "../pages/ETFAnalytics";

const fetchMock = vi.fn();

function jsonResponse(payload: unknown) {
  return {
    ok: true,
    statusText: "OK",
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

describe("ETFAnalyticsPage", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders ETF Analytics page with components", async () => {
    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/api/etf/holdings")) {
        return jsonResponse({
          ticker: "SPY",
          holdings: [
            { symbol: "AAPL", name: "Apple Inc.", weight: 7.1 },
            { symbol: "MSFT", name: "Microsoft Corp.", weight: 6.5 },
          ],
        });
      }
      if (url.includes("/api/etf/flows")) {
        return jsonResponse({
          ticker: "SPY",
          flows: [
            { date: "2024-03-01", net_flow: 150.5 },
            { date: "2024-03-02", net_flow: -20.2 },
          ],
        });
      }
      if (url.includes("/api/etf/overlap")) {
        return jsonResponse({
          tickers: ["SPY", "VOO"],
          overlap_pct: 95.2,
          common_holdings: [
            { symbol: "AAPL", name: "Apple Inc.", weight: 7.0 },
          ],
        });
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(
      <MemoryRouter initialEntries={["/equity/etf-analytics?ticker=SPY"]}>
        <Routes>
          <Route path="/equity/etf-analytics" element={<ETFAnalyticsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("ETF Analytics & Intelligence")).toBeInTheDocument();

    // Check for panel titles
    expect(screen.getByText("Holdings Analysis: SPY")).toBeInTheDocument();
    expect(screen.getByText("Fund Flows: SPY")).toBeInTheDocument();
    expect(screen.getByText("Overlap Analysis")).toBeInTheDocument();

    // Check for data rendered by components
    await waitFor(() => {
      expect(screen.getAllByText("AAPL").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Apple Inc.").length).toBeGreaterThan(0);
      expect(screen.getByText("+95.20% Overlap")).toBeInTheDocument();
    });
  });
});
