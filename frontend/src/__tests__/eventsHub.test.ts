import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../api/base";
import { daysUntil, fetchUpcomingEvents } from "../api/eventsHub";

vi.mock("../api/base", () => ({
  api: {
    get: vi.fn(),
  },
  extractApiErrorMessage: vi.fn((_: unknown, fallback: string) => fallback),
}));

describe("daysUntil", () => {
  const now = new Date("2026-09-21T12:00:00Z");

  it("returns 0 for today", () => {
    expect(daysUntil("2026-09-21", now)).toBe(0);
  });

  it("returns 1 for tomorrow", () => {
    expect(daysUntil("2026-09-22", now)).toBe(1);
  });

  it("returns -1 for yesterday", () => {
    expect(daysUntil("2026-09-20", now)).toBe(-1);
  });

  it("returns 10 for +10 days", () => {
    expect(daysUntil("2026-10-01", now)).toBe(10);
  });

  it("returns -5 for 5 days ago", () => {
    expect(daysUntil("2026-09-16", now)).toBe(-5);
  });
});

describe("fetchUpcomingEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds querystring with symbols only", async () => {
    (api.get as vi.Mock).mockResolvedValue({ data: { as_of: "2026-09-21T00:00:00Z", days: 30, symbols: [], items: [], errors: [] } });
    await fetchUpcomingEvents({ symbols: ["RELIANCE", "AAPL"], days: 30 });
    const calledWith = (api.get as vi.Mock).mock.calls?.[0]?.[0] as string;
    const decoded = decodeURIComponent(calledWith);
    expect(decoded).toMatch(/^\/events-hub\/upcoming\?symbols=RELIANCE,AAPL&days=30$/);
  });

  it("builds querystring with days and types", async () => {
    (api.get as vi.Mock).mockResolvedValue({ data: { as_of: "2026-09-21T00:00:00Z", days: 45, symbols: [], items: [], errors: [] } });
    await fetchUpcomingEvents({ symbols: ["TCS"], days: 45, types: ["earnings", "dividend"] });
    const calledWith = (api.get as vi.Mock).mock.calls?.[0]?.[0] as string;
    const decoded = decodeURIComponent(calledWith);
    expect(decoded).toMatch(/symbols=TCS/);
    expect(decoded).toMatch(/days=45/);
    expect(decoded).toMatch(/types=earnings,dividend/);
  });

  it("builds querystring without symbols when only days/types provided", async () => {
    (api.get as vi.Mock).mockResolvedValue({ data: { as_of: "2026-09-21T00:00:00Z", days: 30, symbols: [], items: [], errors: [] } });
    await fetchUpcomingEvents({ days: 30, types: ["macro"] });
    const calledWith = (api.get as vi.Mock).mock.calls?.[0]?.[0] as string;
    expect(calledWith).toMatch(/days=30/);
    expect(calledWith).toMatch(/types=macro/);
    expect(calledWith).not.toMatch(/symbols=/);
  });

  it("returns the API response directly", async () => {
    const responseData = {
      as_of: "2026-09-21T00:00:00Z",
      days: 30,
      symbols: ["RELIANCE"],
      items: [{ id: "e1", type: "earnings", symbol: "RELIANCE", title: "Q2", date: "2026-10-01", time: "amc", impact: "high", source: "earnings_service", detail: {} }],
      errors: [],
    };
    (api.get as vi.Mock).mockResolvedValue({ data: responseData });
    const result = await fetchUpcomingEvents({ symbols: ["RELIANCE"] });
    expect(result).toEqual(responseData);
  });
});
describe("daysUntil is timezone-safe", () => {
  it("treats YYYY-MM-DD as a local calendar date (no UTC-midnight off-by-one)", () => {
    // 21 Sep 2026 23:30 local, any timezone: an event dated 2026-09-21 is Today.
    const now = new Date(2026, 8, 21, 23, 30);
    expect(daysUntil("2026-09-21", now)).toBe(0);
    expect(daysUntil("2026-09-22", now)).toBe(1);
    const early = new Date(2026, 8, 21, 0, 10);
    expect(daysUntil("2026-09-21", early)).toBe(0);
  });
});
