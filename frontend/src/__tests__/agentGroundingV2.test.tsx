import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SourcesPanel } from "../agent/components/Grounding";
import type { GroundingReport } from "../agent/types";

const legacy: GroundingReport = {
  claims: [
    { text: "27.4", value: 27.4, metric: "pe", status: "verified", approx: false, in_code: false,
      source_id: "S1", path: "pe", source_value: 27.43, subject: "TCS" },
    { text: "25.0", value: 25, metric: "pe", status: "unsourced", approx: false, in_code: false,
      source_id: null, path: null, source_value: null, subject: null },
  ],
  sources: [
    { id: "S1", tool: "get_stock_snapshot", call_id: "c1", args: { ticker: "TCS" }, provider: "yahoo",
      quality: "delayed", as_of: "2026-10-06", note: null },
  ],
  summary: { total: 2, verified: 1, mismatch: 0, unsourced: 1, low_quality: 0 },
  annotated: "TCS P/E 27.4⟦v:S1⟧ and 25.0⟦u⟧",
};

const v2: GroundingReport = {
  claims: [
    { text: "24.1", value: 24.1, metric: "pe", status: "verified", approx: false, in_code: false,
      source_id: "S2", path: "pe", source_value: 24.1, subject: "AAPL" },
  ],
  sources: [
    { id: "S1", tool: "get_stock_snapshot", call_id: "c1", args: { ticker: "AAPL" }, provider: "yahoo",
      quality: "delayed", as_of: "2026-10-06", note: null },
    { id: "S2", tool: "get_technicals", call_id: "c2", args: { ticker: "AAPL" }, provider: "yahoo",
      quality: "delayed", as_of: "2026-10-06", note: null },
    { id: "S3", tool: "screen_stocks", call_id: "c3", args: {}, provider: "screener fundamentals store",
      quality: "cached", as_of: null, note: null },
    { id: "S6", tool: "get_market_depth", call_id: "c6", args: { ticker: "AAPL" }, provider: "kite",
      quality: "cached", as_of: "2026-09-30T09:54:00+00:00", note: null },
  ],
  summary: { total: 1, verified: 1, mismatch: 0, unsourced: 0, low_quality: 0,
    conflicts: 1, stale: 1, statements_checked: 3, statements_contradicted: 1 },
  annotated: "AAPL P/E 24.1⟦v:S2⟧",
  conflicts: [
    { subject: "AAPL", metric: "roe",
      values: [
        { source_id: "S1", path: "roe_pct", value: 148.75, provider: "yahoo", quality: "delayed" },
        { source_id: "S3", path: "results[0].roe", value: 18.0, provider: "screener fundamentals store", quality: "cached" },
      ],
      spread_pct: 87.9, severity: "high" },
  ],
  stale: [
    { source_id: "S6", tool: "get_market_depth", as_of: "2026-09-30T09:54:00+00:00", age_hours: 151.0, threshold_hours: 24.0 },
  ],
  statements: [
    { text: "price is above its 50-day EMA", start: 0, end: 29, kind: "comparison", status: "verified",
      evidence: [{ source_id: "S2", path: "price", value: 331.6 }, { source_id: "S2", path: "trend.ema_50", value: 324.21 }],
      explanation: "price 331.6 > 50-day EMA 324.21" },
    { text: "RSI is overbought", start: 40, end: 57, kind: "threshold", status: "contradicted",
      evidence: [{ source_id: "S2", path: "momentum.rsi_14", value: 52.3 }],
      explanation: "RSI 52.3 is below the overbought threshold 70" },
    { text: "management sounded confident", start: 60, end: 88, kind: "quote", status: "unverifiable",
      evidence: [], explanation: "no source covers this" },
  ],
  repair: {
    attempted: true, applied: true,
    before: { total: 1, verified: 0, mismatch: 1, unsourced: 0, low_quality: 0 },
    after: { total: 1, verified: 1, mismatch: 0, unsourced: 0, low_quality: 0 },
    changes: [{ from: "25.0", to: "24.1", source_id: "S2" }],
    reason: "1 figure contradicted its source",
  },
};

describe("agent grounding v2 panel", () => {
  it("renders conflicts, statements, stale sources and an applied repair", () => {
    const { container } = render(<SourcesPanel report={v2} />);
    const summary = container.querySelector("summary")!;
    expect(summary).toHaveTextContent("1/1 figures verified");
    expect(summary).toHaveTextContent("· 3 statements checked (1 contradicted)");
    expect(summary).toHaveTextContent("· 1 source conflict");
    expect(summary).toHaveTextContent("· 1 stale source");
    expect(container.querySelector("details")!.open).toBe(true);

    const badge = screen.getByText("auto-corrected 1");
    expect(badge).toHaveAttribute("title", "25.0 → 24.1 (S2)");

    expect(screen.getByText("Sources disagree")).toBeInTheDocument();
    const row = screen.getByText("AAPL · roe").parentElement!;
    expect(row).toHaveTextContent("S1 148.75 (yahoo, delayed)");
    expect(row).toHaveTextContent("S3 18 (screener fundamentals store, cached)");
    expect(row).toHaveTextContent("87.9% apart");

    expect(screen.getByText("RSI 52.3 is below the overbought threshold 70")).toBeInTheDocument();
    expect(screen.getByText("contradicted")).toBeInTheDocument();
    expect(screen.getByText("unverifiable")).toBeInTheDocument();

    expect(screen.getByText(/S6 get_market_depth — as of 2026-09-30T09:54:00\+00:00 \(151h old; budget 24h\)/)).toBeInTheDocument();
    expect(screen.getByText("· stale", { exact: false })).toBeInTheDocument();
    expect(container).toHaveTextContent("Auto-corrected: 25.0 → 24.1 (S2)");
  });

  it("explains a repair that was attempted but not applied", () => {
    const report: GroundingReport = {
      ...legacy,
      repair: { attempted: true, applied: false, before: legacy.summary, after: legacy.summary, changes: [],
        reason: "revision introduced new mismatches" },
    };
    render(<SourcesPanel report={report} />);
    expect(screen.getByText("Auto-correction not applied: revision introduced new mismatches")).toBeInTheDocument();
    expect(screen.queryByText(/auto-corrected/)).toBeNull();
  });

  it("renders a legacy report exactly as before", () => {
    const { container } = render(<SourcesPanel report={legacy} />);
    const summary = container.querySelector("summary")!;
    expect(screen.getByText("1/2 figures verified")).toBeInTheDocument();
    expect(summary).toHaveTextContent("Ground truth1/2 figures verified· 1 unsourced1 source");
    expect(container.querySelector("details")!.open).toBe(false);
    expect(screen.queryByText("Sources disagree")).toBeNull();
    expect(screen.queryByText(/stale/)).toBeNull();
  });

  it("still renders when there are statements but no figures", () => {
    const report: GroundingReport = {
      claims: [], sources: [],
      summary: { total: 0, verified: 0, mismatch: 0, unsourced: 0, low_quality: 0 },
      annotated: "",
      statements: [v2.statements![1]],
    };
    const { container } = render(<SourcesPanel report={report} />);
    expect(container.querySelector("summary")).toHaveTextContent("no figures to check· 1 statement checked (1 contradicted)");
    expect(container.querySelector("details")!.open).toBe(true);
  });
});
