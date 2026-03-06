import { act, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CrosshairSyncProvider, useCrosshairSync } from "../contexts/CrosshairSyncContext";

type SyncCapture = (paneId: string, eventTsMs: number) => void;

function PublisherProbe({ onReady }: { onReady: (broadcast: ReturnType<typeof useCrosshairSync>["broadcast"]) => void }) {
  const { broadcast } = useCrosshairSync();
  useEffect(() => onReady(broadcast), [broadcast, onReady]);
  return null;
}

function PaneProbe({ paneId, onSync }: { paneId: string; onSync: SyncCapture }) {
  const { pos } = useCrosshairSync();
  useEffect(() => {
    if (typeof pos.time !== "number") return;
    if (pos.groupId !== "perf-group") return;
    onSync(paneId, pos.time);
  }, [onSync, paneId, pos.groupId, pos.time]);
  return null;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

describe("CrosshairSyncContext perf budgets", () => {
  let rafQueue: FrameRequestCallback[] = [];
  let rafId = 0;

  beforeEach(() => {
    rafQueue = [];
    rafId = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      rafId += 1;
      return rafId;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function runBudgetScenario(paneCount: number) {
    const latenciesByPane = new Map<string, number[]>();
    let broadcastRef: ReturnType<typeof useCrosshairSync>["broadcast"] | null = null;
    let frameNowMs = 0;

    render(
      <CrosshairSyncProvider>
        <PublisherProbe onReady={(broadcast) => { broadcastRef = broadcast; }} />
        {Array.from({ length: paneCount }, (_, idx) => {
          const paneId = `pane-${idx + 1}`;
          return (
            <PaneProbe
              key={paneId}
              paneId={paneId}
              onSync={(id, eventTsMs) => {
                const bucket = latenciesByPane.get(id) ?? [];
                bucket.push(frameNowMs - eventTsMs);
                latenciesByPane.set(id, bucket);
              }}
            />
          );
        })}
      </CrosshairSyncProvider>,
    );

    expect(broadcastRef).toBeTruthy();

    const totalFrames = Math.floor(5000 / 16);
    for (let frame = 1; frame <= totalFrames; frame += 1) {
      const frameMs = frame * 16;
      act(() => {
        broadcastRef?.("leader", frameMs - 14, "perf-group");
        broadcastRef?.("leader", frameMs - 4, "perf-group");
      });
      act(() => {
        frameNowMs = frameMs;
        const cb = rafQueue.shift();
        cb?.(frameMs);
      });
    }

    const allLatencies = Array.from(latenciesByPane.values()).flat();
    return {
      paneCount,
      totalFrames,
      totalSamples: allLatencies.length,
      medianMs: percentile(allLatencies, 50),
      p95Ms: percentile(allLatencies, 95),
      latenciesByPane,
    };
  }

  it.each([2, 4, 8])("stays within 16ms p50 and 24ms p95 for %i panes", (paneCount) => {
    const result = runBudgetScenario(paneCount);

    expect(result.medianMs).toBeLessThanOrEqual(16);
    expect(result.p95Ms).toBeLessThanOrEqual(24);

    for (const paneSamples of result.latenciesByPane.values()) {
      expect(paneSamples.length).toBe(result.totalFrames);
    }
  });
});
