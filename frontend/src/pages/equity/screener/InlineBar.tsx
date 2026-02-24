type InlineBarProps = {
  value?: number;
  max?: number;
  color?: string;
};

export function InlineBar({ value = 0, max = 40, color = "#00e676" }: InlineBarProps) {
  const widthPct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="h-2 w-16 rounded bg-terminal-bg">
      <div className="h-2 rounded" style={{ width: `${widthPct}%`, background: color }} />
    </div>
  );
}
