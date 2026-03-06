export type CryptoHeatmapCell = {
  symbol: string;
  name: string;
  sector: string;
  change_24h: number;
  market_cap: number;
  depth_imbalance: number;
  bucket: string;
};

function bucketClass(bucket: string): string {
  switch (bucket) {
    case "surge":
      return "border-terminal-pos/60 bg-terminal-pos/15";
    case "bullish":
      return "border-terminal-pos/40 bg-terminal-pos/10";
    case "up":
      return "border-terminal-pos/30 bg-terminal-pos/5";
    case "flush":
      return "border-terminal-neg/60 bg-terminal-neg/15";
    case "bearish":
      return "border-terminal-neg/40 bg-terminal-neg/10";
    case "down":
      return "border-terminal-neg/30 bg-terminal-neg/5";
    default:
      return "border-terminal-border bg-terminal-bg";
  }
}

export function CryptoHeatmapPanel({
  items,
  onSelect,
}: {
  items: CryptoHeatmapCell[];
  onSelect: (symbol: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6" data-testid="crypto-heatmap-panel">
      {items.map((item) => (
        <button
          key={item.symbol}
          type="button"
          className={`rounded border p-2 text-left text-xs transition hover:border-terminal-accent ${bucketClass(item.bucket)}`}
          onClick={() => onSelect(item.symbol)}
        >
          <div className="flex items-center justify-between">
            <span className="text-terminal-accent">{item.symbol.replace("-USD", "")}</span>
            <span className={item.change_24h >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>{item.change_24h.toFixed(2)}%</span>
          </div>
          <div className="mt-1 text-terminal-muted">{item.sector}</div>
          <div className="mt-1 text-[11px] text-terminal-text">Depth {(item.depth_imbalance * 100).toFixed(1)}%</div>
        </button>
      ))}
    </div>
  );
}
