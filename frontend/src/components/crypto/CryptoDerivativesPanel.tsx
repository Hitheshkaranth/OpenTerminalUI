export type CryptoDerivativesRow = {
  symbol: string;
  funding_rate_8h: number;
  open_interest_usd: number;
  long_liquidations_24h: number;
  short_liquidations_24h: number;
  liquidations_24h: number;
};

export type CryptoDerivativesTotals = {
  open_interest_usd: number;
  long_liquidations_24h: number;
  short_liquidations_24h: number;
  liquidations_24h: number;
};

export function CryptoDerivativesPanel({
  rows,
  totals,
  onSelect,
}: {
  rows: CryptoDerivativesRow[];
  totals: CryptoDerivativesTotals;
  onSelect?: (symbol: string) => void;
}) {
  return (
    <div className="space-y-3" data-testid="crypto-derivatives-panel">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div className="rounded border border-terminal-border bg-terminal-bg p-2 text-xs">
          <div className="text-terminal-muted">Open Interest</div>
          <div className="text-terminal-text">${Math.round(totals.open_interest_usd).toLocaleString()}</div>
        </div>
        <div className="rounded border border-terminal-border bg-terminal-bg p-2 text-xs">
          <div className="text-terminal-muted">Liquidations</div>
          <div className="text-terminal-text">${Math.round(totals.liquidations_24h).toLocaleString()}</div>
        </div>
        <div className="rounded border border-terminal-border bg-terminal-bg p-2 text-xs">
          <div className="text-terminal-muted">Long Liq</div>
          <div className="text-terminal-neg">${Math.round(totals.long_liquidations_24h).toLocaleString()}</div>
        </div>
        <div className="rounded border border-terminal-border bg-terminal-bg p-2 text-xs">
          <div className="text-terminal-muted">Short Liq</div>
          <div className="text-terminal-pos">${Math.round(totals.short_liquidations_24h).toLocaleString()}</div>
        </div>
      </div>

      <table className="w-full text-xs">
        <thead className="text-terminal-muted">
          <tr>
            <th className="text-left">Symbol</th>
            <th className="text-right">Funding (8h)</th>
            <th className="text-right">Open Interest</th>
            <th className="text-right">24h Liq</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.symbol} className="border-t border-terminal-border/50">
              <td>
                {onSelect ? (
                  <button type="button" className="text-terminal-accent hover:underline" onClick={() => onSelect(row.symbol)}>
                    {row.symbol}
                  </button>
                ) : (
                  <span className="text-terminal-accent">{row.symbol}</span>
                )}
              </td>
              <td className={`text-right ${row.funding_rate_8h >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>
                {(row.funding_rate_8h * 100).toFixed(3)}%
              </td>
              <td className="text-right">${Math.round(row.open_interest_usd).toLocaleString()}</td>
              <td className="text-right">${Math.round(row.liquidations_24h).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
