/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ForexPage } from "../pages/Forex";

vi.mock("recharts", () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Stub,
    AreaChart: Stub,
    Area: Stub,
    CartesianGrid: Stub,
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

describe("ForexPage", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the cross-rates workflow, pair detail, heatmap, and central bank monitor", async () => {
    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/forex/cross-rates")) {
        return jsonResponse({
          currencies: ["USD", "EUR", "GBP", "JPY", "CHF", "AUD", "CAD", "INR"],
          matrix: [
            [1, 0.9231, 0.7852, 151.32, 0.8844, 1.5281, 1.3574, 83.14],
            [1.0833, 1, 0.8505, 163.93, 0.9581, 1.6553, 1.4715, 90.06],
            [1.2736, 1.1758, 1, 192.76, 1.1263, 1.9460, 1.7307, 105.9],
            [0.0066, 0.0061, 0.0052, 1, 0.0058, 0.0101, 0.009, 0.5495],
            [1.1307, 1.0437, 0.8879, 171.08, 1, 1.7278, 1.5348, 93.99],
            [0.6544, 0.6041, 0.5139, 98.97, 0.5788, 1, 0.8886, 54.41],
            [0.7367, 0.6796, 0.5778, 111.3, 0.6516, 1.1254, 1, 61.24],
            [0.012, 0.0111, 0.0094, 1.82, 0.0106, 0.0184, 0.0163, 1],
          ],
        });
      }
      if (url.endsWith("/api/forex/central-banks")) {
        return jsonResponse({
          banks: [
            {
              currency: "USD",
              bank: "Federal Reserve",
              policy_rate: 5.5,
              last_decision_date: "2026-01-28",
              next_decision_date: "2026-05-06",
              last_action: "held",
              last_change_bps: 0,
              days_since_last_decision: 51,
              days_until_next_decision: 47,
              decision_cycle: "scheduled",
            },
          ],
        });
      }
      if (url.includes("/api/forex/pairs/EURUSD")) {
        return jsonResponse({
          pair: "EURUSD",
          current_rate: 1.085,
          candles: [
            { t: 1, o: 1.08, h: 1.09, l: 1.07, c: 1.085, v: 1000 },
            { t: 2, o: 1.085, h: 1.095, l: 1.08, c: 1.091, v: 1100 },
          ],
        });
      }
      if (url.includes("/api/forex/pairs/GBPUSD")) {
        return jsonResponse({
          pair: "GBPUSD",
          current_rate: 1.274,
          candles: [
            { t: 3, o: 1.27, h: 1.28, l: 1.269, c: 1.274, v: 1200 },
          ],
        });
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(
      <MemoryRouter initialEntries={["/equity/forex?pair=EURUSD"]}>
        <Routes>
          <Route path="/equity/forex" element={<ForexPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Forex Terminal")).toBeInTheDocument();
    expect(await screen.findByText("Federal Reserve")).toBeInTheDocument();
    expect(screen.getByText("Majors Heatmap")).toBeInTheDocument();
    expect(screen.getByText("EUR/USD Detail")).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "1.2736" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/forex/cross-rates");
      expect(fetchMock).toHaveBeenCalledWith("/api/forex/central-banks");
      expect(fetchMock).toHaveBeenCalledWith("/api/forex/pairs/EURUSD");
      expect(fetchMock).toHaveBeenCalledWith("/api/forex/pairs/GBPUSD");
    });
  });
});
