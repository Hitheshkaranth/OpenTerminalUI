type HeatmapGridProps = {
  data: Array<{ row: string; col: string; value: number }>;
};

export function HeatmapGrid({ data }: HeatmapGridProps) {
  if (!data.length) return <div className="text-xs text-terminal-muted">No heatmap data</div>;
  return (
    <div className="grid grid-cols-4 gap-1 text-[11px]">
      {data.slice(0, 24).map((cell, idx) => {
        const intensity = Math.max(0, Math.min(1, (cell.value + 20) / 40));
        const bg = `rgba(0, 230, 118, ${intensity})`;
        return (
          <div key={`${cell.row}-${cell.col}-${idx}`} className="rounded p-1" style={{ background: bg }}>
            <div>{cell.row}</div>
            <div>{cell.col}</div>
            <div>{cell.value.toFixed(1)}</div>
          </div>
        );
      })}
    </div>
  );
}
