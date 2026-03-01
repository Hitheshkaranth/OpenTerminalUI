import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";

import { VolumeProfile } from "../components/chart/VolumeProfile";
import type { VolumeProfileResponse } from "../api/client";
import type { QuoteTick } from "../realtime/useQuotesStream";

const SAMPLE_PROFILE: VolumeProfileResponse = {
  symbol: "AAPL",
  period: "20d",
  bins: [
    { price_low: 100, price_high: 110, volume: 400, buy_volume: 250, sell_volume: 150 },
    { price_low: 110, price_high: 120, volume: 700, buy_volume: 350, sell_volume: 350 },
    { price_low: 120, price_high: 130, volume: 300, buy_volume: 120, sell_volume: 180 },
  ],
  poc_price: 115,
  value_area_high: 124,
  value_area_low: 106,
};

describe("VolumeProfile", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders right-axis bins with buy/sell overlays", () => {
    render(<VolumeProfile profile={SAMPLE_PROFILE} />);

    expect(screen.getByTestId("volume-profile-overlay")).toBeInTheDocument();
    expect(screen.getAllByTestId(/volume-profile-bin-/)).toHaveLength(3);

    const buy = screen.getByTestId("volume-profile-buy-1");
    const sell = screen.getByTestId("volume-profile-sell-1");
    expect(buy.getAttribute("style")).toContain("width");
    expect(sell.getAttribute("style")).toContain("width");
  });

  it("maps poc/value-area lines to profile prices", () => {
    render(<VolumeProfile profile={SAMPLE_PROFILE} />);

    const poc = screen.getByTestId("volume-profile-line-poc");
    const vah = screen.getByTestId("volume-profile-line-vah");
    const val = screen.getByTestId("volume-profile-line-val");

    expect(poc).toHaveStyle({ top: "50%" });
    expect(vah).toHaveStyle({ top: "20%" });
    expect(val).toHaveStyle({ top: "80%" });
  });

  it("coalesces profile refresh to next animation frame", () => {
    const rafQueue: FrameRequestCallback[] = [];
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

    const { rerender } = render(<VolumeProfile profile={SAMPLE_PROFILE} />);
    const next: VolumeProfileResponse = {
      ...SAMPLE_PROFILE,
      poc_price: 125,
      bins: SAMPLE_PROFILE.bins.map((row, idx) => (idx === 2 ? { ...row, volume: 1000 } : row)),
    };
    rerender(<VolumeProfile profile={next} />);

    expect(rafQueue.length).toBeGreaterThan(0);
    expect(screen.getByTestId("volume-profile-line-poc")).toHaveStyle({ top: "50%" });

    const cb = rafQueue.shift();
    act(() => { cb?.(0); });

    expect(screen.getByTestId("volume-profile-line-poc")).toHaveStyle({ top: "16.67%" });
    expect(rafSpy).toHaveBeenCalled();
  });

  it("applies live quote volume delta incrementally to matching bin", () => {
    const rafQueue: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

    const initialTick: QuoteTick = {
      token: "US:AAPL",
      market: "US",
      symbol: "AAPL",
      ltp: 105,
      change: 0,
      change_pct: 0,
      oi: null,
      volume: 1000,
      ts: "2026-02-28T20:00:00.000Z",
    };
    const nextTick: QuoteTick = {
      ...initialTick,
      volume: 1100,
      ts: "2026-02-28T20:00:01.000Z",
    };

    const { rerender } = render(<VolumeProfile profile={SAMPLE_PROFILE} liveQuote={initialTick} />);
    const firstProfileRaf = rafQueue.shift();
    firstProfileRaf?.(0);

    expect(screen.getByTestId("volume-profile-bin-0")).toHaveAttribute("data-volume", "400.0000");

    rerender(<VolumeProfile profile={SAMPLE_PROFILE} liveQuote={nextTick} />);
    const firstLiveRaf = rafQueue.shift();
    act(() => { firstLiveRaf?.(0); });

    expect(screen.getByTestId("volume-profile-bin-0")).toHaveAttribute("data-volume", "500.0000");
  });
});
