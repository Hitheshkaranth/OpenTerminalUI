import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ResearchExperiments, experimentError } from "../components/research/ResearchExperiments";
import { api } from "../api/base";

vi.mock("../api/base", () => ({ api: { get: vi.fn(), post: vi.fn() }, extractApiErrorMessage: (e: Error) => e.message }));
const bars = Array.from({ length: 10 }, (_, i) => ({ date: `2025-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`, available_at: `2025-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`, open: 100, high: 110, low: 90, close: 105, volume: 1000 }));
const snapshot = {
  id: "e1", sha256: "snapshot-hash", data_sha256: "data-hash", created_at: "2025-02-01T00:00:00Z",
  request: { title: "Frozen crossover", symbol: "TCS", provider: "Exchange archive", data_version: "snapshot-2025", adjustment_policy: "split_adjusted", as_of: "2025-01-10T23:59:59Z", train_end: "2025-01-06T23:59:59Z", validation_start: "2025-01-07T00:00:00Z", short_window: 2, long_window: 3, fee_bps: 5, slippage_bps: 7, bars },
  results: { training: { total_return: 0.125, max_drawdown: -0.035, trades: [{}, {}], bars: 6 }, validation: { total_return: 0, max_drawdown: 0, trades: [], bars: 4 } },
  limitations: ["Caller supplies provenance."]
};
const summary = { id: snapshot.id, title: snapshot.request.title, symbol: "TCS", created_at: snapshot.created_at, sha256: snapshot.sha256 };
function mount() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ResearchExperiments dossierId="d1" symbol="TCS" /></QueryClientProvider>);
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.get).mockImplementation(async (url) => ({ data: url === "/research/experiments" ? { items: [summary] } : snapshot }));
});

describe("saved experiment comparison", () => {
  it("loads the selected snapshot and displays measured periods and provenance", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "View results for Frozen crossover" }));
    const table = await screen.findByRole("table", { name: "Saved training and validation results" });
    const training = within(table).getByRole("row", { name: /Training/ });
    expect(training).toHaveTextContent("12.50%"); expect(training).toHaveTextContent("-3.50%");
    const validation = within(table).getByRole("row", { name: /Validation/ });
    expect(within(validation).getAllByText("0.00%")).toHaveLength(2);
    expect(within(validation).getByText("0", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Exchange archive")).toBeInTheDocument(); expect(screen.getByText("snapshot-2025")).toBeInTheDocument();
    expect(screen.getByText("5 bps fees + 7 bps slippage")).toBeInTheDocument();
    expect(screen.getByText("2025-01-07 00:00:00 UTC")).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith("/research/experiments/e1");
  });
  it("does not invent missing results or count missing trades as zero", async () => {
    vi.mocked(api.get).mockImplementation(async (url) => ({ data: url === "/research/experiments" ? { items: [summary] } : { ...snapshot, results: { training: snapshot.results.training } } }));
    mount(); fireEvent.click(await screen.findByRole("button", { name: /View results/ }));
    const table = await screen.findByRole("table");
    const validation = within(table).getByRole("row", { name: /Validation/ });
    expect(within(validation).getAllByText("Not recorded")).toHaveLength(4);
  });
  it("loads saved results on replay and exposes differing recomputed results", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { id: "e1", matches: false, provider_requests: 0, results: { ...snapshot.results, validation: { total_return: -0.01, max_drawdown: -0.02, trades: [{}], bars: 4 } } } });
    mount(); fireEvent.click(await screen.findByRole("button", { name: "Replay experiment" }));
    expect(await screen.findByRole("table", { name: "Saved training and validation results" })).toBeInTheDocument();
    const replay = await screen.findByRole("table", { name: "Recomputed replay results" });
    expect(within(replay).getByText("-1.00%")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Replay differs");
    expect(screen.getByRole("status")).toHaveTextContent("Provider requests: 0");
  });
  it("announces snapshot loading and a successful replay without duplicating the table", async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise((r) => { resolve = r; });
    vi.mocked(api.get).mockImplementation(async (url) => url === "/research/experiments" ? { data: { items: [summary] } } : await pending as any);
    vi.mocked(api.post).mockResolvedValue({ data: { id: "e1", matches: true, provider_requests: 0, results: snapshot.results } });
    mount(); fireEvent.click(await screen.findByRole("button", { name: /View results/ }));
    expect(screen.getByRole("status")).toHaveTextContent("Loading saved results");
    resolve({ data: snapshot });
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Replay experiment" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Replay matched"));
    expect(screen.getAllByRole("table")).toHaveLength(1);
  });
  it("offers retry after a snapshot request fails", async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === "/research/experiments") return { data: { items: [summary] } };
      throw new Error("offline");
    });
    mount(); fireEvent.click(await screen.findByRole("button", { name: /View results/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load");
    vi.mocked(api.get).mockResolvedValue({ data: snapshot });
    fireEvent.click(screen.getByRole("button", { name: "Retry results" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });
  it("shows the full result returned by experiment creation without another detail request", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: snapshot });
    mount();
    const csv = "date,available_at,open,high,low,close,volume\n" + bars.map((bar) => Object.values(bar).join(",")).join("\n");
    const file = new File([csv], "prices.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => csv });
    fireEvent.change(screen.getByLabelText("Price bars CSV"), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Freeze and test 10 bars", hidden: true })).toBeEnabled());
    for (const [label, value] of [["Data source", "Exchange archive"], ["Source version or snapshot ID", "snapshot-2025"], ["Data known by (UTC)", "2025-01-10"], ["Training ends (UTC)", "2025-01-06"], ["Validation starts (UTC)", "2025-01-07"]]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.submit(screen.getByLabelText("Price bars CSV").closest("form")!);
    expect(await screen.findByRole("table", { name: "Saved training and validation results" })).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith("/research/experiments", expect.objectContaining({ dossier_id: "d1", bars: expect.any(Array) }));
    expect(vi.mocked(api.get).mock.calls.filter(([url]) => url === "/research/experiments/e1")).toHaveLength(0);
  });
});


it("summarizes repeated row validation failures without displaying the input payload", () => {
  const error = { response: { data: { detail: Array.from({ length: 251 }, (_, index) => ({ loc: ["body", "bars", index], msg: "Value error, Bar was not available at its decision timestamp", input: { confidential: "raw payload" } })) } } };
  const message = experimentError(error);
  expect(message).toContain("251 price-bar rows need attention");
  expect(message).toContain("Verify both timestamps with your source");
  expect(message).not.toContain("raw payload");
  expect(message.length).toBeLessThan(500);
  expect(message.match(/Bar was not available/g)).toHaveLength(1);
});
