/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { useStockHistory } from "../hooks/useStocks";

const history = vi.hoisted(() => vi.fn());
vi.mock("../api/client", () => ({ getHistory: (...args: unknown[]) => history(...args), fetchCryptoCandles: vi.fn() }));
vi.mock("../store/settingsStore", () => ({ useSettingsStore: (select: (s: { selectedMarket: string }) => unknown) => select({ selectedMarket: "NSE" }) }));

beforeEach(() => history.mockReset().mockResolvedValue({ data: [] }));
function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

it("keeps a bare NSE symbol on a daily 1M interval", async () => {
  const hook = renderHook(() => useStockHistory("RELIANCE", "1mo", "1d", false, "NSE"), { wrapper });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(history).toHaveBeenCalledWith("RELIANCE", "NSE", "1d", "1mo", undefined, undefined, false);
});

it("uses the explicit US listing while the desk is set to NSE", async () => {
  const hook = renderHook(() => useStockHistory("AAPL", "1mo", "1d", false, "NASDAQ"), { wrapper });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(history).toHaveBeenCalledWith("AAPL", "NASDAQ", "5m", "1mo", undefined, undefined, false);
});
