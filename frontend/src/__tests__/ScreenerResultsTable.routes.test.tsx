import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ResultsTable } from "../pages/equity/screener/ResultsTable";

const navigateMock = vi.fn();
const setTickerMock = vi.fn();
const setSelectedRowMock = vi.fn();
const useScreenerContextMock = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("../store/stockStore", () => ({
  useStockStore: (selector: (state: { setTicker: (ticker: string) => void }) => unknown) => selector({ setTicker: setTickerMock }),
}));

vi.mock("../pages/equity/screener/ScreenerContext", () => ({
  useScreenerContext: () => useScreenerContextMock(),
}));

describe("Screener results routing", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    setTickerMock.mockReset();
    setSelectedRowMock.mockReset();
    useScreenerContextMock.mockReturnValue({
      result: {
        total_results: 1,
        query_parsed: "ROE > 20",
        execution_time_ms: 18,
        results: [
          {
            ticker: "AAPL",
            company: "Apple Inc.",
            sector: "Technology",
            market_cap: 1000000000,
            pe: 24,
            roe_pct: 21,
            returns_3m: 12,
          },
        ],
        viz_data: {},
      },
      selectedRow: null,
      setSelectedRow: setSelectedRowMock,
    });
  });

  it("routes a selected result into chart, research, and news flows", () => {
    render(
      <MemoryRouter>
        <ResultsTable />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Chart" }));
    expect(setTickerMock).toHaveBeenCalledWith("AAPL");
    expect(navigateMock).toHaveBeenCalledWith("/equity/chart-workstation");

    fireEvent.click(screen.getByRole("button", { name: "Research" }));
    expect(setTickerMock).toHaveBeenCalledWith("AAPL");
    expect(navigateMock).toHaveBeenCalledWith("/equity/security/AAPL?tab=overview");

    fireEvent.click(screen.getByRole("button", { name: "News" }));
    expect(setTickerMock).toHaveBeenCalledWith("AAPL");
    expect(navigateMock).toHaveBeenCalledWith("/equity/security/AAPL?tab=news");
  });
});
