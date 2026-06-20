import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ArtifactView } from "../agent/components/artifacts";
import { Markdown } from "../agent/components/Markdown";

describe("agent UI polish", () => {
  it("renders snapshot card with logo monogram, price and metrics", () => {
    const data = {
      ticker: "RELIANCE", company_name: "RELIANCE INDUSTRIES LTD", current_price: 1309.5,
      change_pct: -1.4, market_cap: 17720772919296, pe: 21.93, roe_pct: 9.14,
      rev_growth_pct: 12.5, eps_growth_pct: -12.6, sector: "Energy", exchange: "NSE",
      currency: "INR", flag_emoji: "🇮🇳",
    };
    render(<ArtifactView artifact={{ id: "a1", kind: "snapshot_card", name: "RELIANCE", data }} />);
    expect(screen.getByText("RELIANCE INDUSTRIES LTD")).toBeTruthy();
    expect(screen.getByText("REL")).toBeTruthy(); // monogram logo
    expect(screen.getByText("Energy")).toBeTruthy();
    expect(screen.getByText("ROE")).toBeTruthy();
    expect(screen.getByText("-1.40%")).toBeTruthy();
    expect(screen.getByText("+12.50%")).toBeTruthy(); // rev growth signed
  });

  it("renders markdown table and bold", () => {
    const md = "**Summary**\n\n| Ticker | PE |\n|---|---|\n| RELIANCE | 21.9 |\n\n- point one\n- point two";
    const { container } = render(<Markdown content={md} />);
    expect(container.querySelector("table")).toBeTruthy();
    expect(screen.getByText("RELIANCE")).toBeTruthy();
    expect(screen.getByText("point one")).toBeTruthy();
    expect(screen.getByText("Summary")).toBeTruthy();
  });
});

import { buildScreenContext } from "../agent/screenContext";
import { useStockStore } from "../store/stockStore";

describe("agent screen context", () => {
  it("defaults the symbol to the open stock on equity routes", () => {
    window.history.pushState({}, "", "/equity/stocks");
    useStockStore.getState().setTicker("TCS");
    const ctx = buildScreenContext();
    expect(ctx.symbol).toBe("TCS");
    expect(ctx.route).toBe("/equity/stocks");
  });

  it("does not attach an equity symbol on unrelated routes", () => {
    window.history.pushState({}, "", "/portfolio");
    const ctx = buildScreenContext();
    expect(ctx.symbol).toBeUndefined();
  });
});

import { ChatThread } from "../agent/components/ChatThread";
import type { AgentMessage } from "../agent/types";

describe("debate UI", () => {
  const base = (over: Partial<AgentMessage>): AgentMessage => ({
    id: "x", role: "assistant", content: "", steps: [], phases: [], roles: [], pending: false, ...over,
  });

  it("renders phase stepper, bull/bear cards and a decision banner", () => {
    const msg = base({
      phases: [
        { key: "analysts", label: "Analyst team" },
        { key: "debate", label: "Bull vs Bear" },
        { key: "decision", label: "Portfolio manager" },
      ],
      roles: [
        { role: "fundamental", content: "Strong **moat**." },
        { role: "bull", content: "Upside on growth." },
        { role: "bear", content: "Thin margins." },
      ],
      content: "Weighing both sides.\n\nDECISION: BUY | CONVICTION: 70 | Solid growth at a fair price.",
    });
    render(<ChatThread messages={[msg]} />);
    expect(screen.getByText("Analyst team")).toBeTruthy();
    expect(screen.getByText("Bull Case")).toBeTruthy();
    expect(screen.getByText("Bear Case")).toBeTruthy();
    expect(screen.getByText("BUY")).toBeTruthy();
    expect(screen.getByText("70%")).toBeTruthy();
    expect(screen.getByText("Solid growth at a fair price.")).toBeTruthy();
  });
});
