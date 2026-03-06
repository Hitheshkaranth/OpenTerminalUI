import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BreakoutScannerPage } from "../pages/BreakoutScanner";
import { useAlertsStore } from "../store/alertsStore";
import type { AlertSocketEvent, UseAlertsOptions } from "../hooks/useAlerts";

const mockFetchScannerPresets = vi.fn();
const mockRunScanner = vi.fn();
const mockCreateScannerAlertRule = vi.fn();
let capturedOnAlert: ((event: AlertSocketEvent) => void) | undefined;

vi.mock("../api/client", () => ({
  fetchScannerPresets: (...args: unknown[]) => mockFetchScannerPresets(...args),
  runScanner: (...args: unknown[]) => mockRunScanner(...args),
  createScannerAlertRule: (...args: unknown[]) => mockCreateScannerAlertRule(...args),
}));

vi.mock("../hooks/useAlerts", () => ({
  useAlerts: (options: UseAlertsOptions = {}) => {
    capturedOnAlert = options.onAlert;
    return { connected: true, lastAlert: null, error: null };
  },
}));

describe("BreakoutScannerPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnAlert = undefined;
    useAlertsStore.getState().resetUnread();
    mockFetchScannerPresets.mockResolvedValue([
      {
        id: "preset-breakout",
        name: "Breakout Scanner",
        universe: "NSE:NIFTY50",
        timeframe: "1d",
        liquidity_gate: { min_price: 10, min_avg_volume: 0, min_avg_traded_value: 0 },
        rules: [],
        ranking: { mode: "default", params: {} },
        created_at: "2026-03-05T00:00:00Z",
        updated_at: "2026-03-05T00:00:00Z",
      },
    ]);
    mockRunScanner.mockResolvedValue({
      run_id: "run-1",
      count: 1,
      rows: [
        {
          run_id: "run-1",
          symbol: "NSE:RELIANCE",
          setup_type: "BREAKOUT_N_DAY_HIGH",
          score: 0.92,
          signal_ts: "2026-03-05T00:00:00Z",
          levels: { trigger_level: 2550, invalidation_level: 2490, target_level: 2670 },
          features: {},
          explain: {},
        },
        {
          run_id: "run-1",
          symbol: "NSE:AXISBANK",
          setup_type: "VOLUME_SURGE",
          score: 0.61,
          signal_ts: "2026-03-04T00:00:00Z",
          levels: { trigger_level: 100, invalidation_level: 95, target_level: 110 },
          features: {},
          explain: {},
        },
        {
          run_id: "run-1",
          symbol: "NSE:TCS",
          setup_type: "BREAKOUT_N_DAY_HIGH",
          score: 0.75,
          signal_ts: "2026-03-03T00:00:00Z",
          levels: { trigger_level: 3000, invalidation_level: 2960, target_level: 3080 },
          features: {},
          explain: {},
        },
      ],
      summary: {},
    });
    mockCreateScannerAlertRule.mockResolvedValue(undefined);
  });

  it("runs breakout scan and renders recommendation cards", async () => {
    render(<BreakoutScannerPage />);
    await waitFor(() => expect(mockFetchScannerPresets).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId("breakout-run-button"));

    await waitFor(() => {
      expect(mockRunScanner).toHaveBeenCalledWith({ preset_id: "preset-breakout", limit: 30, offset: 0 });
    });
    const card = await screen.findByTestId("recommendation-NSE:RELIANCE");
    expect(card).toBeInTheDocument();
    expect(card.textContent).toContain("R:R 2.00:1");
  });

  it("creates scanner alert from recommendation card", async () => {
    render(<BreakoutScannerPage />);
    await waitFor(() => expect(mockFetchScannerPresets).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId("breakout-run-button"));
    await screen.findByTestId("create-alert-NSE:RELIANCE");

    fireEvent.click(screen.getByTestId("create-alert-NSE:RELIANCE"));

    await waitFor(() =>
      expect(mockCreateScannerAlertRule).toHaveBeenCalledWith({
        preset_id: "preset-breakout",
        symbol: "NSE:RELIANCE",
        setup_type: "BREAKOUT_N_DAY_HIGH",
        trigger_level: 2550,
        invalidation_level: 2490,
        near_trigger_pct: 0.003,
        dedupe_minutes: 15,
        enabled: true,
        meta_json: { run_id: "run-1", score: 0.92 },
      }),
    );
  });

  it("filters and sorts recommendations deterministically", async () => {
    render(<BreakoutScannerPage />);
    await waitFor(() => expect(mockFetchScannerPresets).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId("breakout-run-button"));
    await screen.findByTestId("recommendation-NSE:RELIANCE");

    const cardsByScore = screen.getAllByTestId(/^recommendation-/).map((el) => el.getAttribute("data-testid"));
    expect(cardsByScore).toEqual(["recommendation-NSE:RELIANCE", "recommendation-NSE:TCS", "recommendation-NSE:AXISBANK"]);

    fireEvent.change(screen.getByTestId("breakout-sort-select"), { target: { value: "symbol_asc" } });
    const cardsBySymbol = screen.getAllByTestId(/^recommendation-/).map((el) => el.getAttribute("data-testid"));
    expect(cardsBySymbol).toEqual(["recommendation-NSE:AXISBANK", "recommendation-NSE:RELIANCE", "recommendation-NSE:TCS"]);

    fireEvent.change(screen.getByTestId("breakout-setup-filter"), { target: { value: "BREAKOUT_N_DAY_HIGH" } });
    expect(screen.queryByTestId("recommendation-NSE:AXISBANK")).not.toBeInTheDocument();
    expect(screen.getByTestId("recommendation-NSE:RELIANCE")).toBeInTheDocument();
    expect(screen.getByTestId("recommendation-NSE:TCS")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("breakout-min-score-input"), { target: { value: "0.9" } });
    expect(screen.getByTestId("recommendation-NSE:RELIANCE")).toBeInTheDocument();
    expect(screen.queryByTestId("recommendation-NSE:TCS")).not.toBeInTheDocument();
  });

  it("inserts live recommendation rows from alert websocket events", async () => {
    render(<BreakoutScannerPage />);
    await waitFor(() => expect(mockFetchScannerPresets).toHaveBeenCalledTimes(1));
    expect(capturedOnAlert).toBeTypeOf("function");

    act(() => {
      capturedOnAlert?.({
        type: "alert_triggered",
        alert_id: "a-live-1",
        symbol: "NSE:INFY",
        condition: "price_above",
        triggered_value: 1520,
        timestamp: "2026-03-05T00:00:00Z",
        payload: {
          setup_type: "BREAKOUT_N_DAY_HIGH",
          score: 0.88,
          levels: { trigger_level: 1520, invalidation_level: 1490, target_level: 1580 },
        },
      });
    });

    expect(await screen.findByTestId("recommendation-NSE:INFY")).toBeInTheDocument();
  });
});
