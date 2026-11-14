import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/base";
import { fetchDataQualityHealth, parseProviderHealth } from "../api/dataQuality";
vi.mock("../api/base", () => ({ api: { get: vi.fn() } }));

function sources(providers: unknown, monitoring: unknown) {
  vi.mocked(api.get).mockImplementation((path) => {
    const value = path === "/providers/status" ? providers : monitoring;
    return value instanceof Error ? Promise.reject(value) : Promise.resolve({ data: value });
  });
}
const row = (extra: Record<string, unknown> = {}) => ({ symbol: "AAPL", health_status: "healthy", session_state: "open", bars_expected_today: 15, bars_received_today: 12, ...extra });
describe("data health sources", () => {
  beforeEach(() => vi.clearAllMocks());
  it("uses actual monitoring sources and excludes unknown calendar expectations", async () => {
    sources({ providers: [{ id: "free", status: "ok" }] }, { timestamp: "2026-11-13T15:00:00Z", symbols: [row(), row({ symbol: "XYZ", health_status: "unknown", session_state: "unknown", bars_expected_today: null, bars_received_today: 900 })] });
    const result = await fetchDataQualityHealth();
    expect(result.metrics?.missing_bars_session).toBe(3);
    expect(result.coverage).toEqual({ monitored: 2, known_sessions: 1, closed: 0, unknown: 1 });
    expect(result.status).toBe("unknown");
    expect(vi.mocked(api.get).mock.calls.map(([path]) => path)).toEqual(["/providers/status", "/ops/data-quality"]);
  });
  it("does not certify an empty feed monitor as healthy or zero gaps", async () => {
    sources({ providers: [{ id: "free", status: "ok" }] }, { symbols: [] });
    const result = await fetchDataQualityHealth();
    expect(result.status).toBe("no_data");
    expect(result.metrics?.missing_bars_session).toBeUndefined();
  });
  it("reports partial coverage when monitoring fails and does not invent metrics", async () => {
    sources({ providers: [{ name: "Free feed", status: "ok" }] }, new Error("not available"));
    const result = await fetchDataQualityHealth();
    expect(result.status).toBe("partial");
    expect(result.unavailable_sources).toEqual(["Feed monitoring"]);
    expect(result.metrics).toBeUndefined();
    expect(result.issues?.[0].message).toContain("Missing measurements are not treated as zero");
  });
  it("keeps a healthy response when provider listing fails but marks it partial", async () => {
    sources(new Error("permission denied"), { symbols: [row()] });
    const result = await fetchDataQualityHealth();
    expect(result.symbols).toHaveLength(1);
    expect(result.status).toBe("partial");
    expect(result.provider_health).toBeUndefined();
  });
  it("rejects unavailable or malformed responses instead of showing zeroes", async () => {
    sources("<html>SPA fallback</html>", new Error("offline"));
    await expect(fetchDataQualityHealth()).rejects.toThrow("Provider and feed monitoring are unavailable");
  });
  it("distinguishes closed sessions from stale feeds", async () => {
    sources({ providers: [] }, { symbols: [row({ health_status: "closed", session_state: "closed" })] });
    expect((await fetchDataQualityHealth()).status).toBe("closed");
    sources({ providers: [] }, { symbols: [row({ health_status: "stale" })] });
    expect((await fetchDataQualityHealth()).status).toBe("degraded");
  });
  it("preserves unknown provider status without labelling it offline", () => {
    expect(parseProviderHealth({ custom: { status: "unrecognized" } })[0].status).toBe("unknown");
    expect(parseProviderHealth({ missing: { status: "unconfigured" } })[0].status).toBe("unconfigured");
  });
  it("treats self-reported provider errors as partial and unrecognized feed states as unknown", async () => {
    sources({ error: "provider registry failed", providers: [{ status: "ok" }] }, { symbols: [row()] });
    expect((await fetchDataQualityHealth()).status).toBe("partial");
    sources({ providers: [] }, { symbols: [row({ health_status: "new_future_state" })] });
    expect((await fetchDataQualityHealth()).status).toBe("unknown");
  });
});
