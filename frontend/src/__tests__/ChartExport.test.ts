import { describe, expect, it } from "vitest";
import { exportChartCsv } from "../shared/chart/ChartExport";

describe("exportChartCsv", () => {
  it("does not throw with valid data", () => {
    const data = [
      { t: 1700000000, o: 100, h: 105, l: 98, c: 103, v: 1000000 },
      { t: 1700086400, o: 103, h: 108, l: 101, c: 106, v: 1200000 },
    ];
    expect(() => exportChartCsv(data, "test.csv")).not.toThrow();
  });
});
