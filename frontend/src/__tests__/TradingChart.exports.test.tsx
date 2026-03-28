import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildChartCsvContents,
  buildChartExportFilename,
  exportChartCsv,
  exportChartPng,
} from "../shared/chart/ChartExport";

const clickMock = vi.fn();
const createObjectURLMock = vi.fn(() => "blob:chart-export");
const revokeObjectURLMock = vi.fn();
const originalCreateElement = document.createElement.bind(document);
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

describe("TradingChart export helpers", () => {
  beforeEach(() => {
    clickMock.mockReset();
    createObjectURLMock.mockClear();
    revokeObjectURLMock.mockClear();

    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: createObjectURLMock,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: revokeObjectURLMock,
    });

    vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName === "a") {
        element.click = clickMock as unknown as typeof element.click;
      }
      return element;
    }) as typeof document.createElement);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds deterministic chart export filenames", () => {
    expect(buildChartExportFilename("AAPL", "1D", "png")).toBe("chart-aapl-1d.png");
    expect(buildChartExportFilename(" BRK.B ", "4H", "csv")).toBe("chart-brk-b-4h.csv");
    expect(buildChartExportFilename("", undefined, "png")).toBe("chart-chart-1d.png");
  });

  it("serializes OHLCV rows into csv content", () => {
    expect(
      buildChartCsvContents([
        { t: 1_709_164_800, o: 100, h: 105, l: 99, c: 102, v: 1000 },
        { t: 1_709_251_200, o: 102, h: 106, l: 101, c: 105, v: 1400 },
      ]),
    ).toBe([
      "Date,Open,High,Low,Close,Volume",
      "2024-02-29,100,105,99,102,1000",
      "2024-03-01,102,106,101,105,1400",
    ].join("\n"));
  });

  it("exports png screenshots through an anchor download", () => {
    exportChartPng(
      {
        takeScreenshot: () => ({
          toDataURL: () => "data:image/png;base64,abc",
        }),
      } as never,
      "chart-aapl-1d.png",
    );

    expect(clickMock).toHaveBeenCalledTimes(1);
  });

  it("exports csv downloads through a blob url", async () => {
    exportChartCsv(
      [
        { t: 1_709_164_800, o: 100, h: 105, l: 99, c: 102, v: 1000 },
        { t: 1_709_251_200, o: 102, h: 106, l: 101, c: 105, v: 1400 },
      ],
      "chart-aapl-1d.csv",
    );

    expect(clickMock).toHaveBeenCalledTimes(1);
    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:chart-export");

    const blob = createObjectURLMock.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
  });
});

afterAll(() => {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: originalCreateObjectURL,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: originalRevokeObjectURL,
  });
});
