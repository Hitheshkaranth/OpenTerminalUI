import "@testing-library/jest-dom/vitest";

const MAX_TIMER_MS = 2_147_483_647;

function clampDelay(value: number | undefined): number {
  if (!Number.isFinite(Number(value))) return 0;
  const next = Math.max(0, Number(value));
  return Math.min(MAX_TIMER_MS, next);
}

const nativeSetTimeout = globalThis.setTimeout.bind(globalThis);
const nativeSetInterval = globalThis.setInterval.bind(globalThis);

globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
  nativeSetTimeout(handler, clampDelay(timeout), ...args)) as typeof globalThis.setTimeout;

globalThis.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
  nativeSetInterval(handler, clampDelay(timeout), ...args)) as typeof globalThis.setInterval;
