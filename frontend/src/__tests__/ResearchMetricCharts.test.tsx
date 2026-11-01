import { render, screen, within } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { EarningsComparisonChart, ThresholdComparisonChart, metricDomain } from "../components/research/ResearchMetricCharts";
import type { ThesisCondition } from "../api/researchDossiers";

const condition: ThesisCondition = { id: "margin", label: "Operating margin", metric: "operating_margin", operator: "gte", threshold: 18, unit: "%", enabled: true };
describe("research metric charts", () => {
  it("ignores missing and nonfinite data without inventing zero, and pads constant values", () => {
    expect(metricDomain([null, undefined, NaN, Infinity])).toBeNull();
    expect(metricDomain([18, 18])).toEqual([14.4, 21.6]);
    expect(metricDomain([-5, 5])).toEqual([-6.5, 6.5]);
  });
  it("places latest and previous observations on the threshold scale with an accessible numeric fallback", () => {
    const { container } = render(<ThresholdComparisonChart condition={condition} result={{ condition, condition_id: condition.id, status: "breached", reason: "Below", value: 16, previous_value: 19, evidence: null }} />);
    const figure = screen.getByRole("figure", { name: /Operating margin.*threshold comparison/ });
    expect(within(figure).getByText("≥ 18 %")).toBeInTheDocument();
    expect(within(figure).getByText("16 %")).toBeInTheDocument();
    expect(within(figure).getByText("19 %")).toBeInTheDocument();
    const circles = container.querySelectorAll("circle");
    expect(parseFloat(circles[1].getAttribute("cx")!)).toBeLessThan(parseFloat(circles[0].getAttribute("cx")!));
    expect(container.querySelectorAll("svg[aria-hidden=true]")).toHaveLength(3);
  });
  it("does not draw a zero observation while waiting for evidence", () => {
    const { container } = render(<ThresholdComparisonChart condition={condition} />);
    expect(container.querySelectorAll("circle")).toHaveLength(0);
    expect(screen.getAllByText("Not recorded")).toHaveLength(2);
    expect(screen.getByText(/Awaiting a comparable observation/)).toBeInTheDocument();
  });
  it("draws a guidance band and keeps separate currency and percentage scales", () => {
    const { container } = render(<><EarningsComparisonChart period="FY2026 Q2" metric={{ metric: "margin", label: "Margin", unit: "%", expected: 18, actual: 16, guidance_low: 17, guidance_high: 19 }} /><EarningsComparisonChart period="FY2026 Q2" metric={{ metric: "revenue", label: "Revenue", unit: "INR crore", expected: 200, actual: 210 }} /></>);
    expect(container.querySelectorAll(".research-metric-chart__band")).toHaveLength(2);
    const margin = screen.getByRole("figure", { name: /Margin.*earnings comparison/ });
    expect(within(margin).getByText(/Guidance band: 17–19 %/)).toBeInTheDocument();
    expect(within(margin).queryByText(/210/)).not.toBeInTheDocument();
    expect(screen.getByText("210 INR crore")).toBeInTheDocument();
  });
  it("labels one-sided guidance and rejects reversed bounds", () => {
    const { container, rerender } = render(<EarningsComparisonChart period="FY2026" metric={{ metric: "margin", label: "Margin", unit: "%", guidance_low: 18 }} />);
    expect(screen.getByText(/at least 18 %; shading continues to the right/)).toBeInTheDocument();
    expect(container.querySelector(".research-metric-chart__band")).toBeInTheDocument();
    rerender(<EarningsComparisonChart period="FY2026" metric={{ metric: "margin", label: "Margin", unit: "%", guidance_low: 20, guidance_high: 18 }} />);
    expect(container.querySelector(".research-metric-chart__band")).not.toBeInTheDocument();
    expect(screen.getByText(/bounds are inconsistent/)).toBeInTheDocument();
  });
  it("renders an honest empty state without numeric marks", () => {
    const { container } = render(<EarningsComparisonChart period="FY2026" metric={{ metric: "margin", label: "Margin", unit: "%" }} />);
    expect(screen.getByText("No numeric observations to plot.")).toBeInTheDocument();
    expect(container.querySelectorAll("circle, rect, line")).toHaveLength(0);
  });
});
