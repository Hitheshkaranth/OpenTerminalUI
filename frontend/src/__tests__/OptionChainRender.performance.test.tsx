import { performance } from "node:perf_hooks";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OptionChainTable } from "../fno/components/OptionChainTable";
import type { StrikeData } from "../fno/types/fno";

const DEFAULT_RENDER_BUDGET_MS = 5000;

function getRenderBudgetMs(): number {
  const raw = Number(process.env.OPTION_CHAIN_RENDER_BUDGET_MS ?? DEFAULT_RENDER_BUDGET_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RENDER_BUDGET_MS;
}

function makeRows(count: number): StrikeData[] {
  const baseStrike = 22000;
  const out: StrikeData[] = [];
  for (let i = 0; i < count; i += 1) {
    const strike = baseStrike + i * 50;
    out.push({
      strike_price: strike,
      ce: {
        oi: 1_000_000 + i * 1000,
        oi_change: (i % 2 === 0 ? 1 : -1) * (1000 + i * 3),
        volume: 25_000 + i * 20,
        iv: 10 + (i % 30) * 0.2,
        ltp: 200 - i * 0.5,
        bid: 199 - i * 0.5,
        ask: 201 - i * 0.5,
        greeks: { delta: 0.5, gamma: 0.001, theta: -12, vega: 8, rho: 1 },
      },
      pe: {
        oi: 950_000 + i * 1200,
        oi_change: (i % 2 === 0 ? -1 : 1) * (900 + i * 2),
        volume: 24_000 + i * 18,
        iv: 11 + (i % 25) * 0.22,
        ltp: 180 + i * 0.4,
        bid: 179 + i * 0.4,
        ask: 181 + i * 0.4,
        greeks: { delta: -0.5, gamma: 0.001, theta: -11, vega: 8.5, rho: -1 },
      },
    });
  }
  return out;
}

describe("OptionChainTable render performance", () => {
  it("renders 250 strikes within an acceptable time budget", () => {
    const rows = makeRows(250);
    const client = new QueryClient();
    const start = performance.now();
    render(
      <QueryClientProvider client={client}>
        <OptionChainTable rows={rows} atmStrike={22500} />
      </QueryClientProvider>
    );
    const elapsedMs = performance.now() - start;
    expect(elapsedMs).toBeLessThan(getRenderBudgetMs());
  });
});
