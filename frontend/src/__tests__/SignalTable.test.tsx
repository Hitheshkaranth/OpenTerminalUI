import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { SignalTable } from "../agent/components/SignalTable";
import type { SignalTableData } from "../agent/types";

afterEach(() => cleanup());

const fixture: SignalTableData = {
  as_of: "2025-01-01T00:00:00Z",
  basket: ["AAPL", "TCS"],
  personas: [
    { id: "value", label: "Value Investor", weight: 0.6 },
    { id: "momentum", label: "Momentum Trader", weight: 0.4 },
  ],
  signals: [
    { symbol: "AAPL", persona: "value", signal: "bullish", confidence: 80, reason: "Strong balance sheet" },
    { symbol: "AAPL", persona: "momentum", signal: "bullish", confidence: 70, reason: "Breakout above resistance" },
    { symbol: "TCS", persona: "value", signal: "bearish", confidence: 60, reason: "Overvalued PE" },
    { symbol: "TCS", persona: "momentum", signal: "neutral", confidence: 50, reason: "Consolidating range" },
  ],
  consensus: [
    { symbol: "AAPL", score: 76, verdict: "BUY", bullish: 2, bearish: 0, neutral: 0 },
    { symbol: "TCS", score: -30, verdict: "SELL", bullish: 0, bearish: 1, neutral: 1 },
  ],
};

describe("SignalTable", () => {
  it("renders verdict badges and counts for both symbols", () => {
    render(<SignalTable data={fixture} />);
    expect(screen.getByText("AAPL")).toBeTruthy();
    expect(screen.getByText("TCS")).toBeTruthy();
    expect(screen.getByText("BUY")).toBeTruthy();
    expect(screen.getByText("SELL")).toBeTruthy();
    expect(screen.getByText("2 / 0 / 0")).toBeTruthy();
    expect(screen.getByText("0 / 1 / 1")).toBeTruthy();
  });

  it("expanding a row shows persona reasons", () => {
    render(<SignalTable data={fixture} />);
    fireEvent.click(screen.getByText("AAPL").parentElement!);
    expect(screen.getByText("Strong balance sheet")).toBeTruthy();
    expect(screen.getByText("Breakout above resistance")).toBeTruthy();
  });

  it("renders ScorecardStrip content", () => {
    render(<SignalTable data={fixture} />);
    expect(screen.getByText("Scorecard")).toBeTruthy();
  });
});