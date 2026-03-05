import { describe, expect, it } from "vitest";

import { buildComparisonPoints } from "../shared/chart/comparison";

describe("comparison series transform", () => {
  const data = [
    { t: 3, c: 130, o: 130, h: 130, l: 130, v: 0 },
    { t: 1, c: 100, o: 100, h: 100, l: 100, v: 0 },
    { t: 2, c: 110, o: 110, h: 110, l: 110, v: 0 },
  ];

  it("builds normalized points in percent mode", () => {
    const out = buildComparisonPoints(data as any, "normalized");
    expect(out.map((p) => Number(p.value.toFixed(2)))).toEqual([0, 10, 30]);
  });

  it("builds raw close points in price mode", () => {
    const out = buildComparisonPoints(data as any, "price");
    expect(out.map((p) => p.value)).toEqual([100, 110, 130]);
  });
});
