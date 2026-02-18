type TickerEntry = {
  symbol: string;
  value: string;
  delta: string;
  up: boolean;
};

const TICKER_DATA: TickerEntry[] = [
  { symbol: "NIFTY", value: "24,856.50", delta: "124.30", up: true },
  { symbol: "SENSEX", value: "81,234.10", delta: "89.40", up: false },
  { symbol: "BANKNIFTY", value: "52,120.00", delta: "310.55", up: true },
  { symbol: "RELIANCE", value: "2,891.50", delta: "12.30", up: true },
  { symbol: "TCS", value: "4,120.80", delta: "18.90", up: false },
  { symbol: "INFY", value: "1,890.20", delta: "8.45", up: true },
  { symbol: "USDINR", value: "83.42", delta: "0.08", up: false },
];

function TickerRow() {
  return (
    <div className="ot-market-ticker-row">
      {TICKER_DATA.map((item) => (
        <span key={item.symbol} className="ot-market-ticker-item">
          <span className="ot-market-ticker-symbol">{item.symbol}</span>{" "}
          <span>{item.value}</span>{" "}
          <span className={item.up ? "ot-value-up" : "ot-value-down"}>{item.up ? "?" : "?"}{item.delta}</span>
          <span className="ot-market-ticker-separator">|</span>
        </span>
      ))}
    </div>
  );
}

export function MarketTicker() {
  return (
    <div className="ot-market-ticker" aria-hidden>
      <div className="ot-market-ticker-track">
        <TickerRow />
        <TickerRow />
      </div>
    </div>
  );
}
