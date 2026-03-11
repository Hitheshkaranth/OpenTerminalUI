import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LiveClockStrip } from "../components/home/LiveClockStrip";
import { MarketHeatStrip } from "../components/home/MarketHeatStrip";
import { MetricCard } from "../components/home/MetricCard";
import { PortfolioMiniChart } from "../components/home/PortfolioMiniChart";
import { ProfileCompletionRing } from "../components/home/ProfileCompletionRing";
import { QuickNavGrid } from "../components/home/QuickNavGrid";
import { SparklineCell } from "../components/home/SparklineCell";
import { SystemHealthBar } from "../components/home/SystemHealthBar";

describe("shared home widgets", () => {
  it("renders interactive sparkline tooltips with keyboard access", () => {
    render(
      <SparklineCell
        points={[100, 104, 110, 108]}
        benchmarkPoints={[98, 101, 103, 105]}
        ariaLabel="Index sparkline"
        showTooltip
        valueFormatter={(value) => `${value.toFixed(0)} pts`}
      />,
    );

    const sparkline = screen.getByRole("img", { name: "Index sparkline" });
    fireEvent.focus(sparkline);
    expect(screen.getByText("108 pts")).toBeInTheDocument();

    fireEvent.keyDown(sparkline, { key: "ArrowLeft" });
    expect(screen.getByText("110 pts")).toBeInTheDocument();
  });

  it("renders metric cards with details and embedded sparkline data", () => {
    render(
      <MetricCard
        label="Total Value"
        value="INR 25,47,000"
        delta={{ label: "+1,47,000 (+6.12%)", tone: "up" }}
        details={[
          { label: "Holdings", value: "12" },
          { label: "Watchlist", value: "28", tone: "accent" },
        ]}
        sparklinePoints={[24, 26, 25, 27]}
      />,
    );

    expect(screen.getByText("Total Value")).toBeInTheDocument();
    expect(screen.getByText("INR 25,47,000")).toBeInTheDocument();
    expect(screen.getByText("+1,47,000 (+6.12%)")).toBeInTheDocument();
    expect(screen.getByText("Holdings")).toBeInTheDocument();
    expect(screen.getByText("28")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Total Value sparkline" })).toBeInTheDocument();
  });

  it("renders heat strip chips and exposes selected market actions", () => {
    const onSelect = vi.fn();

    render(
      <MarketHeatStrip
        selectedItemId="nifty"
        onSelect={onSelect}
        items={[
          { id: "nifty", label: "NIFTY", value: 22400.5, changePct: 0.42 },
          { id: "vix", label: "VIX", value: 14.2, changePct: -1.12 },
        ]}
      />,
    );

    const niftyButton = screen.getByRole("button", { name: /nifty 22,400.5/i });
    expect(niftyButton).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: /vix 14.2/i }));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "vix",
        label: "VIX",
      }),
    );
  });

  it("supports keyboard navigation and activation in the quick nav grid", () => {
    const onSelect = vi.fn();

    render(
      <QuickNavGrid
        columnCount={2}
        onSelect={onSelect}
        sections={[
          {
            id: "equity",
            title: "Equity",
            items: [
              { id: "market", label: "Market", shortcut: "F1" },
              { id: "screen", label: "Screener", shortcut: "F2", description: "Scan equities" },
            ],
          },
        ]}
      />,
    );

    const marketButton = screen.getByRole("button", { name: "Market" });
    const screenerButton = screen.getByRole("button", { name: "Screener. Scan equities" });

    marketButton.focus();
    fireEvent.keyDown(marketButton, { key: "ArrowRight" });
    expect(screenerButton).toHaveFocus();

    fireEvent.keyDown(screenerButton, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "screen",
        shortcut: "F2",
      }),
    );
  });

  it("renders system health indicators with visible status text", () => {
    render(
      <SystemHealthBar
        items={[
          { id: "ws", label: "WS", value: "Connected", tone: "ok" },
          { id: "feed", label: "Data", value: "NSE Active", tone: "info" },
          { id: "sync", label: "Last Sync", value: "14:32:01", tone: "stale" },
        ]}
      />,
    );

    expect(screen.getByText("WS")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("NSE Active")).toBeInTheDocument();
    expect(screen.getByText("14:32:01")).toBeInTheDocument();
  });

  it("renders the portfolio mini chart with keyboard-updated hover state", () => {
    render(
      <PortfolioMiniChart
        points={[
          { label: "Day 1", value: 1000 },
          { label: "Day 2", value: 1080 },
          { label: "Day 3", value: 1150 },
        ]}
        benchmarkPoints={[990, 1040, 1100]}
      />,
    );

    const chartSurface = screen.getByLabelText("Portfolio performance chart interaction surface");
    fireEvent.focus(chartSurface);
    const chart = screen.getByRole("group", { name: "Portfolio performance chart" });
    expect(within(chart).getByText("Day 3", { selector: ".ot-home-widget-chart-tooltip-label" })).toBeInTheDocument();
    expect(within(chart).getByText("1,150", { selector: ".ot-home-widget-chart-tooltip-value" })).toBeInTheDocument();

    fireEvent.keyDown(chartSurface, { key: "ArrowLeft" });
    expect(within(chart).getByText("Day 2", { selector: ".ot-home-widget-chart-tooltip-label" })).toBeInTheDocument();
    expect(within(chart).getByText("1,080", { selector: ".ot-home-widget-chart-tooltip-value" })).toBeInTheDocument();
    expect(within(chart).getByText("Benchmark 1,100")).toBeInTheDocument();
  });

  it("renders a fixed multi-timezone clock strip", () => {
    render(
      <LiveClockStrip
        now={new Date("2026-01-15T12:00:00.000Z")}
        zones={[
          { id: "ist", label: "IST", timeZone: "Asia/Kolkata" },
          { id: "utc", label: "UTC", timeZone: "UTC" },
        ]}
      />,
    );

    expect(screen.getByText("IST")).toBeInTheDocument();
    expect(screen.getByText("UTC")).toBeInTheDocument();
    expect(screen.getByText("17:30:00")).toBeInTheDocument();
    expect(screen.getByText("12:00:00")).toBeInTheDocument();
  });

  it("renders a completion ring with progress semantics and missing fields", () => {
    render(
      <ProfileCompletionRing
        value={72}
        missingFields={["Date of Birth", "Phone"]}
      />,
    );

    const progress = screen.getByRole("progressbar", { name: "Profile completion" });
    expect(progress).toHaveAttribute("aria-valuenow", "72");
    expect(screen.getByText("72%")).toBeInTheDocument();
    expect(screen.getByText("Missing: Date of Birth, Phone")).toBeInTheDocument();
  });
});
