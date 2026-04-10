import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../components/layout/LaunchpadPanels", () => {
  const MockPanel = ({ panel }: { panel: { id: string; title: string; type: string } }) => (
    <div data-testid={`mock-panel-${panel.id}`}>{panel.title || panel.type}</div>
  );

  return {
    LaunchpadChartPanel: MockPanel,
    LaunchpadWatchlistPanel: MockPanel,
    LaunchpadNewsFeedPanel: MockPanel,
    LaunchpadOrderBookPanel: MockPanel,
    LaunchpadTickerDetailPanel: MockPanel,
    LaunchpadScreenerResultsPanel: MockPanel,
    LaunchpadAlertsPanel: MockPanel,
    LaunchpadPortfolioSummaryPanel: MockPanel,
    LaunchpadHeatmapPanel: MockPanel,
    LaunchpadMarketPulsePanel: MockPanel,
    LaunchpadFundamentalsPanel: MockPanel,
    LaunchpadYieldCurvePanel: MockPanel,
    LaunchpadAIResearchPanel: MockPanel,
    LaunchpadOptionChainPanel: MockPanel,
    LaunchpadWatchlistHeatmapPanel: MockPanel,
    LaunchpadSectorRotationPanel: MockPanel,
    LaunchpadTemplatePlaceholderPanel: MockPanel,
  };
});

import { LaunchpadPage } from "../pages/Launchpad";
import { useWorkspaceTemplateStore } from "../store/workspaceTemplateStore";

describe("Launchpad workspace templates", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    useWorkspaceTemplateStore.setState({
      customTemplates: [],
      activeTemplateId: null,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/user/layouts") && (!init?.method || init.method === "GET")) {
          return {
            ok: true,
            json: async () => ({
              items: [
                {
                  id: "test-layout",
                  name: "Test Layout",
                  panels: [],
                },
              ],
            }),
          } as Response;
        }

        return { ok: true, json: async () => ({ ok: true }) } as Response;
      }),
    );
  });

  it("opens the gallery, applies a template, saves the current layout, and deletes a custom template", async () => {
    const user = userEvent.setup();

    render(<LaunchpadPage />);

    await user.click(await screen.findByRole("button", { name: "Templates" }));
    expect(await screen.findByTestId("workspace-template-gallery")).toBeInTheDocument();
    expect(screen.getAllByTestId(/workspace-template-card-/)).toHaveLength(6);

    await user.click(screen.getByTestId("workspace-template-apply-day-trading"));

    await waitFor(() => {
      expect(screen.getAllByTestId("launchpad-panel-frame")).toHaveLength(4);
    });

    await user.click(screen.getByRole("button", { name: "Templates" }));
    await user.click(screen.getByTestId("workspace-template-save-current"));
    await user.type(screen.getByTestId("workspace-template-name-input"), "My Layout");
    await user.click(screen.getByTestId("workspace-template-save-submit"));

    const customCard = await screen.findByTestId(/workspace-template-card-custom-/);
    expect(within(customCard).getByText("My Layout")).toBeInTheDocument();

    await user.click(within(customCard).getByRole("button", { name: /delete/i }));

    await waitFor(() => {
      expect(screen.queryByText("My Layout")).not.toBeInTheDocument();
    });
  });
});
