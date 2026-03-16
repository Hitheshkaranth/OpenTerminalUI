type RequestFrame = (callback: FrameRequestCallback) => number;
type CancelFrame = (id: number) => void;

function defaultRequestFrame(callback: FrameRequestCallback): number {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    return window.requestAnimationFrame(callback);
  }
  return globalThis.setTimeout(() => callback(Date.now()), 16) as unknown as number;
}

function defaultCancelFrame(id: number) {
  if (typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
    window.cancelAnimationFrame(id);
    return;
  }
  globalThis.clearTimeout(id);
}

export function createRafBatcher<T>(
  onFlush: (value: T) => void,
  requestFrame: RequestFrame = defaultRequestFrame,
  cancelFrame: CancelFrame = defaultCancelFrame,
) {
  let frameId: number | null = null;
  let hasPendingValue = false;
  let pendingValue: T;

  const flush = () => {
    if (!hasPendingValue) return;
    const next = pendingValue;
    hasPendingValue = false;
    onFlush(next);
  };

  return {
    schedule(value: T) {
      pendingValue = value;
      hasPendingValue = true;
      if (frameId !== null) return;
      frameId = requestFrame(() => {
        frameId = null;
        flush();
      });
    },
    flush() {
      if (frameId !== null) {
        cancelFrame(frameId);
        frameId = null;
      }
      flush();
    },
    cancel() {
      if (frameId !== null) {
        cancelFrame(frameId);
        frameId = null;
      }
      hasPendingValue = false;
    },
  };
}
