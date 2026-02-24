type SparklineCellProps = {
  values?: number[];
  width?: number;
  height?: number;
};

export function SparklineCell({ values = [], width = 84, height = 24 }: SparklineCellProps) {
  if (values.length < 2) {
    return <span className="text-terminal-muted">--</span>;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline fill="none" stroke="#18ffff" strokeWidth="1.4" points={points} />
    </svg>
  );
}
