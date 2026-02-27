import { describe, expect, it, vi, beforeEach } from "vitest";

import { executeParsedCommand, parseCommand } from "../components/layout/commanding";
import { useStockStore } from "../store/stockStore";

describe("GO commanding", () => {
  beforeEach(() => {
    useStockStore.setState({
      ticker: "RELIANCE",
      load: vi.fn(async () => undefined),
    } as Partial<ReturnType<typeof useStockStore.getState>> as any);
  });

  it("parses ticker-only commands", () => {
    const parsed = parseCommand("AAPL");
    expect(parsed.kind).toBe("ticker");
    if (parsed.kind === "ticker") expect(parsed.ticker).toBe("AAPL");
  });

  it("parses ticker + function commands", () => {
    const parsed = parseCommand("AAPL GP");
    expect(parsed.kind).toBe("ticker-function");
    if (parsed.kind === "ticker-function") {
      expect(parsed.ticker).toBe("AAPL");
      expect(parsed.func).toBe("GP");
    }
  });

  it("executes function-only route command", () => {
    const navigate = vi.fn();
    const result = executeParsedCommand(parseCommand("WL"), navigate as any);
    expect(result.ok).toBe(true);
    expect(navigate).toHaveBeenCalledWith("/equity/watchlist");
  });

  it("executes natural language command to AI news route", () => {
    const navigate = vi.fn();
    const result = executeParsedCommand(parseCommand("what's the top semiconductor earnings news"), navigate as any);
    expect(result.ok).toBe(true);
    expect(navigate).toHaveBeenCalledWith(
      expect.stringContaining("/equity/news?q="),
    );
  });
});
