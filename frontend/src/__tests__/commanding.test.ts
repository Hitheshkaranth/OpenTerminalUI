/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  CHART_WORKSTATION_ACTION_EVENT,
  buildAssetDisambiguationOptions,
  dispatchChartWorkstationAction,
  executeParsedCommand,
  findShortcutConflicts,
  parseCommand,
} from "../components/layout/commanding";
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

  it("parses ticker + function + subfunction commands", () => {
    const parsed = parseCommand("AAPL FA MARGINS");
    expect(parsed.kind).toBe("ticker-function");
    if (parsed.kind === "ticker-function") {
      expect(parsed.ticker).toBe("AAPL");
      expect(parsed.func).toBe("FA");
      expect(parsed.modifiers).toEqual(["MARGINS"]);
    }
  });

  it("executes function-only route command", () => {
    const navigate = vi.fn();
    const result = executeParsedCommand(parseCommand("WL"), navigate as any);
    expect(result.ok).toBe(true);
    expect(navigate).toHaveBeenCalledWith("/equity/watchlist");
  });

  it("routes ticker-only commands to the market stock page", () => {
    const navigate = vi.fn();
    const result = executeParsedCommand(parseCommand("AAPL"), navigate as any);
    expect(result.ok).toBe(true);
    expect(navigate).toHaveBeenCalledWith("/equity/stocks?ticker=AAPL");
  });

  it("routes financial subfunctions to the requested Security Hub subtab", () => {
    const navigate = vi.fn();
    const result = executeParsedCommand(parseCommand("AAPL FA MARGINS"), navigate as any);
    expect(result.ok).toBe(true);
    expect(navigate).toHaveBeenCalledWith("/equity/security/AAPL?tab=financials&subtab=margins#financials-margins");
  });

  it("supports the appendix command set without regressing routing", () => {
    const navigate = vi.fn();
    const cases = [
      ["CMDTY GC1", "/equity/commodities?symbol=GC1"],
      ["FX EURUSD", "/equity/forex?pair=EURUSD"],
      ["ETFA SPY", "/equity/etf-analytics?ticker=SPY"],
      ["BOND", "/equity/bonds"],
      ["HOT", "/equity/hotlists"],
      ["TCA AAPL", "/equity/portfolio?ticker=AAPL&view=tca"],
      ["COMM AAPL", "/equity/news?ticker=AAPL&view=community"],
      ["DEPTH AAPL", "/equity/chart-workstation?panel=depth&ticker=AAPL&symbol=AAPL"],
    ] as const;

    for (const [input, target] of cases) {
      navigate.mockClear();
      const result = executeParsedCommand(parseCommand(input), navigate as any);
      expect(result.ok).toBe(true);
      expect(navigate).toHaveBeenCalledWith(target);
    }
  });

  it("builds asset disambiguation commands when multiple asset classes share a symbol", () => {
    const options = buildAssetDisambiguationOptions("AAPL", [
      { ticker: "AAPL", name: "Apple Inc.", exchange: "NASDAQ", country_code: "US" },
      { ticker: "AAPL", name: "Apple ETF Tracker", exchange: "ETF", country_code: "US" },
    ] as any);

    expect(options).toHaveLength(2);
    expect(options.map((option) => option.command)).toEqual(expect.arrayContaining(["AAPL", "ETFA AAPL"]));
  });

  it("executes natural language command to AI news route", () => {
    const navigate = vi.fn();
    const result = executeParsedCommand(parseCommand("what's the top semiconductor earnings news"), navigate as any);
    expect(result.ok).toBe(true);
    expect(navigate).toHaveBeenCalledWith(
      expect.stringContaining("/equity/news?q="),
    );
  });

  it("detects overlapping shortcut conflicts", () => {
    const conflicts = findShortcutConflicts([
      { id: "a", combo: "Ctrl+W", description: "Global A", scope: "global" },
      { id: "b", combo: "Ctrl+W", description: "Scoped B", scope: "chart-workstation" },
      { id: "c", combo: "Ctrl+K", description: "Scoped C", scope: "chart-workstation" },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.combo).toBe("ctrl+w");
  });

  it("dispatches chart workstation actions as window events", () => {
    const listener = vi.fn();
    window.addEventListener(CHART_WORKSTATION_ACTION_EVENT, listener as EventListener);

    const result = dispatchChartWorkstationAction("chart.toggleIndicators");
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Chart workstation is not ready");
    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0]?.[0] as CustomEvent<{ id: string }>).detail.id).toBe("chart.toggleIndicators");

    window.removeEventListener(CHART_WORKSTATION_ACTION_EVENT, listener as EventListener);
  });

  it("returns action results supplied by the workstation listener", () => {
    const listener = vi.fn((event: Event) => {
      const detail = (event as CustomEvent<{ handled?: boolean; ok?: boolean; message?: string }>).detail;
      detail.handled = true;
      detail.ok = false;
      detail.message = "Select a chart pane first.";
    });
    window.addEventListener(CHART_WORKSTATION_ACTION_EVENT, listener as EventListener);

    expect(dispatchChartWorkstationAction("chart.toggleReplay")).toEqual({
      ok: false,
      message: "Select a chart pane first.",
    });

    window.removeEventListener(CHART_WORKSTATION_ACTION_EVENT, listener as EventListener);
  });
});
