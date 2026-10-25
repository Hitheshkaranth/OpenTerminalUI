import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { CompanyIdentity, companyAssetUrl } from "../components/research/CompanyIdentity";
import { api } from "../api/base";

vi.mock("../api/base", () => ({ api: { get: vi.fn() } }));
beforeEach(() => { vi.clearAllMocks(); vi.mocked(api.get).mockResolvedValue({ data: {} }); });
function view(symbol: string, market: string, compact = false) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><CompanyIdentity symbol={symbol} market={market} compact={compact} /></MemoryRouter></QueryClientProvider>);
}
it("shows the official local Apple identity and correct company link", async () => {
  view("AAPL", "US");
  expect(screen.getByRole("img", { name: "Apple Inc. logo" })).toHaveAttribute("src", "/company-logos/apple.ico");
  expect(screen.getByRole("link", { name: /Company overview/ })).toHaveAttribute("href", "/equity/security/AAPL");
  expect(screen.getByText("NASDAQ")).toBeInTheDocument();
  await waitFor(() => expect(api.get).toHaveBeenCalledWith("/stocks/AAPL", expect.objectContaining({ params: { market: "US" } })));
});
it("uses provider identity and falls back if the logo fails", async () => {
  vi.mocked(api.get).mockResolvedValue({ data: { company_name: "Example Industries", exchange: "NSE", sector: "Industrials", logo_url: "https://example.com/mark.png" } });
  view("EXAMPLE", "IN");
  const logo = await screen.findByRole("img", { name: "Example Industries logo" });
  expect(screen.getByText("Industrials")).toBeInTheDocument();
  fireEvent.error(logo);
  expect(screen.getByLabelText("EXAMPLE company initials")).toHaveTextContent("EXA");
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});
it("does not assign Apple's identity to a different market or fetch every compact row", () => {
  view("AAPL", "IN", true);
  expect(screen.queryByText("Apple Inc.")).not.toBeInTheDocument();
  expect(screen.getByLabelText("AAPL company initials")).toBeInTheDocument();
  expect(api.get).not.toHaveBeenCalled();
});
it("rejects unsafe logos and synthetic company metadata", async () => {
  for (const url of ["javascript:alert(1)", "data:image/svg+xml,test", "https://user:secret@example.com/logo", "/company-logos/../private"]) expect(companyAssetUrl(url)).toBeUndefined();
  vi.mocked(api.get).mockResolvedValue({ data: { company_name: "Invented Company", logo_url: "https://example.com/logo", provenance: { quality: "synthetic" } } });
  view("UNKNOWN", "US");
  await waitFor(() => expect(api.get).toHaveBeenCalled());
  expect(screen.queryByText("Invented Company")).not.toBeInTheDocument();
  expect(screen.getByLabelText("UNKNOWN company initials")).toBeInTheDocument();
});
