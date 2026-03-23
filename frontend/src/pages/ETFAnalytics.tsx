import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { HoldingsViewer } from "../components/etf/HoldingsViewer";
import { OverlapAnalysis } from "../components/etf/OverlapAnalysis";
import { FlowTracker } from "../components/etf/FlowTracker";
import { TerminalInput } from "../components/terminal/TerminalInput";
import { TerminalPanel } from "../components/terminal/TerminalPanel";

export function ETFAnalyticsPage() {
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const urlTicker = queryParams.get("ticker");

  const [ticker, setTicker] = useState(urlTicker || "SPY");
  const [compareTickers, setCompareTickers] = useState<string[]>(["SPY", "VOO"]);
  const [compareInput, setCompareInput] = useState("SPY, VOO");

  useEffect(() => {
    if (urlTicker) {
      setTicker(urlTicker.toUpperCase());
    }
  }, [urlTicker]);

  const handleCompareChange = (value: string) => {
    setCompareInput(value);
    const tickers = value
      .split(",")
      .map((t) => t.trim().toUpperCase())
      .filter((t) => t.length > 0);
    if (tickers.length >= 2) {
      setCompareTickers(tickers);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight text-terminal-accent uppercase">
          ETF Analytics & Intelligence
        </h1>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase text-terminal-muted font-semibold">Active Ticker</span>
            <TerminalInput
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              className="w-24 h-7 text-xs"
              placeholder="TICKER"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="flex flex-col gap-4">
          <TerminalPanel title={`Holdings Analysis: ${ticker}`}>
            <HoldingsViewer ticker={ticker} />
          </TerminalPanel>

          <TerminalPanel title={`Fund Flows: ${ticker}`}>
            <FlowTracker ticker={ticker} />
          </TerminalPanel>
        </div>

        <div className="flex flex-col gap-4">
          <TerminalPanel
            title="Overlap Analysis"
            actions={
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase text-terminal-muted">Compare</span>
                <TerminalInput
                  value={compareInput}
                  onChange={(e) => handleCompareChange(e.target.value)}
                  className="w-48 h-6 text-[10px]"
                  placeholder="T1, T2, ..."
                />
              </div>
            }
          >
            <OverlapAnalysis tickers={compareTickers} />
          </TerminalPanel>

          <TerminalPanel title="ETF Market Intelligence">
            <div className="p-4 text-xs text-terminal-muted italic">
              Select ETFs to compare holdings overlap and analyze historical fund flows.
              The analysis helps in identifying concentration risks and tracking institutional sentiment.
            </div>
          </TerminalPanel>
        </div>
      </div>
    </div>
  );
}
