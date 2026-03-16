/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChartAlertComposer } from "../components/chart/ChartAlertComposer";
import type { ChartAlertDraft } from "../shared/chart/chartAlerts";

const DRAFT: ChartAlertDraft = {
  symbol: "AAPL",
  title: "Create Alert from SMA",
  threshold: 102.5,
  suggestedConditionType: "price_above",
  note: "SMA snapshot @ 102.5",
  chartContext: {
    version: 1,
    surface: "chart",
    source: "indicator",
    symbol: "AAPL",
    market: "US",
    timeframe: "1D",
    panelId: "slot-1",
    workspaceId: "slot-1",
    compareMode: "normalized",
    sourceLabel: "SMA",
    referencePrice: 102.5,
    referenceTime: 1_700_000_060,
    drawing: null,
    indicator: {
      id: "sma",
      label: "SMA",
      plotId: "value",
      value: 102.5,
      params: { period: 20 },
      overlay: true,
    },
  },
};

describe("ChartAlertComposer", () => {
  afterEach(() => {
    cleanup();
  });

  it("submits the edited alert payload", () => {
    const onSubmit = vi.fn();
    render(<ChartAlertComposer draft={DRAFT} onCancel={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByTestId("chart-alert-condition"), { target: { value: "price_below" } });
    fireEvent.change(screen.getByTestId("chart-alert-threshold"), { target: { value: "99.75" } });
    fireEvent.change(screen.getByTestId("chart-alert-cooldown"), { target: { value: "60" } });
    fireEvent.change(screen.getByTestId("chart-alert-note"), { target: { value: "Below SMA retrace" } });
    fireEvent.click(screen.getByTestId("chart-alert-channel-push"));
    fireEvent.click(screen.getByTestId("chart-alert-submit"));

    expect(onSubmit).toHaveBeenCalledWith({
      conditionType: "price_below",
      threshold: 99.75,
      cooldownSeconds: 60,
      note: "Below SMA retrace",
      channels: ["in_app", "push"],
    });
  });

  it("re-seeds the draft state when a new source is selected", () => {
    const { rerender } = render(<ChartAlertComposer draft={DRAFT} onCancel={vi.fn()} onSubmit={vi.fn()} />);

    fireEvent.change(screen.getByTestId("chart-alert-threshold"), { target: { value: "88" } });

    rerender(
      <ChartAlertComposer
        draft={{
          ...DRAFT,
          threshold: 205,
          note: "Price snapshot @ 205",
          chartContext: {
            ...DRAFT.chartContext,
            source: "price",
            sourceLabel: "Price Snapshot",
            referencePrice: 205,
          },
        }}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect((screen.getByTestId("chart-alert-threshold") as HTMLInputElement).value).toBe("205");
    expect((screen.getByTestId("chart-alert-note") as HTMLInputElement).value).toBe("Price snapshot @ 205");
  });
});
