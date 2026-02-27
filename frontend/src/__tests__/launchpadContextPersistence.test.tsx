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
});
