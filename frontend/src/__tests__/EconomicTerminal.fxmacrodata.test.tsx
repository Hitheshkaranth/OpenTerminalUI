// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { EconomicTerminal } from "../pages/economics/EconomicTerminal";
import { api } from "../api/base";

vi.mock("../api/base", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../api/economic", () => ({
  fetchEconomicCalendar: vi.fn(async () => []),
  fetchMacroIndicators: vi.fn(async () => ({ us: { gdp: {
    value: 125, last_value: null, label: "Fixture GDP index", unit: "index", date: "2026-01-02", history: [],
  } } })),
}));
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => children,
  AreaChart: () => null, Area: () => null,
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><EconomicTerminal /></MemoryRouter></QueryClientProvider>);
}

it("shows unavailable calendar, provider link and real unit metadata", async () => {
  show();
  expect(await screen.findByText("Calendar data unavailable for this window.")).toBeTruthy();
  expect(screen.getByRole("link", { name: "FXMacroData · UTC" }).getAttribute("href"))
    .toContain("utm_source=openterminalui&utm_medium=integration");
  fireEvent.click(screen.getByText("MACRO DASHBOARD"));
  expect(await screen.findByText("Fixture GDP index")).toBeTruthy();
  expect(screen.getByText("125 index")).toBeTruthy();
});

it("runs a discovered operation through the normal terminal explorer tab", async () => {
  vi.mocked(api.get).mockResolvedValue({ data: [{ name: "data_catalogue", description: "Catalogue", input_schema: { type: "object" } }] });
  vi.mocked(api.post).mockResolvedValue({ data: { operation: "data_catalogue", records: [{ name: "Policy rate" }], data: { data: [{ name: "Policy rate" }] }, status: "available" } });
  show();
  fireEvent.click(screen.getByText("DATA EXPLORER"));
  await screen.findByText("Catalogue");
  fireEvent.click(screen.getByRole("button", { name: "Run query" }));
  expect(await screen.findByRole("cell", { name: "Policy rate" })).toBeTruthy();
  expect(api.post).toHaveBeenCalledWith("/economics/query", { operation: "data_catalogue", arguments: { currency: "USD" } });
});

it("rejects malformed parameters before making a query", async () => {
  vi.mocked(api.get).mockResolvedValue({ data: [] });
  show();
  fireEvent.click(screen.getByText("DATA EXPLORER"));
  fireEvent.change(screen.getByLabelText("FXMacroData parameters"), { target: { value: "[1,2]" } });
  fireEvent.click(screen.getByRole("button", { name: "Run query" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(api.post).not.toHaveBeenCalled();
});
