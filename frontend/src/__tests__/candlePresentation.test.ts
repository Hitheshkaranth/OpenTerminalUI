import { describe, expect, it } from "vitest";

import {
  buildEnhancedCandle,
  buildEnhancedVolumeBar,
  shouldDefaultExtendedHoursOn,
} from "../shared/chart/candlePresentation";

const palette = { up: "#26a69a", down: "#ef5350" };

describe("candlePresentation", () => {
  it("renders hollow body by open/close and colors by close vs previous close", () => {
    const upBodyUpDir = buildEnhancedCandle(
      { time: 1, open: 100, high: 111, low: 99, close: 110, volume: 10 },
      95,
      palette,
    );
    const downBodyUpDir = buildEnhancedCandle(
      { time: 2, open: 110, high: 111, low: 100, close: 105, volume: 10 },
      100,
      palette,
    );
    const upBodyDownDir = buildEnhancedCandle(
      { time: 3, open: 90, high: 96, low: 89, close: 95, volume: 10 },
      100,
      palette,
    );
    const downBodyDownDir = buildEnhancedCandle(
      { time: 4, open: 110, high: 111, low: 89, close: 90, volume: 10 },
      100,
      palette,
    );

    expect(upBodyUpDir.color).toBe("rgba(0, 0, 0, 0)");
    expect(upBodyUpDir.borderColor).toBe(palette.up);
    expect(downBodyUpDir.color).toBe(palette.up);
    expect(upBodyDownDir.color).toBe("rgba(0, 0, 0, 0)");
    expect(upBodyDownDir.wickColor).toBe(palette.down);
    expect(downBodyDownDir.color).toBe(palette.down);
  });

  it("dims extended-hours candles and volume bars to 50% opacity", () => {
    const candle = buildEnhancedCandle(
      { time: 1, open: 100, high: 105, low: 99, close: 98, volume: 20, isExtended: true, session: "post" },
      100,
      palette,
      { enabled: true, colorScheme: "dimmed" },
    );
    const volume = buildEnhancedVolumeBar(
      { time: 1, open: 100, high: 105, low: 99, close: 98, volume: 20, isExtended: true, session: "post" },
      100,
      palette,
      { enabled: true, colorScheme: "dimmed" },
    );
    expect(candle.color).toBe("rgba(239, 83, 80, 0.5)");
    expect(candle.wickColor).toBe("rgba(239, 83, 80, 0.5)");
    expect(volume.color).toBe("rgba(239, 83, 80, 0.5)");
  });

  it("uses timeframe defaults that enable extended-hours for intraday only", () => {
    expect(shouldDefaultExtendedHoursOn("1m")).toBe(true);
    expect(shouldDefaultExtendedHoursOn("15m")).toBe(true);
    expect(shouldDefaultExtendedHoursOn("1h")).toBe(true);
    expect(shouldDefaultExtendedHoursOn("1D")).toBe(false);
    expect(shouldDefaultExtendedHoursOn("1W")).toBe(false);
    expect(shouldDefaultExtendedHoursOn("1M")).toBe(false);
  });

  it("keeps realtime incremental styling consistent with full-sequence styling", () => {
    const bars = [
      { time: 1, open: 100, high: 101, low: 99, close: 100.5, volume: 10 },
      { time: 2, open: 100.5, high: 102, low: 100, close: 101.5, volume: 12 },
      { time: 3, open: 101.5, high: 103, low: 101, close: 100.25, volume: 15 },
    ];
    const full = bars.map((bar, idx) =>
      buildEnhancedCandle(bar, idx > 0 ? bars[idx - 1].close : null, palette, { enabled: true, colorScheme: "dimmed" }),
    );
    const incremental = buildEnhancedCandle(bars[2], bars[1].close, palette, { enabled: true, colorScheme: "dimmed" });
    const fullVolume = bars.map((bar, idx) =>
      buildEnhancedVolumeBar(bar, idx > 0 ? bars[idx - 1].close : null, palette, { enabled: true, colorScheme: "dimmed" }),
    );
    const incrementalVolume = buildEnhancedVolumeBar(bars[2], bars[1].close, palette, { enabled: true, colorScheme: "dimmed" });

    expect(incremental).toEqual(full[2]);
    expect(incrementalVolume).toEqual(fullVolume[2]);
  });
});
