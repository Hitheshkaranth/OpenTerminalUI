import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchChartData } from "../services/chartDataService";

describe("fetchChartData", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls unified chart endpoint with normalized flag", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch" as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        symbol: "AAPL",
        interval: "1m",
        count: 1,
        data: [{ t: 1, o: 2, h: 3, l: 1, c: 2, v: 10 }],
      }),
    } as Response);

    const result = await fetchChartData("AAPL", { market: "NASDAQ", interval: "1m", period: "1d" });

    expect(result.symbol).toBe("AAPL");
    expect(result.count).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/chart/AAPL?");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("normalized=true");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("market=NASDAQ");
  });
});
