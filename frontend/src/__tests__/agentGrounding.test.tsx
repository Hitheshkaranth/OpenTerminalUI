import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useAgentStore } from "../agent/agentStore";
import { ChatThread } from "../agent/components/ChatThread";
import type { GroundingReport } from "../agent/types";

const report: GroundingReport = {
  claims: [
    { text: "27.4", value: 27.4, metric: "pe", status: "verified", approx: false, in_code: false,
      source_id: "S1", path: "pe", source_value: 27.43, subject: "TCS" },
    { text: "25.0", value: 25, metric: "pe", status: "mismatch", approx: false, in_code: false,
      source_id: "S2", path: "rows[1].pe", source_value: 24.1, subject: "INFY", expected: "24.1" },
  ],
  sources: [
    { id: "S1", tool: "get_stock_snapshot", call_id: "c1", args: { ticker: "TCS" }, provider: "yahoo",
      quality: "delayed", as_of: "2026-10-06", note: null },
    { id: "S2", tool: "compare_stocks", call_id: "c2", args: {}, provider: "yahoo", quality: "delayed",
      as_of: null, note: null },
  ],
  summary: { total: 2, verified: 1, mismatch: 1, unsourced: 0, low_quality: 0 },
  annotated: "TCS P/E 27.4⟦v:S1⟧ vs INFY P/E 25.0⟦x:S2:24.1⟧",
};

describe("agent grounding", () => {
  beforeEach(() => useAgentStore.setState({ running: false, messages: [], artifacts: [] }));

  it("attaches final and role grounding reports to the pending message", () => {
    const s = useAgentStore.getState();
    s.appendUserAndPending("compare");
    s.applyEvent({ type: "role_message", role: "bull", content: "P/E 27.4" });
    s.applyEvent({ type: "grounding", target: "role", role_index: 0, ...report });
    s.applyEvent({ type: "grounding", target: "final", ...report });
    s.applyEvent({ type: "final", content: "TCS P/E 27.4 vs INFY P/E 25.0" });
    const msg = useAgentStore.getState().messages.at(-1)!;
    expect(msg.grounding?.summary.mismatch).toBe(1);
    expect(msg.roles[0].grounding?.annotated).toBe(report.annotated);
    expect(msg.pending).toBe(false);
  });

  it("renders a source chip per figure and the ground-truth panel", () => {
    render(<ChatThread messages={[{ id: "a", role: "assistant", content: "TCS P/E 27.4 vs INFY P/E 25.0",
      steps: [], phases: [], roles: [], pending: false, grounding: report }]} />);
    expect(screen.getByTitle(/Matches S1: get_stock_snapshot\(TCS\) · yahoo · delayed/)).toHaveTextContent("S1");
    expect(screen.getByTitle(/Does not match S2, which reports 24.1/)).toHaveTextContent("≠S2");
    expect(screen.getByText("1/2 figures verified")).toBeInTheDocument();
    expect(screen.queryByText(/⟦/)).toBeNull();
  });
});
