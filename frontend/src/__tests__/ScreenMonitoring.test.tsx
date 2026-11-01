import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ScreenMonitoring } from "../components/screener/ScreenMonitoring";
import * as monitor from "../api/screenMonitoring";
import { createDossier } from "../api/researchDossiers";
vi.mock("../api/screenMonitoring", () => ({ listScreenSchedules: vi.fn(), patchScreenSchedule: vi.fn(), previewScreenSchedule: vi.fn(), runScreenSchedule: vi.fn(), saveScreenSchedule: vi.fn() }));
vi.mock("../api/researchDossiers", () => ({ createDossier: vi.fn(), emptyDossier: () => ({ evidence: [] }) }));
const coverage = { requested: 4, evaluated: 1, missing: ["GOOG"], stale: ["META"], unknown: ["NVDA"] };
const saved = { id: "s1", screen_id: "saved1", name: "Quality", query: "ROE > 20", universe: "sp_500", market: "US" as const, frequency: "daily" as const, enabled: true, max_age_hours: 168, next_run_at: "2026-11-02T00:00:00Z", last_run_at: "2026-11-01T00:00:00Z", matches: [{ symbol: "AAPL", values: { roe: 21 }, observed_at: "2026-11-01T00:00:00Z", source: "Cached provider snapshot" }], changes: [{ id: "c1", symbol: "AAPL", kind: "entered" as const, observed_at: "2026-11-01T00:00:00Z", before: { roe: 19 }, after: { roe: 21 }, rules: ["roe > 20"], source: "Cached provider snapshot", data_observed_at: "2026-11-01T00:00:00Z" }], coverage, error: null, baseline: false };
const mount = () => render(<MemoryRouter><ScreenMonitoring screen={{ id: "saved1", name: "Quality", query: "ROE > 20" }} universe="sp_500" /></MemoryRouter>);
beforeEach(() => { vi.clearAllMocks(); vi.mocked(monitor.listScreenSchedules).mockResolvedValue([saved]); });
describe("saved screen monitoring", () => {
  it("shows truthful coverage and before/after evidence without leaving the screen", async () => {
    mount();
    expect(await screen.findByText(/Checked 1 of 4 companies/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Changes" }));
    expect(screen.getByText("entered this screen")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Measurements for AAPL" })).toHaveTextContent("19");
    expect(screen.getByRole("table", { name: "Measurements for AAPL" })).toHaveTextContent("21");
  });
  it("requires preview before enabling and invalidates preview when frequency changes", async () => {
    vi.mocked(monitor.listScreenSchedules).mockResolvedValue([]);
    vi.mocked(monitor.previewScreenSchedule).mockResolvedValue({ name: "Quality", universe: "sp_500", frequency: "daily", coverage, matches: saved.matches, rules: [], policy: "", data_policy: "Cached observations", delivery: "In-app research inbox", next_run_at: saved.next_run_at });
    vi.mocked(monitor.saveScreenSchedule).mockResolvedValue(saved);
    mount(); fireEvent.click(await screen.findByRole("button", { name: "Preview a schedule" }));
    expect(screen.queryByRole("button", { name: "Enable daily checks" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preview coverage" }));
    expect(await screen.findByRole("button", { name: "Enable daily checks" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Check frequency"), { target: { value: "weekly" } });
    expect(screen.queryByRole("button", { name: /Enable .* checks/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preview coverage" }));
    fireEvent.click(await screen.findByRole("button", { name: "Enable weekly checks" }));
    await waitFor(() => expect(monitor.saveScreenSchedule).toHaveBeenCalledWith(expect.objectContaining({ frequency: "weekly", market: "US", screen_id: "saved1" })));
  });
  it("reports failures without losing the matches", async () => {
    vi.mocked(createDossier).mockRejectedValue(new Error("Network unavailable"));
    mount(); fireEvent.click(await screen.findByRole("button", { name: "Create dossier" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Network unavailable");
    expect(screen.getByRole("table", { name: "Monitored screen matches" })).toHaveTextContent("AAPL");
  });
  it("distinguishes no evaluated companies from no matching companies", async () => {
    vi.mocked(monitor.listScreenSchedules).mockResolvedValue([{ ...saved, matches: [], coverage: { ...coverage, evaluated: 0 } }]);
    mount(); expect(await screen.findByText(/No companies could be evaluated/)).toBeInTheDocument();
  });
});

it("restores the saved schedule universe when opened from an inbox deep link", async () => {
  const restore = vi.fn();
  render(<MemoryRouter><ScreenMonitoring screen={{ id: "saved1", name: "Quality", query: "ROE > 20" }} universe="nse_500" onRestoreUniverse={restore} /></MemoryRouter>);
  await waitFor(() => expect(restore).toHaveBeenCalledWith("sp_500"));
});
