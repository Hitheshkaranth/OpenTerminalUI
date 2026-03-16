import { describe, expect, it } from "vitest";
import {
  buildChartCsvContents,
  buildChartExportFilename,
  exportChartCsv,
} from "../shared/chart/ChartExport";

describe("exportChartCsv", () => {
  it("does not throw with valid data", () => {
    const data = [
      { t: 1700000000, o: 100, h: 105, l: 98, c: 103, v: 1000000 },
      { t: 1700086400, o: 103, h: 108, l: 101, c: 106, v: 1200000 },
    ];
    expect(() => exportChartCsv(data, "test.csv")).not.toThrow();
  });

  it("builds deterministic filenames and csv contents", () => {
    expect(buildChartExportFilename("MSFT", "1D", "png")).toBe("chart-msft-1d.png");
    expect(buildChartExportFilename("BANK NIFTY", "15m", "csv")).toBe("chart-bank-nifty-15m.csv");
    expect(
      buildChartCsvContents([
        { t: 1700000000, o: 100, h: 105, l: 98, c: 103, v: 1000000 },
      ]),
    ).toBe("Date,Open,High,Low,Close,Volume\n2023-11-14,100,105,98,103,1000000");
  });
});
