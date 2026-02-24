type RRGQuadrantProps = {
  data: Array<{ x: number; y: number; label: string }>;
};

export function RRGQuadrant({ data }: RRGQuadrantProps) {
  return (
    <div className="relative h-56 rounded border border-terminal-border bg-terminal-bg">
      <div className="absolute left-1/2 top-0 h-full w-px bg-terminal-border" />
      <div className="absolute top-1/2 h-px w-full bg-terminal-border" />
      {data.slice(0, 20).map((item) => (
        <div
          key={item.label}
          className="absolute text-[10px] text-terminal-accent"
          style={{ left: `${50 + item.x}%`, top: `${50 - item.y}%` }}
        >
          ? {item.label}
        </div>
      ))}
    </div>
  );
}
