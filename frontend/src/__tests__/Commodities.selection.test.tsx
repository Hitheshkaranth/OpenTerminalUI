import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommoditiesPage } from "../pages/Commodities";

vi.mock("../components/security/PriceOverviewChart", () => ({ PriceOverviewChart: ({ symbol }: { symbol: string }) => <div data-testid="selected-price-symbol">{symbol}</div> }));
vi.mock("../components/commodities/LinkedCompanies", () => ({ LinkedCompanies: () => null }));
const quote = (symbol: string, name: string, price: number) => ({ symbol, name, price, volume: 100, change: 1, change_pct: 1, sparkline: [] });
const Location = () => <output data-testid="commodity-url">{useLocation().search}</output>;
function renderPage(symbol: string) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("/commodities/quotes") ? { categories: [
    { id: "energy", items: [quote("CL=F", "Crude Oil", 80)] }, { id: "metals", items: [quote("GC=F", "Gold", 2000)] },
  ] } : url.includes("futures-chain") ? { contracts: [{ contract: "Front", price: url.includes("GC") ? 2000 : 80 }] } : { years: 7, monthly: [{ month: "Jan", average_return_pct: 1 }] }), { status: 200 })));
  render(<MemoryRouter initialEntries={[`/equity/commodities?symbol=${encodeURIComponent(symbol)}`]}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CommoditiesPage /><Location /></QueryClientProvider></MemoryRouter>);
}
afterEach(() => vi.unstubAllGlobals());
describe("commodity identity and category routing", () => {
  it("keeps an incoming Gold symbol selected instead of resetting it to energy", async () => {
    renderPage("GC=F");
    await screen.findByText("Gold Snapshot");
    await waitFor(() => expect(screen.getByTestId("selected-price-symbol")).toHaveTextContent("GC=F"));
    expect(screen.getByTestId("commodity-url")).toHaveTextContent("GC%3DF");
    expect(screen.getByText("Provider response")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Energy", exact: true }));
    await waitFor(() => expect(screen.getByTestId("selected-price-symbol")).toHaveTextContent("CL=F"));
    expect(screen.getByTestId("commodity-url")).toHaveTextContent("CL%3DF");
  });
  it("reports an unsupported requested symbol instead of silently rewriting it", async () => {
    renderPage("UNSUPPORTED");
    expect(await screen.findByRole("alert")).toHaveTextContent("UNSUPPORTED is not available");
    expect(screen.getByTestId("commodity-url")).toHaveTextContent("UNSUPPORTED");
  });
});
