import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FuturesPanel } from "../components/market/FuturesPanel";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(), history: vi.fn() }));
vi.mock("../api/client", () => ({ fetchFuturesChain: (...args: unknown[]) => mocks.fetch(...args), fetchFuturesUnderlyings: vi.fn(async () => []) }));
vi.mock("../hooks/useDisplayCurrency", () => ({ useDisplayCurrency: () => ({ formatDisplayMoney: (n: number) => n.toFixed(2) }) }));
vi.mock("../hooks/useStocks", () => ({ useStockHistory: (...args: unknown[]) => { mocks.history(...args); return { data: undefined }; } }));
vi.mock("../realtime/useQuotesStream", () => ({ useQuotesStream: () => ({ subscribe: mocks.subscribe, unsubscribe: mocks.unsubscribe, isConnected: false }), useQuotesStore: (selector: (state: unknown) => unknown) => selector({ ticksByToken: {} }) }));
vi.mock("../shared/chart/ChartEngine", () => ({ ChartEngine: () => null }));
describe("NSE futures snapshot integrity", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("discloses snapshot provenance, preserves missing prices, and never subscribes invented broker ids", async () => {
    mocks.fetch.mockResolvedValue({ source: "nse_snapshot", as_of: "2026-11-13T10:10:00+00:00", contracts: [
      { tradingsymbol: "NSE-NEAR", expiry_date: "2026-11-23", ws_symbol: "", instrument_token: null, ltp: 25175, change_pct: -0.5 },
      { tradingsymbol: "NSE-FAR", expiry_date: "2026-12-29", ws_symbol: "", instrument_token: null, ltp: null, change_pct: null },
    ] });
    render(<FuturesPanel underlying="NIFTY" showUnderlyingChart={false} />);
    expect(await screen.findByRole("status")).toHaveTextContent("NSE snapshot");
    expect(screen.getByRole("status")).toHaveTextContent("As of");
    expect(screen.getByText("25175.00")).toBeInTheDocument();
    expect(screen.getByText("NSE-FAR").closest("tr")?.textContent).not.toContain("0.00");
    expect(mocks.subscribe).not.toHaveBeenCalled();
    expect(mocks.history).toHaveBeenCalledWith("", "3mo", "1d");
  });
  it("shows a request failure without fabricated quotes", async () => {
    mocks.fetch.mockRejectedValue(new Error("Provider unavailable"));
    render(<FuturesPanel underlying="NIFTY" showUnderlyingChart={false} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Provider unavailable");
    expect(screen.getByText("No contracts")).toBeInTheDocument();
  });
});
