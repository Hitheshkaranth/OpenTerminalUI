import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Calculator, Percent, Info, AlertCircle, Loader2, TrendingUp, TrendingDown } from "lucide-react";
import { TerminalPanel } from "../../components/terminal/TerminalPanel";
import { postGreeks, postImpliedVol, GreeksRequest, GreeksResult } from "../../api/quantAnalytics";
import { extractApiErrorMessage } from "../../api/base";

export function OptionGreeksCalculator() {
  const [spot, setSpot] = useState<string>("100");
  const [strike, setStrike] = useState<string>("100");
  const [expiry, setExpiry] = useState<string>("1.0");
  const [rate, setRate] = useState<string>("5.0");
  const [vol, setVol] = useState<string>("20.0");
  const [div, setDiv] = useState<string>("0.0");
  const [optionType, setOptionType] = useState<"call" | "put">("call");
  const [marketPrice, setMarketPrice] = useState<string>("");

  const greeksMutation = useMutation({
    mutationFn: (req: GreeksRequest) => postGreeks(req),
  });

  const ivMutation = useMutation({
    mutationFn: (req: Omit<GreeksRequest, "volatility"> & { market_price: number }) => postImpliedVol(req),
    onSuccess: (data) => {
      setVol((data.implied_volatility * 100).toFixed(2));
    },
  });

  const handleCalculateGreeks = () => {
    const req: GreeksRequest = {
      spot: parseFloat(spot),
      strike: parseFloat(strike),
      time_to_expiry: parseFloat(expiry),
      rate: parseFloat(rate) / 100,
      volatility: parseFloat(vol) / 100,
      dividend_yield: parseFloat(div) / 100,
      option_type: optionType,
    };
    greeksMutation.mutate(req);
  };

  const handleCalculateIV = () => {
    if (!marketPrice) return;
    const req = {
      spot: parseFloat(spot),
      strike: parseFloat(strike),
      time_to_expiry: parseFloat(expiry),
      rate: parseFloat(rate) / 100,
      dividend_yield: parseFloat(div) / 100,
      option_type: optionType,
      market_price: parseFloat(marketPrice),
    };
    ivMutation.mutate(req);
  };

  const GreekItem = ({ label, value, color }: { label: string; value: number; color?: string }) => (
    <div className="flex flex-col border border-terminal-border bg-terminal-panel/30 p-3">
      <span className="text-[10px] uppercase tracking-wider text-terminal-muted">{label}</span>
      <span className={`mt-1 text-lg font-bold ${color || "text-terminal-accent"}`}>
        {value.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
      </span>
    </div>
  );

  // /api/options/greeks returns theta per YEAR and vega/rho per 1.00 (100%) change in
  // vol/rate. Convert to trader conventions so values match their labels.
  const g = greeksMutation.data;
  const thetaDaily = g ? g.theta / 365 : 0;
  const vegaPer1Pct = g ? g.vega / 100 : 0;
  const rhoPer1Pct = g ? g.rho / 100 : 0;

  const getDeltaColor = (delta: number) => {
    if (delta > 0) return "text-green-400";
    if (delta < 0) return "text-red-400";
    return "text-terminal-accent";
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto bg-terminal-bg p-4 text-terminal-text">
      <div className="flex items-center justify-between border-b border-terminal-border pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded bg-terminal-accent/10">
            <Calculator className="h-6 w-6 text-terminal-accent" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-terminal-accent uppercase tracking-tight">Option Greeks Calculator</h1>
            <p className="text-xs text-terminal-muted">Black-Scholes Pricing & Sensitivity Analysis</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Input Panel */}
        <div className="lg:col-span-1">
          <TerminalPanel title="PRICING PARAMETERS">
            <div className="flex flex-col gap-4 p-4">
              <div className="flex gap-2">
                <button
                  onClick={() => setOptionType("call")}
                  className={`flex-1 flex items-center justify-center gap-2 rounded py-2 text-xs font-bold transition-colors ${
                    optionType === "call"
                      ? "bg-green-600 text-white"
                      : "bg-terminal-panel text-terminal-muted hover:bg-terminal-border"
                  }`}
                >
                  <TrendingUp className="h-3 w-3" /> CALL
                </button>
                <button
                  onClick={() => setOptionType("put")}
                  className={`flex-1 flex items-center justify-center gap-2 rounded py-2 text-xs font-bold transition-colors ${
                    optionType === "put"
                      ? "bg-red-600 text-white"
                      : "bg-terminal-panel text-terminal-muted hover:bg-terminal-border"
                  }`}
                >
                  <TrendingDown className="h-3 w-3" /> PUT
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-terminal-muted">SPOT PRICE</label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full rounded border border-terminal-border bg-terminal-bg p-2 text-sm text-terminal-text outline-none focus:border-terminal-accent"
                    value={spot}
                    onChange={(e) => setSpot(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-terminal-muted">STRIKE PRICE</label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full rounded border border-terminal-border bg-terminal-bg p-2 text-sm text-terminal-text outline-none focus:border-terminal-accent"
                    value={strike}
                    onChange={(e) => setStrike(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-terminal-muted">TIME TO EXPIRY (YRS)</label>
                  <input
                    type="number"
                    step="0.001"
                    className="w-full rounded border border-terminal-border bg-terminal-bg p-2 text-sm text-terminal-text outline-none focus:border-terminal-accent"
                    value={expiry}
                    onChange={(e) => setExpiry(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-terminal-muted">RISK-FREE RATE (%)</label>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.01"
                      className="w-full rounded border border-terminal-border bg-terminal-bg p-2 text-sm text-terminal-text outline-none focus:border-terminal-accent"
                      value={rate}
                      onChange={(e) => setRate(e.target.value)}
                    />
                    <Percent className="absolute right-2 top-2.5 h-4 w-4 text-terminal-muted" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-terminal-muted">VOLATILITY (%)</label>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.01"
                      className="w-full rounded border border-terminal-border bg-terminal-bg p-2 text-sm text-terminal-text outline-none focus:border-terminal-accent"
                      value={vol}
                      onChange={(e) => setVol(e.target.value)}
                    />
                    <Percent className="absolute right-2 top-2.5 h-4 w-4 text-terminal-muted" />
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-terminal-muted">DIVIDEND YIELD (%)</label>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.01"
                      className="w-full rounded border border-terminal-border bg-terminal-bg p-2 text-sm text-terminal-text outline-none focus:border-terminal-accent"
                      value={div}
                      onChange={(e) => setDiv(e.target.value)}
                    />
                    <Percent className="absolute right-2 top-2.5 h-4 w-4 text-terminal-muted" />
                  </div>
                </div>
              </div>

              <button
                onClick={handleCalculateGreeks}
                disabled={greeksMutation.isPending}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded bg-terminal-accent p-3 text-sm font-bold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {greeksMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
                CALCULATE GREEKS
              </button>

              <div className="mt-4 border-t border-terminal-border pt-4">
                <label className="text-xs font-bold text-terminal-accent uppercase mb-2 block">Estimate Implied Vol</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Market Price"
                    className="flex-grow rounded border border-terminal-border bg-terminal-bg p-2 text-sm text-terminal-text outline-none focus:border-terminal-accent"
                    value={marketPrice}
                    onChange={(e) => setMarketPrice(e.target.value)}
                  />
                  <button
                    onClick={handleCalculateIV}
                    disabled={ivMutation.isPending || !marketPrice}
                    className="rounded bg-terminal-panel px-3 text-xs font-bold text-terminal-text hover:bg-terminal-border disabled:opacity-50"
                  >
                    {ivMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "ESTIMATE IV"}
                  </button>
                </div>
              </div>

              {(greeksMutation.isError || ivMutation.isError) && (
                <div className="flex items-start gap-2 rounded border border-red-900/50 bg-red-900/10 p-3 text-xs text-red-400">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    {extractApiErrorMessage(
                      greeksMutation.error || ivMutation.error,
                      "Calculation failed. Check inputs."
                    )}
                  </span>
                </div>
              )}
            </div>
          </TerminalPanel>
        </div>

        {/* Results Panel */}
        <div className="lg:col-span-2">
          <TerminalPanel title="GREEKS & THEORETICAL VALUE">
            <div className="p-4">
              {!greeksMutation.data && !greeksMutation.isPending && !greeksMutation.isError && (
                <div className="flex h-[300px] flex-col items-center justify-center text-terminal-muted">
                  <Info className="mb-2 h-8 w-8 opacity-20" />
                  <p className="text-sm">Enter pricing parameters and calculate to see results.</p>
                </div>
              )}

              {greeksMutation.isPending && (
                <div className="flex h-[300px] flex-col items-center justify-center text-terminal-accent">
                  <Loader2 className="mb-2 h-8 w-8 animate-spin" />
                  <p className="text-sm animate-pulse">PRICING OPTION...</p>
                </div>
              )}

              {greeksMutation.data && (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <div className="flex flex-col border border-terminal-border bg-terminal-panel/50 p-3 md:col-span-2 lg:col-span-3">
                    <span className="text-[10px] uppercase tracking-wider text-terminal-muted">Theoretical Price</span>
                    <span className="mt-1 text-3xl font-bold text-terminal-accent">
                      {greeksMutation.data.price.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                    </span>
                  </div>
                  
                  <GreekItem label="Delta" value={greeksMutation.data.delta} color={getDeltaColor(greeksMutation.data.delta)} />
                  <GreekItem label="Gamma" value={greeksMutation.data.gamma} />
                  <GreekItem label="Vega (per 1% IV)" value={vegaPer1Pct} />
                  <GreekItem label="Theta (Daily)" value={thetaDaily} />
                  <GreekItem label="Rho (per 1% rate)" value={rhoPer1Pct} />
                  
                  <div className="flex flex-col border border-terminal-border bg-terminal-panel/30 p-3">
                    <span className="text-[10px] uppercase tracking-wider text-terminal-muted">d1 / d2</span>
                    <span className="mt-1 text-sm font-mono text-terminal-muted">
                      {greeksMutation.data.d1.toFixed(4)} / {greeksMutation.data.d2.toFixed(4)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </TerminalPanel>

          {greeksMutation.data && (
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded border border-terminal-border bg-terminal-panel/20 p-4">
                <h3 className="mb-2 text-xs font-bold text-terminal-accent uppercase">Position Sensitivity</h3>
                <p className="text-xs leading-relaxed text-terminal-muted">
                  For a 1.00 change in the underlying asset price, the option's value will change by 
                  approximately <span className="text-terminal-text">{greeksMutation.data.delta.toFixed(4)}</span>. 
                  The Delta itself will change by <span className="text-terminal-text">{greeksMutation.data.gamma.toFixed(4)}</span> for every 1.00 move.
                </p>
              </div>
              <div className="rounded border border-terminal-border bg-terminal-panel/20 p-4">
                <h3 className="mb-2 text-xs font-bold text-terminal-accent uppercase">Time & Volatility</h3>
                <p className="text-xs leading-relaxed text-terminal-muted">
                  The option loses <span className="text-terminal-text">{Math.abs(thetaDaily).toFixed(4)}</span> in value every calendar day 
                  due to time decay (Theta). A 1% increase in implied volatility will increase the option price 
                  by <span className="text-terminal-text">{vegaPer1Pct.toFixed(4)}</span> (Vega).
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
