type BoxPlotProps = {
  data: Array<{ label: string; q1: number; q2: number; q3: number; min: number; max: number }>;
};

export function BoxPlot({ data }: BoxPlotProps) {
  return (
    <div className="space-y-2 text-xs">
      {data.slice(0, 8).map((item) => (
        <div key={item.label} className="rounded border border-terminal-border p-2">
          <div className="mb-1 text-terminal-muted">{item.label}</div>
          <div>
            min {item.min} | q1 {item.q1} | median {item.q2} | q3 {item.q3} | max {item.max}
          </div>
        </div>
      ))}
    </div>
  );
}
