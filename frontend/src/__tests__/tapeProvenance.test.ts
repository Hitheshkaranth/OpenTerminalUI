import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/base";
import { fetchTapeRecent } from "../api/chart";

afterEach(() => vi.restoreAllMocks());
describe("tape provenance transport", () => {
  it("preserves simulation flags from the backend", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ data: { trades: [], source: "synthetic_examples", simulated: true } });
    expect(await fetchTapeRecent("AAPL")).toEqual({ trades: [], source: "synthetic_examples", simulated: true });
  });
});
