import { describe, expect, it } from "vitest";

import {
  COMPACT_SESSION_SHADE_PALETTE,
  SESSION_SHADING_VALUE,
  TRADING_SESSION_SHADE_PALETTE,
  buildCorePriceSeriesPayload,
  buildCorePriceSeriesUpdate,
  buildSessionAreaMask,
  hasVisibleSessionShading,
  isPostSession,
  isPreSession,
  resolveSessionShadeColor,
} from "../shared/chart/rendererCore";

const EXTENDED_HOURS = {
  enabled: true,
  showPreMarket: true,
  showAfterHours: true,
  visualMode: "merged",
  colorScheme: "dimmed",
} as const;

describe("rendererCore helpers", () => {
  it("builds consolidated core series payloads for session-aware chart data", () => {
    const payload = buildCorePriceSeriesPayload(
      [
        { time: 100, open: 10, high: 11, low: 9, close: 10.5, volume: 100, session: "pre", isExtended: true },
        { time: 200, open: 10.5, high: 12, low: 10, close: 11.4, volume: 120, session: "rth", isExtended: false },
        { time: 300, open: 11.4, high: 12.4, low: 11, close: 11.2, volume: 110, session: "post", isExtended: true },
      ],
      {
        extendedHours: EXTENDED_HOURS as any,
        showSessionShading: true,
        includeSessionAreas: true,
        shadePalette: TRADING_SESSION_SHADE_PALETTE,
      },
    );

    expect(payload.candles).toHaveLength(3);
    expect(payload.closeLine).toEqual([
      { time: 100, value: 10.5 },
      { time: 200, value: 11.4 },
      { time: 300, value: 11.2 },
    ]);
    expect(payload.volume).toHaveLength(3);
    expect(payload.sessionShading).toEqual([
      { time: 100, value: SESSION_SHADING_VALUE, color: TRADING_SESSION_SHADE_PALETTE.pre },
      { time: 200, value: SESSION_SHADING_VALUE, color: TRADING_SESSION_SHADE_PALETTE.regular },
      { time: 300, value: SESSION_SHADING_VALUE, color: TRADING_SESSION_SHADE_PALETTE.post },
    ]);
    expect(payload.preSessionArea).toEqual([
      { time: 100, value: 10.5 },
      { time: 200 },
      { time: 300 },
    ]);
    expect(payload.postSessionArea).toEqual([
      { time: 100 },
      { time: 200 },
      { time: 300, value: 11.2 },
    ]);
  });

  it("builds incremental updates with visibility-aware session shading", () => {
    const update = buildCorePriceSeriesUpdate(
      [
        { time: 100, open: 10, high: 11, low: 9, close: 10.5, volume: 100, s: "rth" },
        { time: 200, open: 10.5, high: 11.5, low: 10.1, close: 11.1, volume: 120, s: "post", ext: true },
      ],
      {
        extendedHours: {
          enabled: true,
          showPreMarket: true,
          showAfterHours: false,
          visualMode: "merged",
          colorScheme: "dimmed",
        } as any,
        showSessionShading: true,
        includeSessionAreas: true,
        shadePalette: COMPACT_SESSION_SHADE_PALETTE,
      },
    );

    expect(update).not.toBeNull();
    expect(update?.closePoint).toEqual({ time: 200, value: 11.1 });
    expect(update?.sessionShadingPoint).toEqual({
      time: 200,
      value: SESSION_SHADING_VALUE,
      color: "transparent",
    });
    expect(update?.postSessionAreaPoint).toEqual({ time: 200, value: 11.1 });
    expect(update?.preSessionAreaPoint).toEqual({ time: 200 });
  });

  it("exposes shared session helpers for renderer parity", () => {
    const data = [
      { time: 100, open: 10, high: 11, low: 9, close: 10.2, volume: 80, session: "pre" },
      { time: 200, open: 10.2, high: 11.2, low: 10, close: 10.9, volume: 85, session: "rth" },
    ];

    expect(hasVisibleSessionShading(data, undefined)).toBe(true);
    expect(
      hasVisibleSessionShading(data, {
        enabled: true,
        showPreMarket: false,
        showAfterHours: false,
        visualMode: "merged",
        colorScheme: "dimmed",
      } as any),
    ).toBe(false);
    expect(isPreSession("pre_open")).toBe(true);
    expect(isPostSession("closing")).toBe(true);
    expect(resolveSessionShadeColor("pre", EXTENDED_HOURS as any, COMPACT_SESSION_SHADE_PALETTE)).toBe(
      COMPACT_SESSION_SHADE_PALETTE.pre,
    );
    expect(buildSessionAreaMask(data, isPreSession)).toEqual([
      { time: 100, value: 10.2 },
      { time: 200 },
    ]);
  });
});
