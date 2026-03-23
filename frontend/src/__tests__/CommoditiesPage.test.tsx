/** @vitest-environment jsdom */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommoditiesPage } from "../pages/Commodities";

vi.mock("recharts", () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Stub,
    AreaChart: Stub,
    Area: Stub,
    CartesianGrid: Stub,
    LineChart: Stub,
    Line: Stub,
    Tooltip: Stub,
    XAxis: Stub,
    YAxis: Stub,
  };
});

const fetchMock = vi.fn();

function jsonResponse(payload: unknown) {
  return {
    ok: true,
    statusText: "OK",
    text: async () => JSON.stringify(payload),
  };
}

describe("CommoditiesPage", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders grouped quotes and detail charts from the backend payloads", async () => {
    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/commodities/quotes")) {
        return jsonResponse({
          categories: [
            {
              id: "energy",
              label: "Energy",
              items: [
                { symbol: "CL=F", name: "WTI Crude Oil", category: "energy", price: 78.4, change: 0.5, change_pct: 0.64, volume: 120000, sparkline: [77.9, 78.1, 78.3] },
              ],
            },
            {
              id: "metals",
              label: "Metals",
              items: [
                { symbol: "GC=F", name: "Gold", category: "metals", price: 2165, change: -3.0, change_pct: -0.14, volume: 95000, sparkline: [2168, 2167.5, 2165] },
              ],
            },
            {
              id: "agriculture",
              label: "Agriculture",
              items: [
                { symbol: "ZC=F", name: "Corn", category: "agriculture", price: 452, change: 1.25, change_pct: 0.28, volume: 83000, sparkline: [450.75, 451, 452] },
              ],
            },
          ],
        });
      }
      if (url.includes("/api/commodities/futures-chain/GC%3DF")) {
        return jsonResponse({
          symbol: "GC=F",
          name: "Gold",
          points: [
            { contract: "GC=F-01M", expiry: "2026-04-30", price: 2168.4, change_pct: 0.2 },
            { contract: "GC=F-02M", expiry: "2026-05-31", price: 2172.1, change_pct: 0.28 },
          ],
        });
      }
      if (url.includes("/api/commodities/seasonal/GC%3DF")) {
        return jsonResponse({
          symbol: "GC=F",
          years: 8,
          monthly: [
            { month: 1, average_return_pct: 1.2, average_price: 2110 },
            { month: 2, average_return_pct: -0.4, average_price: 2101 },
          ],
        });
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(
      <MemoryRouter initialEntries={["/equity/commodities?symbol=GC%3DF"]}>
        <Routes>
          <Route path="/equity/commodities" element={<CommoditiesPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Commodities Terminal")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Energy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Metals" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agriculture" })).toBeInTheDocument();

    expect(await screen.findByText("Gold")).toBeInTheDocument();
    expect(screen.getByText("Term Structure")).toBeInTheDocument();
    expect(screen.getByText("Seasonality")).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/commodities/quotes");
      expect(fetchMock).toHaveBeenCalledWith("/api/commodities/futures-chain/GC%3DF");
      expect(fetchMock).toHaveBeenCalledWith("/api/commodities/seasonal/GC%3DF");
    });
  });
});
