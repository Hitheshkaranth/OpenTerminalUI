import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { DashboardPage } from "../pages/Dashboard";

vi.mock("../hooks/useStocks", () => ({
  useMarketStatus: () => ({ data: { nseStatus: "CLOSED", nyseStatus: "OPEN", nifty50: 22421.95, nifty50Pct: -0.88, source: { nseIndices: false } } }),
  useEarningsCalendar: () => ({ data: [] }),
}));
vi.mock("../api/client", () => ({ api: { get: vi.fn(async () => ({ data: { items: [] } })) } }));
vi.mock("../api/ideasThemes", async (orig) => ({
  ...(await orig<typeof import("../api/ideasThemes")>()),
  fetchThemes: vi.fn(async () => ({ market: "IN", benchmark: "^NSEI", themes: [{ id: "defence", name: "Defence", description: "", market: "IN", constituents: 13, return_1m: 4.2, return_3m: null, return_6m: null, return_1y: 7.2, vs_benchmark_1y: 17.1 }] })),
  fetchIdeasBoard: vi.fn(async () => ({ market: "IN", generated_at: "", categories: [], warnings: [] })),
}));
vi.mock("../api/resultsTracker", () => ({ fetchLatestResults: vi.fn(async () => ({ market: "IN", items: [] })) }));
vi.mock("../components/market/BulkDealsTable", () => ({ BulkDealsTable: () => <div>bulk deals</div> }));
vi.mock("../components/market/EventCalendar", () => ({ EventCalendar: () => <div>events</div> }));

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

function renderDash() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/equity/dashboard"]}>
        <Routes>
          <Route path="/equity/dashboard" element={<DashboardPage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Dashboard hub", () => {
  it("links every research workflow to its real route", () => {
    renderDash();
    // Some workflows are linked twice (launcher + widget); every link must point at the real route.
    const href = (name: RegExp) => {
      const targets = new Set(screen.getAllByRole("link", { name }).map((a) => a.getAttribute("href")));
      expect(targets.size).toBe(1);
      return [...targets][0];
    };
    expect(href(/Ideas board/)).toBe("/equity/hotlists?view=ideas");
    expect(href(/Thematic indices/)).toBe("/equity/sector-rotation?view=themes");
    expect(href(/Results tracker/)).toBe("/equity/earnings?view=results");
    expect(href(/Filings watch/)).toBe("/equity/alerts");
    expect(href(/Commodity links/)).toBe("/equity/commodities");
    expect(screen.getByText("NIFTY 50")).toBeTruthy();
  });

  it("company tools are disabled until a ticker is entered, then open the right hub tab", () => {
    renderDash();
    const filings = screen.getByRole("button", { name: /Filings: growth & headwinds/ });
    expect((filings as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Ticker to analyse"), { target: { value: "lly" } });
    fireEvent.click(screen.getByRole("button", { name: /Filings: growth & headwinds/ }));
    expect(screen.getByTestId("where").textContent).toBe("/equity/security/LLY?tab=filings");
  });
});
