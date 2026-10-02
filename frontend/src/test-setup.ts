import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Provide a robust localStorage/sessionStorage mock for jsdom environments
// where the native storage may not expose standard methods.
function createStorageMock(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem(key: string) { return key in store ? store[key] : null; },
    setItem(key: string, value: string) { store[key] = String(value); },
    removeItem(key: string) { delete store[key]; },
    clear() { store = {}; },
    key(index: number) { return Object.keys(store)[index] ?? null; },
    get length() { return Object.keys(store).length; },
  };
}

Object.defineProperty(globalThis, "localStorage", { value: createStorageMock(), writable: true });
Object.defineProperty(globalThis, "sessionStorage", { value: createStorageMock(), writable: true });

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

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

// Libraries.dev effects draw on <canvas> and watch IntersectionObserver, which jsdom lacks; tests
// assert behaviour, not pixels, so render accessible stand-ins with the same labels.
vi.mock("thinking-orbs", async () => {
  const React = await import("react");
  return {
    ThinkingOrb: (props: { "aria-label"?: string; state?: string }) =>
      React.createElement("span", { role: "img", "aria-label": props["aria-label"] ?? "Thinking", "data-orb": props.state }),
  };
});
vi.mock("border-beam", async () => {
  const React = await import("react");
  return {
    BorderBeam: (props: { children?: unknown; className?: string; active?: boolean }) =>
      React.createElement("div", { className: props.className, "data-beam": props.active ? "on" : "off" }, props.children as never),
  };
});
vi.mock("bot-avatars", async () => {
  const React = await import("react");
  return {
    BotAvatar: (props: { "aria-label"?: string; state?: string }) =>
      React.createElement("span", { role: "img", "aria-label": props["aria-label"] ?? "Agent", "data-bot": props.state }),
  };
});
