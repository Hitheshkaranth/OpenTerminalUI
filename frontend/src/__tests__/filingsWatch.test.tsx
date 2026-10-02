import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FilingsWatchPanel } from "../components/filingswatch/FilingsWatchPanel";
import type { FilingsWatchEvent, FilingsWatchSettings } from "../api/filingsWatch";

const mocks = vi.hoisted(() => ({
  fetchFilingsWatchSettings: vi.fn(),
  saveFilingsWatchSettings: vi.fn(),
  runFilingsWatchNow: vi.fn(),
  fetchFilingsWatchEvents: vi.fn(),
}));

vi.mock("../api/filingsWatch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/filingsWatch")>();
  return { ...actual, ...mocks };
});

const SETTINGS: FilingsWatchSettings = {
  enabled: true,
  symbols_source: "watchlists",
  custom_symbols: [],
  run_hour_utc: 13,
  notify_on: [],
  sources: ["sec", "nse"],
  import_limit: 5,
};

const EVENTS: FilingsWatchEvent[] = [
  {
    at: "2026-10-01T09:30:00Z",
    symbol: "TATA",
    kind: "adverse_regulatory",
    title: "TATA: adverse regulatory action",
    detail: "Form 483 observations noted",
    action_url: "/equity/security/TATA?tab=filings",
  },
  {
    at: "2026-10-02T08:00:00Z",
    symbol: "TATA",
    kind: "new_document",
    title: "10-K filed",
    detail: null,
    action_url: "/equity/security/TATA?tab=filings",
  },
  {
    at: "2026-10-02T11:15:00Z",
    symbol: "INFOSYS",
    kind: "stance_change",
    title: "INFOSYS: stance changed",
    detail: "constructive",
    action_url: "/equity/security/INFOSYS?tab=filings",
  },
];

function makeSettings(patch: Partial<FilingsWatchSettings> = {}): FilingsWatchSettings {
  return { ...SETTINGS, ...patch };
}

describe("FilingsWatchPanel", () => {
  beforeEach(() => {
    mocks.fetchFilingsWatchSettings.mockResolvedValue(makeSettings());
    mocks.fetchFilingsWatchEvents.mockResolvedValue(EVENTS);
    mocks.saveFilingsWatchSettings.mockResolvedValue(makeSettings());
    mocks.runFilingsWatchNow.mockResolvedValue({ started: true });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders recent events grouped by symbol with kind badges and links", async () => {
    render(<FilingsWatchPanel />);

    await screen.findByText("TATA");
    await screen.findByText("INFOSYS");

    const labels = screen.getAllByText(/New filing|Adverse regulatory|Stance change/);
    expect(labels.length).toBeGreaterThanOrEqual(3);

    const links = await screen.findAllByRole("link");
    const hrefs = links.map((link) => link.getAttribute("href"));
    expect(hrefs).toContain("/equity/security/TATA?tab=filings");
    expect(hrefs).toContain("/equity/security/INFOSYS?tab=filings");

    const detail = await screen.findByText("Form 483 observations noted");
    expect(detail).toBeInTheDocument();
  });

  it("empty state shows a helpful message when there are no events", async () => {
    mocks.fetchFilingsWatchEvents.mockResolvedValue([]);

    render(<FilingsWatchPanel />);

    const message = await screen.findByText(/No filings-watch events yet/);
    expect(message).toBeInTheDocument();
  });

  it("saves settings from the form when Save is clicked", async () => {
    render(<FilingsWatchPanel />);

    await screen.findByText("Save");

    const runHourInput = await screen.findByLabelText("Run hour UTC");
    fireEvent.change(runHourInput, { target: { value: "9" } });

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(mocks.saveFilingsWatchSettings).toHaveBeenCalledTimes(1));

    const calledWith = mocks.saveFilingsWatchSettings.mock.calls[0][0] as FilingsWatchSettings;
    expect(calledWith.run_hour_utc).toBe(9);
    expect(calledWith.enabled).toBe(true);
  });

  it("toggles a notify option on and off", async () => {
    render(<FilingsWatchPanel />);

    await screen.findByText("Notify on");

    const checkbox = await screen.findByLabelText("Notify on adverse_regulatory");
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox).toBeChecked());

    fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox).not.toBeChecked());
  });
});