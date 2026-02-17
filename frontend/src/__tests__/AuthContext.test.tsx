import { renderHook, act } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { AuthProvider, useAuth } from "../contexts/AuthContext";

vi.mock("axios", async () => {
  const actual = await vi.importActual<typeof import("axios")>("axios");
  const post = vi.fn(async (url: string, body: any) => {
    if (url === "/auth/register") return { data: { id: "u1" } };
    if (url === "/auth/login") {
      return {
        data: {
          access_token:
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSIsImVtYWlsIjoidXNlckBleGFtcGxlLmNvbSIsInJvbGUiOiJ2aWV3ZXIiLCJleHAiOjQ3MDAwMDAwMDB9.sig",
          refresh_token: "refresh-token-1",
          token_type: "bearer",
        },
      };
    }
    if (url === "/auth/refresh") {
      return {
        data: {
          access_token:
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSIsImVtYWlsIjoidXNlckBleGFtcGxlLmNvbSIsInJvbGUiOiJ2aWV3ZXIiLCJleHAiOjQ3MDAwMDAwMDB9.sig",
          refresh_token: "refresh-token-2",
          token_type: "bearer",
        },
      };
    }
    return { data: {} };
  });
  return {
    ...actual,
    default: {
      create: () => ({ post }),
    },
  };
});

describe("AuthContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("transitions to authenticated on login and clears on logout", async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => <AuthProvider>{children}</AuthProvider>;
    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current.isAuthenticated).toBe(false);

    await act(async () => {
      await result.current.login("user@example.com", "password123");
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user?.email).toBe("user@example.com");

    act(() => {
      result.current.logout();
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it("can register then login", async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => <AuthProvider>{children}</AuthProvider>;
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.register("new@example.com", "password123", "viewer");
      await result.current.login("new@example.com", "password123");
    });

    expect(result.current.isAuthenticated).toBe(true);
  });
});
