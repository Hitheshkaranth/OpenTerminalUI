import { act, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChartSyncProvider, useChartSync } from "../shared/chart/ChartSyncContext";

function PublisherProbe({ onReady }: { onReady: (publish: ReturnType<typeof useChartSync>["publish"]) => void }) {
  const { publish } = useChartSync();
  useEffect(() => onReady(publish), [publish, onReady]);
  return null;
}

function EventProbe({ onEvent }: { onEvent: (timestamp: number) => void }) {
  const { event } = useChartSync();
  useEffect(() => {
    if (!event) return;
    onEvent(event.timestamp);
  }, [event, onEvent]);
  return null;
}

describe("ChartSyncContext", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("batches publish calls to the latest event per frame", () => {
    const rafQueue: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      rafQueue.push(callback);
      return rafQueue.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

    let publishRef: ReturnType<typeof useChartSync>["publish"] | null = null;
    const seen: number[] = [];

    render(
      <ChartSyncProvider>
        <PublisherProbe onReady={(publish) => { publishRef = publish; }} />
        <EventProbe onEvent={(timestamp) => seen.push(timestamp)} />
      </ChartSyncProvider>,
    );

    expect(publishRef).toBeTruthy();

    act(() => {
      publishRef?.({ sourceId: "pane-a", timestamp: 100, price: 1 });
      publishRef?.({ sourceId: "pane-a", timestamp: 120, price: 1.1 });
    });

    expect(seen).toEqual([]);

    act(() => {
      rafQueue.shift()?.(16);
    });

    expect(seen).toEqual([120]);
  });
});
