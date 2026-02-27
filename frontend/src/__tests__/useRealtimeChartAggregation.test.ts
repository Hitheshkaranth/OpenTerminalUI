import { describe, expect, it } from "vitest";
import type { Bar } from "oakscriptjs";

import { aggregateBarsFrom1m } from "../shared/chart/useRealtimeChart";

function bar(time: number, o: number, h: number, l: number, c: number, v: number, s?: string, ext?: boolean): Bar {
  const out: Bar = { time, open: o, high: h, low: l, close: c, volume: v };
  if (s) (out as any).s = s;
  if (typeof ext === "boolean") (out as any).ext = ext;
  return out;
}

describe("aggregateBarsFrom1m", () => {
  it("aggregates streamed 1m bars into 2m bars with OHLCV merge", () => {
    const start = 1_700_000_040; // aligned to 2m boundary
    const oneMinBars: Bar[] = [
      bar(start + 0, 100, 101, 99, 100.5, 10, "regular", false),
      bar(start + 60, 100.5, 102, 100, 101.5, 20, "regular", false),
      bar(start + 120, 101.5, 103, 101, 102.25, 15, "regular", false),
      bar(start + 180, 102.25, 104, 102, 103.75, 12, "regular", false),
    ];

    const out = aggregateBarsFrom1m(oneMinBars, "2m");

    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      time: start, // 2m bucket boundary
      open: 100,
      high: 102,
      low: 99,
      close: 101.5,
      volume: 30,
    });
    expect(out[1]).toMatchObject({
      open: 101.5,
      high: 104,
      low: 101,
      close: 103.75,
      volume: 27,
    });
  });

  it("aggregates streamed 1m bars into 30m bars and preserves session/ext metadata", () => {
    const start = 1700000000; // arbitrary epoch second
    const bars: Bar[] = [];
    for (let i = 0; i < 3; i += 1) {
      bars.push(bar(start + i * 60, 200 + i, 201 + i, 199 + i, 200.5 + i, 100 + i, "pre", true));
    }
    for (let i = 30; i < 33; i += 1) {
      bars.push(bar(start + i * 60, 230 + i, 231 + i, 229 + i, 230.25 + i, 80 + i, "regular", false));
    }

    const out = aggregateBarsFrom1m(bars, "30m");

    expect(out).toHaveLength(2);
    expect((out[0] as any).s).toBe("pre");
    expect((out[0] as any).ext).toBe(true);
    expect(out[0].volume).toBe((100 + 101 + 102));
    expect((out[1] as any).s).toBe("regular");
    expect((out[1] as any).ext).toBeUndefined();
    expect(out[1].volume).toBe((110 + 111 + 112));
    expect(out[1].close).toBeCloseTo(262.25, 6);
  });
});
