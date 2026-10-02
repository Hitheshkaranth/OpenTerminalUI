import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { LinkedCompanies } from "../components/commodities/LinkedCompanies";

vi.mock("../api/rawMaterials", () => ({
  fetchCommodityCompanies: vi.fn(async () => ({
    commodity_symbol: "CL=F",
    name: "WTI Crude Oil",
    impact_note: "Rising crude lifts upstream producers.",
    companies: [
      { symbol: "ASIANPAINT", name: "Asian Paints", industry: "Paints", relation: "input_cost", sensitivity: "medium", market: "IN", source: "curated" },
      { symbol: "DAL", name: "Delta Air Lines", industry: "Airlines", relation: "input_cost", sensitivity: "high", market: "US", source: "curated" },
      { symbol: "ONGC", name: "Oil & Natural Gas Corp", industry: "Upstream", relation: "output_price", sensitivity: "high", market: "IN", source: "curated" },
    ],
  })),
}));

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LinkedCompanies commoditySymbol="CL=F" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("LinkedCompanies", () => {
  it("groups companies hurt vs helped by a price rise and links to the hub", async () => {
    renderPanel();
    const hurt = (await screen.findByText(/Hurt by a price rise/i)).parentElement as HTMLElement;
    const helped = screen.getByText(/Helped by a price rise/i).parentElement as HTMLElement;
    expect(hurt.textContent).toContain("ASIANPAINT");
    expect(hurt.textContent).not.toContain("ONGC");
    expect(helped.textContent).toContain("ONGC");
    expect(screen.getByRole("link", { name: /ONGC/ }).getAttribute("href")).toBe("/equity/security/ONGC");
  });

  it("filters by market", async () => {
    renderPanel();
    await screen.findByText("DAL");
    fireEvent.click(screen.getByRole("button", { name: "IN" }));
    expect(screen.queryByText("DAL")).toBeNull();
    expect(screen.getByText("ASIANPAINT")).toBeTruthy();
  });
});
