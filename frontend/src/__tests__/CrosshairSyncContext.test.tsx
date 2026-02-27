import { useEffect } from "react";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { CrosshairSyncProvider, useCrosshairSync } from "../contexts/CrosshairSyncContext";

function Probe({ onReady }: { onReady: (api: ReturnType<typeof useCrosshairSync>) => void }) {
  const api = useCrosshairSync();
  useEffect(() => onReady(api), [api, onReady]);
  return (
    <div data-testid="state">
      {String(api.pos.time)}|{String(api.pos.sourceSlotId)}|{String(api.pos.groupId)}|{String(api.syncEnabled)}
    </div>
  );
}

describe("CrosshairSyncContext", () => {
  let rafQueue: FrameRequestCallback[] = [];
  let rafId = 0;
  let cancelSpy: ReturnType<typeof vi.spyOn>;
  let rafSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    rafQueue = [];
    rafId = 0;
    rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      rafId += 1;
      return rafId;
    });
    cancelSpy = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  });

  afterEach(() => {
    rafSpy.mockRestore();
    cancelSpy.mockRestore();
  });

  it("coalesces broadcasts to one rAF update and preserves latest payload", () => {
    let apiRef: ReturnType<typeof useCrosshairSync> | null = null;
    render(
      <CrosshairSyncProvider>
        <Probe onReady={(api) => { apiRef = api; }} />
      </CrosshairSyncProvider>,
    );

    expect(screen.getByTestId("state").textContent).toContain("null|null|null|true");

    act(() => {
      apiRef?.broadcast("slot-a", 100, "g1");
      apiRef?.broadcast("slot-a", 101, "g1");
      apiRef?.broadcast("slot-b", 102, "g2");
    });

    expect(rafQueue.length).toBe(1);
    expect(cancelSpy).not.toHaveBeenCalled();

    act(() => {
      const cb = rafQueue.shift();
      cb?.(performance.now());
    });

    expect(screen.getByTestId("state").textContent).toContain("102|slot-b|g2|true");
  });

  it("tracks externally controlled enabled flag", () => {
    render(
      <CrosshairSyncProvider enabled={false}>
        <Probe onReady={() => undefined} />
      </CrosshairSyncProvider>,
    );

    expect(screen.getByTestId("state").textContent).toContain("false");
  });
});
