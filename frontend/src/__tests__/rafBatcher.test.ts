import { describe, expect, it, vi } from "vitest";

import { createRafBatcher } from "../shared/chart/rafBatcher";

describe("createRafBatcher", () => {
  it("flushes only the latest queued value in a frame", () => {
    const queued: FrameRequestCallback[] = [];
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      queued.push(callback);
      return queued.length;
    });
    const cancelFrame = vi.fn();
    const onFlush = vi.fn();
    const batcher = createRafBatcher(onFlush, requestFrame, cancelFrame);

    batcher.schedule("first");
    batcher.schedule("second");

    expect(requestFrame).toHaveBeenCalledTimes(1);
    expect(onFlush).not.toHaveBeenCalled();

    queued[0]?.(16);

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith("second");
    expect(cancelFrame).not.toHaveBeenCalled();
  });

  it("supports manual flush and cancel", () => {
    const queued: FrameRequestCallback[] = [];
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      queued.push(callback);
      return queued.length;
    });
    const cancelFrame = vi.fn();
    const onFlush = vi.fn();
    const batcher = createRafBatcher(onFlush, requestFrame, cancelFrame);

    batcher.schedule({ id: 1 });
    batcher.flush();
    expect(cancelFrame).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith({ id: 1 });

    batcher.schedule({ id: 2 });
    batcher.cancel();
    expect(cancelFrame).toHaveBeenCalledTimes(2);
    queued[1]?.(32);
    expect(onFlush).toHaveBeenCalledTimes(1);
  });
});
