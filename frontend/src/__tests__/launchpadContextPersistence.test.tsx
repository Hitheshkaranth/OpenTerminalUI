import React from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LaunchpadProvider, useLaunchpad } from "../components/layout/LaunchpadContext";

describe("LaunchpadContext persistence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  it("loads from backend and persists updates to /api/user/layouts", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/user/layouts") && (!init || !init.method || init.method === "GET")) {
        return {
          ok: true,
          json: async () => ({
            items: [
              {
                id: "server-layout",
                name: "Server Layout",
                panels: [],
              },
            ],
          }),
        } as Response;
      }
      if (url.endsWith("/api/user/layouts") && init?.method === "PUT") {
        return { ok: true, json: async () => ({ ok: true }) } as Response;
      }
      return { ok: false, json: async () => ({}) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = ({ children }: { children: React.ReactNode }) => <LaunchpadProvider>{children}</LaunchpadProvider>;
    const { result } = renderHook(() => useLaunchpad(), { wrapper });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/user/layouts", expect.any(Object));

    await act(async () => {
      result.current.createLayout();
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    const putCalls = fetchMock.mock.calls.filter(
      ([url, init]) => String(url).endsWith("/api/user/layouts") && (init as RequestInit | undefined)?.method === "PUT",
    );
    expect(putCalls.length).toBeGreaterThan(0);
  });

  it("propagates symbols only within the active link group and tracks popped-out panels", async () => {
    localStorage.setItem(
      "ot:launchpad:layouts:v1",
      JSON.stringify([
        {
          id: "layout-1",
          name: "Test Layout",
          panels: [
            { id: "panel-red-a", type: "chart", title: "Red A", symbol: "AAPL", x: 0, y: 0, w: 4, h: 4, linkGroup: "red" },
            { id: "panel-red-b", type: "chart", title: "Red B", symbol: "MSFT", x: 4, y: 0, w: 4, h: 4, linkGroup: "red" },
            { id: "panel-blue", type: "chart", title: "Blue", symbol: "NVDA", x: 8, y: 0, w: 4, h: 4, linkGroup: "blue" },
            { id: "panel-none", type: "chart", title: "None", symbol: "QQQ", x: 0, y: 4, w: 4, h: 4, linkGroup: "none" },
          ],
        },
      ]),
    );
    localStorage.setItem("ot:launchpad:active:v1", "layout-1");

    const fetchMock = vi.fn(async () => ({ ok: false, json: async () => ({}) }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = ({ children }: { children: React.ReactNode }) => <LaunchpadProvider>{children}</LaunchpadProvider>;
    const { result } = renderHook(() => useLaunchpad(), { wrapper });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.emitSymbolChange("TSLA", "panel-red-a");
    });

    const symbolsAfterBroadcast = result.current.activeLayout?.panels.map((panel) => ({
      id: panel.id,
      symbol: panel.symbol,
    }));

    expect(symbolsAfterBroadcast).toEqual([
      { id: "panel-red-a", symbol: "TSLA" },
      { id: "panel-red-b", symbol: "TSLA" },
      { id: "panel-blue", symbol: "NVDA" },
      { id: "panel-none", symbol: "QQQ" },
    ]);

    act(() => {
      result.current.setPanelPoppedOut("panel-red-b", true);
    });

    expect(result.current.activeLayout?.panels.find((panel) => panel.id === "panel-red-b")?.poppedOut).toBe(true);
  });
});
