import { describe, expect, it } from "vitest";
import {
  TERMINAL_TOOLS, TERMINAL_WORKFLOWS, WORKFLOW_PERSONAS,
  filterTools, filterWorkflows, normalizeWorkflowSymbol, toolDestination,
} from "../workflowCatalog";

describe("workflow catalog", () => {
  it("keeps workflow steps resolvable to unique, internal tools", () => {
    const ids = TERMINAL_TOOLS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(TERMINAL_WORKFLOWS.map((item) => item.id)).size).toBe(TERMINAL_WORKFLOWS.length);
    for (const workflow of TERMINAL_WORKFLOWS) {
      expect(workflow.steps.length).toBeGreaterThan(1);
      for (const step of workflow.steps) expect(ids).toContain(step.tool);
    }
    for (const tool of TERMINAL_TOOLS) {
      expect(tool.path).toMatch(/^\/(equity\/|backtesting(?:\/|$)|fno(?:\/|$))/);
      expect(tool.path).not.toContain(":");
    }
  });

  it("offers a nonempty workflow and tool set for each persona", () => {
    for (const option of WORKFLOW_PERSONAS) {
      expect(filterTools("", option.id).length).toBeGreaterThan(0);
      expect(filterWorkflows("", option.id).length).toBeGreaterThan(0);
      if (option.id !== "all") {
        expect(filterTools("", option.id).every((tool) => tool.category === option.id)).toBe(true);
        expect(filterWorkflows("", option.id).every((workflow) => workflow.category === option.id)).toBe(true);
      }
    }
  });

  it("matches case-insensitive, multiword tasks and searches step tool descriptions", () => {
    expect(filterTools("  PORTFOLIO   risk ", "all").map((tool) => tool.id)).toContain("risk");
    expect(filterWorkflows("filings", "research").map((workflow) => workflow.id)).toContain("evidence-review");
    expect(filterTools("filings", "macro")).toEqual([]);
    expect(filterWorkflows("no-such-task", "all")).toEqual([]);
    expect(filterTools("   ", "all")).toHaveLength(TERMINAL_TOOLS.length);
  });

  it.each(["AAPL", "RELIANCE.NS", "NASDAQ:AAPL", "^NSEI", "GC=F", "BTC-USD", "M&M.NS"])("accepts supported market punctuation in %s", (symbol) => {
    expect(normalizeWorkflowSymbol(symbol.toLowerCase())).toBe(symbol);
  });

  it.each(["", "   ", "AAPL MSFT", "AAPL?admin=true", "<script>", "/login", "A".repeat(41)])("rejects invalid input %s", (symbol) => {
    expect(normalizeWorkflowSymbol(symbol)).toBeNull();
  });

  it("encodes symbol context and preserves comparison's left query contract", () => {
    const security = TERMINAL_TOOLS.find((tool) => tool.id === "security")!;
    const comparison = TERMINAL_TOOLS.find((tool) => tool.id === "compare")!;
    expect(toolDestination(security, " m&m.ns ")).toBe("/equity/security?ticker=M%26M.NS");
    expect(toolDestination(comparison, "aapl")).toBe("/equity/compare?left=AAPL");
    expect(toolDestination(security, "AAPL?bad=1")).toBe("/equity/security");
    expect(toolDestination(TERMINAL_TOOLS.find((tool) => tool.id === "options")!, "AAPL")).toBe("/fno");
  });
});
