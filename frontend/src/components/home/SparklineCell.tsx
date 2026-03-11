import { useId, useMemo, useState } from "react";

export type SparklineGeometryPoint = {
  index: number;
  value: number;
  x: number;
  y: number;
};

export type SparklineGeometry = {
  areaPath: string;
  linePath: string;
  max: number;
  min: number;
  points: SparklineGeometryPoint[];
};

export type SparklineCellProps = {
  points: readonly number[];
  width?: number;
  height?: number;
  color?: string;
  areaColor?: string;
  benchmarkPoints?: readonly number[];
  benchmarkColor?: string;
  className?: string;
  ariaLabel?: string;
  emptyLabel?: string;
  showTooltip?: boolean;
  valueFormatter?: (value: number) => string;
};

const DEFAULT_LINE_COLOR = "var(--ot-color-accent-primary)";
const DEFAULT_AREA_COLOR = "var(--ot-color-home-widget-chart-fill-top)";
const DEFAULT_BENCHMARK_COLOR = "var(--ot-color-home-widget-chart-benchmark)";
const DEFAULT_EMPTY_LABEL = "No sparkline data available";
const SPARKLINE_PADDING = 4;

function formatDefaultValue(value: number): string {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
}

function sanitizePoints(points: readonly number[]): number[] {
  return points.filter((point) => Number.isFinite(point));
}

export function buildSparklineGeometry(
  rawPoints: readonly number[],
  width: number,
  height: number,
  padding = SPARKLINE_PADDING,
): SparklineGeometry {
  const points = sanitizePoints(rawPoints);
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const paddedWidth = Math.max(1, safeWidth - padding * 2);
  const paddedHeight = Math.max(1, safeHeight - padding * 2);

  if (points.length === 0) {
    return {
      areaPath: "",
      linePath: "",
      max: 0,
      min: 0,
      points: [],
    };
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;

  const chartPoints = (points.length === 1 ? [points[0], points[0]] : points).map((value, index, values) => {
    const x = padding + (index / Math.max(1, values.length - 1)) * paddedWidth;
    const y = padding + paddedHeight - ((value - min) / range) * paddedHeight;
    return {
      index,
      value,
      x,
      y,
    };
  });

  const linePath = chartPoints
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
  const lastPoint = chartPoints[chartPoints.length - 1];
  const firstPoint = chartPoints[0];
  const baseline = safeHeight - padding;
  const areaPath = `${linePath} L ${lastPoint.x.toFixed(2)} ${baseline.toFixed(2)} L ${firstPoint.x.toFixed(2)} ${baseline.toFixed(2)} Z`;

  return {
    areaPath,
    linePath,
    max,
    min,
    points: chartPoints,
  };
}

function getNearestPointIndex(
  points: readonly SparklineGeometryPoint[],
  clientX: number,
  rectLeft: number,
  rectWidth: number,
): number {
  if (points.length <= 1 || rectWidth <= 0) return 0;
  const relativeX = Math.min(Math.max(clientX - rectLeft, 0), rectWidth);
  const lastIndex = points.length - 1;
  return Math.round((relativeX / rectWidth) * lastIndex);
}

export function SparklineCell({
  points,
  width = 132,
  height = 42,
  color = DEFAULT_LINE_COLOR,
  areaColor = DEFAULT_AREA_COLOR,
  benchmarkPoints,
  benchmarkColor = DEFAULT_BENCHMARK_COLOR,
  className = "",
  ariaLabel = "Sparkline trend",
  emptyLabel = DEFAULT_EMPTY_LABEL,
  showTooltip = false,
  valueFormatter = formatDefaultValue,
}: SparklineCellProps) {
  const gradientId = useId().replace(/:/g, "");
  const geometry = useMemo(() => buildSparklineGeometry(points, width, height), [height, points, width]);
  const benchmarkGeometry = useMemo(
    () => buildSparklineGeometry(benchmarkPoints ?? [], width, height),
    [benchmarkPoints, height, width],
  );
  const interactive = showTooltip && geometry.points.length > 0;
  const [activeIndex, setActiveIndex] = useState<number | null>(interactive ? geometry.points.length - 1 : null);
  const activePoint =
    activeIndex == null || geometry.points.length === 0
      ? null
      : geometry.points[Math.min(Math.max(activeIndex, 0), geometry.points.length - 1)];

  const wrapperClassName = ["ot-home-widget-sparkline", className].filter(Boolean).join(" ");

  if (geometry.points.length === 0) {
    return (
      <div className={wrapperClassName} data-empty="true" role="img" aria-label={emptyLabel}>
        <div className="ot-home-widget-empty">{emptyLabel}</div>
      </div>
    );
  }

  return (
    <div
      className={wrapperClassName}
      data-interactive={interactive ? "true" : "false"}
      role="img"
      aria-label={ariaLabel}
      tabIndex={interactive ? 0 : -1}
      onFocus={() => {
        if (!interactive) return;
        setActiveIndex(geometry.points.length - 1);
      }}
      onBlur={() => {
        if (!interactive) return;
        setActiveIndex(null);
      }}
      onKeyDown={(event) => {
        if (!interactive) return;
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          setActiveIndex((current) => Math.max(0, (current ?? geometry.points.length - 1) - 1));
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          setActiveIndex((current) => Math.min(geometry.points.length - 1, (current ?? 0) + 1));
        }
      }}
      onMouseLeave={() => {
        if (!interactive) return;
        setActiveIndex(null);
      }}
      onMouseMove={(event) => {
        if (!interactive) return;
        const rect = event.currentTarget.getBoundingClientRect();
        setActiveIndex(getNearestPointIndex(geometry.points, event.clientX, rect.left, rect.width));
      }}
    >
      {interactive && activePoint ? (
        <div
          className="ot-home-widget-tooltip"
          style={{ left: `${(activePoint.x / width) * 100}%` }}
        >
          <span>{valueFormatter(activePoint.value)}</span>
        </div>
      ) : null}

      <svg
        className="ot-home-widget-sparkline-svg"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={areaColor} stopOpacity="1" />
            <stop offset="100%" stopColor={areaColor} stopOpacity="0" />
          </linearGradient>
        </defs>
        {benchmarkGeometry.linePath ? (
          <path
            d={benchmarkGeometry.linePath}
            className="ot-home-widget-sparkline-benchmark"
            fill="none"
            stroke={benchmarkColor}
            strokeWidth="1"
          />
        ) : null}
        <path d={geometry.areaPath} fill={`url(#${gradientId})`} />
        <path d={geometry.linePath} fill="none" stroke={color} strokeWidth="1.8" />
        {interactive && activePoint ? (
          <>
            <line
              className="ot-home-widget-sparkline-crosshair"
              x1={activePoint.x}
              x2={activePoint.x}
              y1={SPARKLINE_PADDING}
              y2={height - SPARKLINE_PADDING}
            />
            <circle
              className="ot-home-widget-sparkline-marker"
              cx={activePoint.x}
              cy={activePoint.y}
              r="2.8"
              fill={color}
            />
          </>
        ) : null}
      </svg>
    </div>
  );
}
