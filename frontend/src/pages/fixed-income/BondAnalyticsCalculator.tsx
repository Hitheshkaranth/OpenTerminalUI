import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Calculator, Percent, Info, AlertCircle, Loader2 } from "lucide-react";
import { TerminalPanel } from "../../components/terminal/TerminalPanel";
import { postBondAnalytics, BondAnalyticsRequest, BondAnalyticsResult } from "../../api/quantAnalytics";
import { extractApiErrorMessage } from "../../api/base";

export function BondAnalyticsCalculator() {
  const [couponRate, setCouponRate] = useState<string>("5.0");
  const [yearsToMaturity, setYearsToMaturity] = useState<string>("10");
  const [frequency, setFrequency] = useState<string>("2");
  const [faceValue, setFaceValue] = useState<string>("1000");
  const [solveMode, setSolveMode] = useState<"ytm" | "price">("price");
  const [ytmInput, setYtmInput] = useState<string>("6.0");
  const [priceInput, setPriceInput] = useState<string>("926.40");

  const mutation = useMutation({
    mutationFn: (req: BondAnalyticsRequest) => postBondAnalytics(req),
  });

  const handleCalculate = () => {
    const req: BondAnalyticsRequest = {
      coupon_rate: parseFloat(couponRate) / 100,
      years_to_maturity: parseFloat(yearsToMaturity),
      frequency: parseInt(frequency),
      face_value: parseFloat(faceValue),
    };

    if (solveMode === "price") {
      req.ytm = parseFloat(ytmInput) / 100;
      req.price = null;
    } else {
      req.price = parseFloat(priceInput);
      req.ytm = null;
    }

    mutation.mutate(req);
  };

  const ResultItem = ({ label, value, unit = "" }: { label: string; value: string | number; unit?: string }) => (
    <div className="flex flex-col border border-terminal-border bg-terminal-panel/30 p-3">
      <span className="text-[10px] uppercase tracking-wider text-terminal-muted">{label}</span>
      <span className="mt-1 text-lg font-bold text-terminal-accent">
        {typeof value === "number" ? value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : value}
        {unit && <span className="ml-1 text-xs font-normal text-terminal-muted">{unit}</span>}
      </span>
    </div>
  );

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto bg-terminal-bg p-4 text-terminal-text">
      <div className="flex items-center justify-between border-b border-terminal-border pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded bg-terminal-accent/10">
            <Calculator className="h-6 w-6 text-terminal-accent" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-terminal-accent uppercase tracking-tight">Bond Analytics Calculator</h1>
            <p className="text-xs text-terminal-muted">Yield, Duration, Convexity & DV01 Analysis</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Input Panel */}
        <div className="lg:col-span-1">
          <TerminalPanel title="BOND PARAMETERS">
            <div className="flex flex-col gap-4 p-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-terminal-muted">COUPON RATE (%)</label>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.01"
                      className="w-full rounded border border-terminal-border bg-terminal-bg p-2 text-sm text-terminal-text outline-none focus:border-terminal-accent"
                      value={couponRate}
                      onChange={(e) => setCouponRate(e.target.value)}
                    />
                    <Percent className="absolute right-2 top-2.5 h-4 w-4 text-terminal-muted" />
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-terminal-muted">FACE VALUE</label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full rounded border border-terminal-border bg-terminal-bg p-2 text-sm text-terminal-text outline-none focus:border-terminal-accent"
                    value={faceValue}
                    onChange={(e) => setFaceValue(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-terminal-muted">YEARS TO MATURITY</label>
                  <input
                    type="number"
                    step="0.1"
                    className="w-full rounded border border-terminal-border bg-terminal-bg p-2 text-sm text-terminal-text outline-none focus:border-terminal-accent"
                    value={yearsToMaturity}
                    onChange={(e) => setYearsToMaturity(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-terminal-muted">FREQUENCY</label>
                  <select
                    className="w-full rounded border border-terminal-border bg-terminal-bg p-2 text-sm text-terminal-text outline-none focus:border-terminal-accent"
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value)}
                  >
                    <option value="1">Annual (1)</option>
                    <option value="2">Semi-Annual (2)</option>
                    <option value="4">Quarterly (4)</option>
                    <option value="12">Monthly (12)</option>
                  </select>
                </div>
              </div>

              <div className="border-t border-terminal-border pt-4">
                <div className="mb-4 flex gap-2">
                  <button
                    onClick={() => setSolveMode("price")}
                    className={`flex-1 rounded py-1.5 text-xs font-bold transition-colors ${
                      solveMode === "price"
                        ? "bg-terminal-accent text-black"
                        : "bg-terminal-panel text-terminal-muted hover:bg-terminal-border"
                    }`}
                  >
                    SOLVE FROM YIELD
                  </button>
                  <button
                    onClick={() => setSolveMode("ytm")}
                    className={`flex-1 rounded py-1.5 text-xs font-bold transition-colors ${
                      solveMode === "ytm"
                        ? "bg-terminal-accent text-black"
                        : "bg-terminal-panel text-terminal-muted hover:bg-terminal-border"
                    }`}
                  >
                    SOLVE FROM PRICE
                  </button>
                </div>

                {solveMode === "price" ? (
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-terminal-muted">YIELD TO MATURITY (%)</label>
                    <div className="relative">
                      <input
                        type="number"
                        step="0.01"
                        className="w-full rounded border border-terminal-border bg-terminal-bg p-2 text-sm text-terminal-text outline-none focus:border-terminal-accent"
                        value={ytmInput}
                        onChange={(e) => setYtmInput(e.target.value)}
                      />
                      <Percent className="absolute right-2 top-2.5 h-4 w-4 text-terminal-muted" />
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-terminal-muted">MARKET PRICE</label>
                    <input
                      type="number"
                      step="0.01"
                      className="w-full rounded border border-terminal-border bg-terminal-bg p-2 text-sm text-terminal-text outline-none focus:border-terminal-accent"
                      value={priceInput}
                      onChange={(e) => setPriceInput(e.target.value)}
                    />
                  </div>
                )}
              </div>

              <button
                onClick={handleCalculate}
                disabled={mutation.isPending}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded bg-terminal-accent p-3 text-sm font-bold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
                CALCULATE ANALYTICS
              </button>

              {mutation.isError && (
                <div className="flex items-start gap-2 rounded border border-red-900/50 bg-red-900/10 p-3 text-xs text-red-400">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{extractApiErrorMessage(mutation.error, "Calculation failed. Check inputs.")}</span>
                </div>
              )}
            </div>
          </TerminalPanel>
        </div>

        {/* Results Panel */}
        <div className="lg:col-span-2">
          <TerminalPanel title="ANALYTICS OUTPUT">
            <div className="p-4">
              {!mutation.data && !mutation.isPending && !mutation.isError && (
                <div className="flex h-[300px] flex-col items-center justify-center text-terminal-muted">
                  <Info className="mb-2 h-8 w-8 opacity-20" />
                  <p className="text-sm">Enter bond parameters and calculate to see results.</p>
                </div>
              )}

              {mutation.isPending && (
                <div className="flex h-[300px] flex-col items-center justify-center text-terminal-accent">
                  <Loader2 className="mb-2 h-8 w-8 animate-spin" />
                  <p className="text-sm animate-pulse">COMPUTING ANALYTICS...</p>
                </div>
              )}

              {mutation.data && (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <ResultItem label="Market Price" value={mutation.data.price} />
                  <ResultItem label="Yield to Maturity" value={mutation.data.ytm * 100} unit="%" />
                  <ResultItem label="Current Yield" value={mutation.data.current_yield * 100} unit="%" />
                  <ResultItem label="Macaulay Duration" value={mutation.data.macaulay_duration} unit="yrs" />
                  <ResultItem label="Modified Duration" value={mutation.data.modified_duration} />
                  <ResultItem label="Convexity" value={mutation.data.convexity} />
                  <ResultItem label="DV01 (per 1bp)" value={mutation.data.dv01} />
                </div>
              )}
            </div>
          </TerminalPanel>

          {mutation.data && (
            <div className="mt-4 rounded border border-terminal-border bg-terminal-panel/20 p-4">
              <h3 className="mb-2 text-xs font-bold text-terminal-accent uppercase">Quick Summary</h3>
              <p className="text-xs leading-relaxed text-terminal-muted">
                A bond with a <span className="text-terminal-text">{Number((mutation.data.coupon_rate * 100).toFixed(4))}%</span> coupon 
                maturing in <span className="text-terminal-text">{mutation.data.years_to_maturity}</span> years 
                at a yield of <span className="text-terminal-text">{(mutation.data.ytm * 100).toFixed(2)}%</span> is priced at 
                <span className="text-terminal-text"> {mutation.data.price.toFixed(2)}</span>. 
                The modified duration of <span className="text-terminal-text">{mutation.data.modified_duration.toFixed(3)}</span> suggests 
                a 1% change in rates will lead to approximately a <span className="text-terminal-text">{(mutation.data.modified_duration).toFixed(2)}%</span> price change.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
