import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ScreenChange } from "../api/screenMonitoring";
import { ScreenCoverageChart, ScreenChangesChart, ScreenMetricChangeChart } from "../components/screener/ScreenMonitoringCharts";
import { screenChangeSummary, screenCoverageSegments, screenMetricComparisons, screenMetricDifference, screenMetricScale, screenMetricValue } from "../components/screener/screenChartData";
const change: ScreenChange = { id: "1", symbol: "FIXTURE", kind: "entered", observed_at: "2026-11-01T00:00:00Z", data_observed_at: "2026-11-01T00:00:00Z", source: "Test fixture", before: { roe: -4, pe: 18 }, after: { roe: 6, pe: 12 }, rules: ["roe > 5", "pe < 15"] };
describe("screen monitoring visual evidence", () => {
  it("uses the requested universe denominator and separates incomplete from stale", () => {
    const coverage = { requested: 10, evaluated: 6, missing: ["A", "B"], stale: ["C"], unknown: ["D"] };
    const { container } = render(<ScreenCoverageChart coverage={coverage} />);
    expect(container.querySelector(".screen-coverage-evaluated")).toHaveStyle({ width: "60%" });
    expect(screen.getByText("Incomplete")).toBeInTheDocument();
    expect(screen.getByText("Companies checked, not companies matching")).toBeInTheDocument();
    expect(screenCoverageSegments(coverage).segments.reduce((sum, row) => sum + row.percentage, 0)).toBe(100);
  });
  it("shows unclassified coverage and suppresses misleading bars when counts exceed total", () => {
    expect(screenCoverageSegments({ requested: 3, evaluated: 1, missing: [], stale: [], unknown: [] }).segments.at(-1)).toMatchObject({ key: "unclassified", count: 2 });
    const { container } = render(<ScreenCoverageChart coverage={{ requested: 1, evaluated: 2, missing: [], stale: [], unknown: [] }} />);
    expect(screen.getByText(/counts do not reconcile/)).toBeInTheDocument();
    expect(container.querySelector(".screen-coverage-track")).toBeNull();
  });
  it("never invents coverage or transitions for an empty baseline", () => {
    render(<><ScreenCoverageChart coverage={{ requested: 0, evaluated: 0, missing: [], stale: [], unknown: [] }} /><ScreenChangesChart changes={[]} /></>);
    expect(screen.getByText(/No universe observations/)).toBeInTheDocument();
    expect(screen.getByText(/No recorded transitions to chart/)).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });
  it("counts recorded transitions, deduplicating event ids but allowing repeat companies", () => {
    expect(screenChangeSummary([change, change, { ...change, id: "2", kind: "exited" }, { ...change, id: "3" }])).toMatchObject({ total: 3, entered: 2, exited: 1 });
  });
  it("plots negative values and known rule thresholds, and switches metrics accessibly", () => {
    const { container } = render(<ScreenMetricChangeChart change={change} />);
    expect(screen.getByRole("img")).toHaveAccessibleName(/previous -4%, current 6%.*\+10 percentage points/);
    expect(container.querySelector(".screen-metric-threshold")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Compare metric"), { target: { value: "pe" } });
    expect(screen.getByRole("img")).toHaveAccessibleName(/previous 18×, current 12×/);
    expect(screen.getByText(/saved condition < 15×/)).toBeInTheDocument();
  });
  it("retains before-only metrics and distinguishes missing observations from actual zero", () => {
    const partial = { ...change, before: { roe: 0, pe: 10 }, after: { roe: NaN } };
    expect(screenMetricComparisons(partial)).toEqual(expect.arrayContaining([expect.objectContaining({ metric: "pe", before: 10, after: null })]));
    const { container } = render(<ScreenMetricChangeChart change={partial} />);
    expect(screen.getByRole("img")).toHaveAccessibleName(/previous 0%, current Unavailable/);
    expect(container.querySelector(".screen-metric-current")).toBeNull();
    expect(container.querySelector(".screen-metric-previous")).toBeInTheDocument();
    expect(screenMetricValue(Infinity, "roe")).toBe("Unavailable");
  });
  it("does not invent currency units and keeps extreme scales finite", () => {
    expect(screenMetricValue(100, "market_cap")).toBe("100 unit not supplied");
    expect(screenMetricDifference(4, 6, "roe")).toBe("+2 percentage points");
    const scale = screenMetricScale([-1e308, 1e308]);
    expect(scale.position(0)).toBe(50);
    expect(scale.position(1e308)).toBe(100);
    expect(screenMetricDifference(-1e308, 1e308, "roe")).toBe("Change outside display range");
  });
});
