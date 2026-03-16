import { describe, expect, it, vi } from "vitest";

import type { AlertRule, ChartPoint } from "../types";
import type { NormalizedChartDrawing } from "../shared/chart/drawingEngine";

vi.mock("../shared/chart/IndicatorManager", () => ({
  computeIndicator: vi.fn((_id: string, _bars: unknown[], _params: Record<string, unknown>) => ({
    metadata: { overlay: true },
    plots: {
      value: [
        { time: 1_700_000_000, value: 101.25 },
        { time: 1_700_000_060, value: 102.5 },
      ],
    },
  })),
  listIndicators: vi.fn(() => [{ id: "sma", name: "SMA", category: "trend", overlay: true, defaultInputs: { period: 20 } }]),
}));

import {
  buildActiveChartAlertPreview,
  buildDrawingAlertDraft,
  buildIndicatorAlertDraft,
  buildPriceAlertDraft,
  chartPointToAlertCandle,
  extractChartAlertContext,
  isDrawingAlertSupported,
} from "../shared/chart/chartAlerts";

function makePoint(t: number, c: number): ChartPoint {
  return { t, o: c - 1, h: c + 1, l: c - 2, c, v: 1000, s: "rth" };
}

function makeDrawing(partial?: Partial<NormalizedChartDrawing>): NormalizedChartDrawing {
  return {
    version: 3,
    id: "drawing-1",
    tool: {
      type: "hline",
      family: "level",
      label: "Horizontal Line",
      minAnchors: 1,
      maxAnchors: 1,
      shape: "level",
    },
    anchors: [{ key: "level", role: "level", time: 1_700_000_000, price: 101.5 }],
    style: { color: "#4ea1ff", lineWidth: 1, lineStyle: "dashed", fillColor: null, fillOpacity: 0 },
    visible: true,
    locked: false,
    order: 0,
    meta: { timeframe: "1D", workspaceId: "slot-1" },
    ...partial,
  };
}

describe("chartAlerts", () => {
  it("builds a price alert draft with chart context", () => {
    const candle = chartPointToAlertCandle(makePoint(1_700_000_000, 100.25));
    const draft = buildPriceAlertDraft({
      symbol: "aapl",
      market: "us",
      timeframe: "15m",
      panelId: "slot-1",
      workspaceId: "slot-1",
      currentPrice: 99,
      referencePrice: 101.25,
      candle,
    });

    expect(draft).toMatchObject({
      symbol: "NASDAQ:AAPL",
      threshold: 101.25,
      suggestedConditionType: "price_above",
      chartContext: {
        source: "price",
        timeframe: "15m",
        market: "NASDAQ",
        symbol: "NASDAQ:AAPL",
        referencePrice: 101.25,
        panelId: "slot-1",
      },
    });
    expect(draft?.chartContext.candle?.close).toBe(100.25);
  });

  it("builds drawing alerts from supported drawings and rejects vertical markers", () => {
    const supported = makeDrawing();
    const draft = buildDrawingAlertDraft({
      symbol: "AAPL",
      market: "US",
      timeframe: "1D",
      panelId: "slot-1",
      workspaceId: "slot-1",
      currentPrice: 99,
      referenceTime: 1_700_000_060,
      drawing: supported,
    });
    expect(isDrawingAlertSupported(supported)).toBe(true);
    expect(draft).toMatchObject({
      threshold: 101.5,
      chartContext: {
        source: "drawing",
        sourceLabel: "Horizontal Line",
        drawing: {
          id: "drawing-1",
          toolType: "hline",
        },
      },
    });

    const vertical = makeDrawing({
      tool: {
        type: "vline",
        family: "marker",
        label: "Vertical Line",
        minAnchors: 1,
        maxAnchors: 1,
        shape: "vertical",
      },
    });
    expect(isDrawingAlertSupported(vertical)).toBe(false);
    expect(
      buildDrawingAlertDraft({
        symbol: "AAPL",
        market: "US",
        timeframe: "1D",
        drawing: vertical,
      }),
    ).toBeNull();
  });

  it("builds indicator alerts from the latest indicator snapshot", () => {
    const data = [makePoint(1_700_000_000, 100), makePoint(1_700_000_060, 101)];
    const draft = buildIndicatorAlertDraft({
      symbol: "AAPL",
      market: "US",
      timeframe: "1D",
      panelId: "slot-1",
      workspaceId: "slot-1",
      currentPrice: 100,
      referenceTime: 1_700_000_060,
      data,
      candle: chartPointToAlertCandle(data[1]),
      config: { id: "sma", params: { period: 20 }, visible: true },
    });

    expect(draft).toMatchObject({
      threshold: 102.5,
      suggestedConditionType: "price_above",
      chartContext: {
        source: "indicator",
        sourceLabel: "SMA",
        symbol: "NASDAQ:AAPL",
        indicator: {
          id: "sma",
          plotId: "value",
          value: 102.5,
        },
      },
    });
  });

  it("extracts chart alert context and builds active alert previews", () => {
    const alert = {
      id: "alert-1",
      ticker: "AAPL",
      alert_type: "price",
      condition: "above",
      threshold: 102.5,
      note: "",
      created_at: "2026-03-12T00:00:00Z",
      condition_type: "price_above",
      parameters: {
        threshold: 102.5,
        chart_context: {
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
        },
      },
    } satisfies AlertRule;

    expect(extractChartAlertContext(alert.parameters)).toMatchObject({
      source: "indicator",
      sourceLabel: "SMA",
      referencePrice: 102.5,
    });
    expect(buildActiveChartAlertPreview(alert)).toEqual({
      id: "alert-1",
      source: "indicator",
      sourceLabel: "SMA",
      conditionLabel: "Above",
      thresholdLabel: "102.5",
      subtitle: "1D | slot-1",
    });
  });
});
