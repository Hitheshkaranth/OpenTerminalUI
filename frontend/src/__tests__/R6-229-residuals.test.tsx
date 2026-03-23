/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

expect.extend(matchers);
import { CommandPalette } from "../components/layout/CommandPalette";
import { ChartWorkstationPage, parseWorkspaceTemplateConfig } from "../pages/ChartWorkstationPage";
import { ChartAlertComposer } from "../components/chart/ChartAlertComposer";
import { MemoryRouter } from "react-router-dom";
import { CHART_WORKSTATION_ACTION_EVENT } from "../components/layout/commanding";

// Mock the API client
vi.mock("../api/client", () => ({
  searchSymbols: vi.fn().mockResolvedValue([]),
  fetchCryptoSearch: vi.fn().mockResolvedValue([]),
  fetchWatchlists: vi.fn().mockResolvedValue({ watchlists: [] }),
  fetchSnapshots: vi.fn().mockResolvedValue({ snapshots: [] }),
  fetchWorkstationSnapshots: vi.fn().mockResolvedValue([]),
  createAlert: vi.fn(),
}));

describe("R6-229 Residuals Verification", () => {
  describe("Alert Misconfiguration Feedback", () => {
    it("displays error message from backend when channel is unconfigured", () => {
      const draft = {
        title: "Test Alert",
        symbol: "AAPL",
        threshold: 150,
        suggestedConditionType: "price_above" as const,
        note: "",
        chartContext: { sourceLabel: "AAPL", timeframe: "1D" } as any,
      };
      const error = "Selected delivery channels are not configured: webhook";

      render(
        <ChartAlertComposer
          draft={draft}
          error={error}
          onCancel={vi.fn()}
          onSubmit={vi.fn()}
        />
      );

      expect(screen.getByText(error)).toBeInTheDocument();
    });
  });

  describe("Workstation Import Market Defaults", () => {
    it("defaults missing market to 'IN'", () => {
      const config = {
        slots: [{ ticker: "RELIANCE", timeframe: "1D" }]
      };
      const parsed = parseWorkspaceTemplateConfig(config as any);
      expect(parsed?.snapshot.slots[0].market).toBe("IN");
    });

    it("respects provided 'US' market", () => {
      const config = {
        slots: [{ ticker: "AAPL", market: "US", timeframe: "1D" }]
      };
      const parsed = parseWorkspaceTemplateConfig(config as any);
      expect(parsed?.snapshot.slots[0].market).toBe("US");
    });
  });

  describe("Command Palette Active Pane Handling", () => {
    it("reports missing active pane error for chart actions", async () => {
      // Mock dispatchChartWorkstationAction indirectly by listening to the event
      const listener = (ev: any) => {
        ev.detail.handled = true;
        ev.detail.ok = false;
        ev.detail.message = "Active chart pane is required for: Toggle Indicators. Click on a chart to select it.";
      };
      window.addEventListener(CHART_WORKSTATION_ACTION_EVENT, listener);

      render(
        <MemoryRouter initialEntries={["/equity/chart-workstation"]}>
          <CommandPalette />
        </MemoryRouter>
      );

      // Open command palette
      fireEvent.keyDown(window, { ctrlKey: true, key: "k" });

      // Find "Toggle Indicators" item and click it
      const button = await screen.findByRole("button", { name: /Toggle Indicators/i });
      fireEvent.click(button);

      // Verify feedback message
      expect(await screen.findByText(/Active chart pane is required/i)).toBeInTheDocument();

      window.removeEventListener(CHART_WORKSTATION_ACTION_EVENT, listener);
    });
  });
});
