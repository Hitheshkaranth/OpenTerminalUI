export type CryptoDefiHeadline = {
  tvl_usd: number;
  dex_volume_24h: number;
  lending_borrowed_usd: number;
  defi_change_24h: number;
};

export type CryptoDefiProtocol = {
  symbol: string;
  name: string;
  change_24h: number;
  dominance_pct: number;
  tvl_proxy_usd: number;
};

export function CryptoDefiPanel({
  headline,
  protocols,
  onSelect,
}: {
  headline: CryptoDefiHeadline;
  protocols: CryptoDefiProtocol[];
  onSelect?: (symbol: string) => void;
}) {
  return (
    <div className="space-y-3" data-testid="crypto-defi-panel">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div className="rounded border border-terminal-border bg-terminal-bg p-2 text-xs">
          <div className="text-terminal-muted">TVL Proxy</div>
          <div className="text-terminal-text">${Math.round(headline.tvl_usd).toLocaleString()}</div>
        </div>
        <div className="rounded border border-terminal-border bg-terminal-bg p-2 text-xs">
          <div className="text-terminal-muted">DEX Vol (24h)</div>
          <div className="text-terminal-text">${Math.round(headline.dex_volume_24h).toLocaleString()}</div>
        </div>
        <div className="rounded border border-terminal-border bg-terminal-bg p-2 text-xs">
          <div className="text-terminal-muted">Borrowed</div>
          <div className="text-terminal-text">${Math.round(headline.lending_borrowed_usd).toLocaleString()}</div>
        </div>
        <div className="rounded border border-terminal-border bg-terminal-bg p-2 text-xs">
          <div className="text-terminal-muted">DeFi Change</div>
          <div className={headline.defi_change_24h >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>
            {headline.defi_change_24h.toFixed(2)}%
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
        {protocols.map((row) => (
          <div key={row.symbol} className="rounded border border-terminal-border bg-terminal-bg p-2 text-xs">
            <div className="flex items-center justify-between">
              {onSelect ? (
                <button type="button" className="text-terminal-accent hover:underline" onClick={() => onSelect(row.symbol)}>
                  {row.symbol}
                </button>
              ) : (
                <span className="text-terminal-accent">{row.symbol}</span>
              )}
              <span className={row.change_24h >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>{row.change_24h.toFixed(2)}%</span>
            </div>
            <div className="text-terminal-muted">{row.name}</div>
            <div className="mt-1 text-terminal-text">Dominance {row.dominance_pct.toFixed(1)}%</div>
            <div className="text-terminal-muted">TVL ${Math.round(row.tvl_proxy_usd).toLocaleString()}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
