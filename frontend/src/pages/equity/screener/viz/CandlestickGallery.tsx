type CandlestickGalleryProps = {
  data: Array<{ label: string; open: number; high: number; low: number; close: number }>;
};

export function CandlestickGallery({ data }: CandlestickGalleryProps) {
  return (
    <div className="grid grid-cols-2 gap-2 text-[11px]">
      {data.slice(0, 8).map((item) => {
        const bullish = item.close >= item.open;
        return (
          <div key={item.label} className="rounded border border-terminal-border p-2">
            <div className="mb-1 text-terminal-muted">{item.label}</div>
            <div className={bullish ? "text-terminal-pos" : "text-terminal-neg"}>
              O {item.open} H {item.high} L {item.low} C {item.close}
            </div>
          </div>
        );
      })}
    </div>
  );
}
