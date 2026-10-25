import { afterEach, expect, it, vi } from "vitest";
import { exportDossier } from "../api/researchDossiers";
import { api } from "../api/base";
import { downloadBlob } from "../lib/downloadJson";

vi.mock("../api/base", () => ({ api: { get: vi.fn() } }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("requests the unparsed export so Python float formatting and hashes survive downloading", async () => {
  const payload = new Blob(['{"threshold":5.0,"value":1e-07,"sha256":"server-digest"}'], { type: "application/json" });
  vi.mocked(api.get).mockResolvedValue({ data: payload });
  expect(await exportDossier("d/1")).toBe(payload);
  expect(api.get).toHaveBeenCalledWith("/research/dossiers/d%2F1/export", { responseType: "blob" });
});

it("downloads the original blob without JSON parse/stringify", () => {
  vi.useFakeTimers();
  const createObjectURL = vi.fn(() => "blob:research-export");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const blob = new Blob(['{"threshold":5.0}']);
  downloadBlob(blob, "research.json");
  expect(createObjectURL).toHaveBeenCalledWith(blob);
  expect(click).toHaveBeenCalledOnce();
  vi.runAllTimers();
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:research-export");
});
