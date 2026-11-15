import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WatchlistViewSettings } from "../components/watchlist/WatchlistViewSettings";
import { useWatchlistView, watchlistViewStorageKey } from "../store/watchlistViewStore";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("watchlist display preferences", () => {
  it("persists selected presets, custom columns and row spacing for an account", () => {
    const { result, unmount } = renderHook(() => useWatchlistView("account-a"));
    expect(result.current.view.columns).toEqual({ last: true, change: true, volume: true });
    act(() => result.current.updateView({ preset: "price" }));
    expect(result.current.view.columns.volume).toBe(false);
    act(() => result.current.updateView({ columns: { change: false }, density: "comfortable" }));
    expect(result.current.view.preset).toBe("custom");
    unmount();
    const restored = renderHook(() => useWatchlistView("account-a"));
    expect(restored.result.current.view).toEqual({ preset: "custom", columns: { last: true, change: false, volume: false }, density: "comfortable" });
    act(() => restored.result.current.resetView());
    expect(restored.result.current.view.preset).toBe("liquidity");
    expect(restored.result.current.view.density).toBe("compact");
  });

  it("does not carry preferences between accounts or save guest preferences", () => {
    const { result, rerender } = renderHook(({ account }: { account: string | null }) => useWatchlistView(account), { initialProps: { account: "account-a" as string | null } });
    act(() => result.current.updateView({ preset: "price" }));
    rerender({ account: "account-b" });
    expect(result.current.view.preset).toBe("liquidity");
    act(() => result.current.updateView({ density: "comfortable" }));
    rerender({ account: "account-a" });
    expect(result.current.view.preset).toBe("price");
    expect(result.current.view.density).toBe("compact");
    rerender({ account: null });
    act(() => result.current.updateView({ preset: "price" }));
    expect(localStorage.length).toBe(2);
    rerender({ account: "account-b" });
    expect(result.current.view.density).toBe("comfortable");
  });

  it.each(["{broken", "x".repeat(4097), JSON.stringify({ version: 1, view: { density: "compact", columns: { last: "false", change: true, volume: true } } })])("recovers safely from invalid stored settings", (raw) => {
    const key = watchlistViewStorageKey("account-a")!;
    localStorage.setItem(key, raw);
    const { result } = renderHook(() => useWatchlistView("account-a"));
    expect(result.current.view.preset).toBe("liquidity");
    expect(result.current.storageError).toMatch(/could not be read/);
    expect(localStorage.getItem(key)).toBe(raw);
    act(() => result.current.updateView({ preset: "price" }));
    expect(result.current.storageError).toBeNull();
    expect(JSON.parse(localStorage.getItem(key)!).view.columns.volume).toBe(false);
  });

  it("retains usable settings when persistence fails and reports the failure", () => {
    const { result } = renderHook(() => useWatchlistView("account-a"));
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
    act(() => result.current.updateView({ preset: "price" }));
    expect(result.current.view.columns.volume).toBe(false);
    expect(result.current.storageError).toMatch(/could not be saved/);
  });

  it("handles inaccessible storage and updates from another tab", () => {
    const get = vi.spyOn(window.localStorage, "getItem").mockImplementation(() => { throw Error("denied"); });
    const blocked = renderHook(() => useWatchlistView("blocked"));
    expect(blocked.result.current.storageError).toMatch(/unavailable/);
    blocked.unmount();
    get.mockRestore();
    const { result } = renderHook(() => useWatchlistView("account-a"));
    const key = watchlistViewStorageKey("account-a")!;
    localStorage.setItem(key, JSON.stringify({ version: 1, view: { columns: { last: true, change: true, volume: false }, density: "comfortable" } }));
    act(() => window.dispatchEvent(new StorageEvent("storage", { key })));
    expect(result.current.view.preset).toBe("price");
    expect(result.current.view.density).toBe("comfortable");
  });

  it("offers accessible controls and derives a custom preset after column changes", () => {
    function Harness() {
      const { view, updateView, storageError } = useWatchlistView("account-a");
      return <WatchlistViewSettings view={view} onChange={updateView} storageError={storageError} />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByText("Table settings"));
    fireEvent.change(screen.getByLabelText("Column preset"), { target: { value: "price" } });
    expect(screen.getByLabelText("Volume")).not.toBeChecked();
    fireEvent.click(screen.getByLabelText("Change %"));
    expect(screen.getByLabelText("Column preset")).toHaveValue("custom");
    fireEvent.change(screen.getByLabelText("Row spacing"), { target: { value: "comfortable" } });
    expect(screen.getByLabelText("Row spacing")).toHaveValue("comfortable");
  });
});
