import { useId, useMemo, useState } from "react";

import { buildSparklineGeometry, type SparklineGeometryPoint } from "./SparklineCell";

export type PortfolioMiniChartPoint = number | { label?: string; value: number };

export type PortfolioMiniChartProps = {
  points: readonly PortfolioMiniChartPoint[];
  benchmarkPoints?: readonly PortfolioMiniChartPoint[];
  width?: number;
  height?: number;
  className?: string;
  ariaLabel?: string;
  emptyLabel?: string;
  valueFormatter?: (value: number) => string;
};

const DEFAULT_LINE_COLOR = "var(--ot-color-accent-primary)";
const DEFAULT_BENCHMARK_COLOR = "var(--ot-color-home-widget-chart-benchmark)";
const DEFAULT_FILL_COLOR = "var(--ot-color-home-widget-chart-fill-top)";
const CHART_PADDING = 12;

type NormalizedPoint = {
  label: string;
  value: number;
};

function normalizePoints(points: readonly PortfolioMiniChartPoint[]): NormalizedPoint[] {
  return points
    .map((point, index) =>
      typeof point === "number"
        ? { label: `Point ${index + 1}`, value: point }
        : { label: point.label ?? `Point ${index + 1}`, value: point.value },
    )
    .filter((point) => Number.isFinite(point.value));
}

function formatDefaultValue(value: number): string {
  return value.toLocaleString("en-IN", {
    maximumFractionDigits: 0,
  });
}

function buildYAxisLabels(min: number, max: number, formatter: (value: number) => string): string[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  const mid = min + (max - min) / 2;
  return [formatter(max), formatter(mid), formatter(min)];
}

function buildXAxisLabels(points: readonly NormalizedPoint[]): string[] {
  if (points.length === 0) return [];
  const middleIndex = Math.floor((points.length - 1) / 2);
  return [points[0].label, points[middleIndex].label, points[points.length - 1].label];
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

export function PortfolioMiniChart({
  points,
  benchmarkPoints,
  width = 360,
  height = 196,
  className = "",
  ariaLabel = "Portfolio performance chart",
  emptyLabel = "No portfolio performance data available",
  valueFormatter = formatDefaultValue,
}: PortfolioMiniChartProps) {
  const gradientId = useId().replace(/:/g, "");
  const normalizedPoints = useMemo(() => normalizePoints(points), [points]);
  const normalizedBenchmark = useMemo(() => normalizePoints(benchmarkPoints ?? []), [benchmarkPoints]);
  const geometry = useMemo(
    () => buildSparklineGeometry(normalizedPoints.map((point) => point.value), width, height, CHART_PADDING),
    [height, normalizedPoints, width],
  );
  const benchmarkGeometry = useMemo(
    () => buildSparklineGeometry(normalizedBenchmark.map((point) => point.value), width, height, CHART_PADDING),
    [height, normalizedBenchmark, width],
  );
  const [activeIndex, setActiveIndex] = useState<number>(Math.max(0, normalizedPoints.length - 1));
  const activePoint = geometry.points[Math.min(activeIndex, Math.max(geometry.points.length - 1, 0))];
  const activeLabel = normalizedPoints[activeIndex]?.label ?? normalizedPoints[normalizedPoints.length - 1]?.label ?? "";
  const yAxisLabels = buildYAxisLabels(geometry.min, geometry.max, valueFormatter);
  const xAxisLabels = buildXAxisLabels(normalizedPoints);

  if (normalizedPoints.length === 0 || geometry.points.length === 0) {
    return (
      <div className={["ot-home-widget-chart", className].filter(Boolean).join(" ")} role="img" aria-label={emptyLabel}>
        <div className="ot-home-widget-empty">{emptyLabel}</div>
      </div>
    );
  }

  return (
    <figure
      className={["ot-home-widget-chart", className].filter(Boolean).join(" ")}
      role="group"
      aria-label={ariaLabel}
    >
      <div
        className="ot-home-widget-chart-frame"
        tabIndex={0}
        aria-label={`${ariaLabel} interaction surface`}
        onFocus={() => setActiveIndex(Math.max(0, normalizedPoints.length - 1))}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            setActiveIndex((current) => Math.max(0, current - 1));
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            setActiveIndex((current) => Math.min(normalizedPoints.length - 1, current + 1));
          }
        }}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setActiveIndex(getNearestPointIndex(geometry.points, event.clientX, rect.left, rect.width));
        }}
      >
        <div className="ot-home-widget-chart-axis ot-home-widget-chart-axis-y" aria-hidden="true">
          {yAxisLabels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>

        <div className="ot-home-widget-chart-tooltip">
          <span className="ot-home-widget-chart-tooltip-label">{activeLabel}</span>
          <span className="ot-home-widget-chart-tooltip-value">{valueFormatter(activePoint?.value ?? 0)}</span>
        </div>

        <svg
          className="ot-home-widget-chart-svg"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={DEFAULT_FILL_COLOR} stopOpacity="1" />
              <stop offset="100%" stopColor={DEFAULT_FILL_COLOR} stopOpacity="0" />
            </linearGradient>
          </defs>

          {[0.2, 0.5, 0.8].map((ratio) => {
            const y = CHART_PADDING + (height - CHART_PADDING * 2) * ratio;
            return (
              <line
                key={ratio}
                className="ot-home-widget-chart-grid-line"
                x1={CHART_PADDING}
                x2={width - CHART_PADDING}
                y1={y}
                y2={y}
              />
            );
          })}

          {benchmarkGeometry.linePath ? (
            <path
              d={benchmarkGeometry.linePath}
              className="ot-home-widget-chart-benchmark"
              fill="none"
              stroke={DEFAULT_BENCHMARK_COLOR}
              strokeWidth="1.2"
            />
          ) : null}

          <path d={geometry.areaPath} fill={`url(#${gradientId})`} />
          <path d={geometry.linePath} fill="none" stroke={DEFAULT_LINE_COLOR} strokeWidth="1.8" />
          {activePoint ? (
            <>
              <line
                className="ot-home-widget-chart-crosshair"
                x1={activePoint.x}
                x2={activePoint.x}
                y1={CHART_PADDING}
                y2={height - CHART_PADDING}
              />
              <circle
                className="ot-home-widget-chart-marker"
                cx={activePoint.x}
                cy={activePoint.y}
                r="3.2"
                fill={DEFAULT_LINE_COLOR}
              />
            </>
          ) : null}
        </svg>
      </div>

      <figcaption className="ot-home-widget-chart-meta">
        <div className="ot-home-widget-chart-axis ot-home-widget-chart-axis-x" aria-hidden="true">
          {xAxisLabels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div className="ot-home-widget-chart-summary">
          <span>Current {valueFormatter(normalizedPoints[normalizedPoints.length - 1]?.value ?? 0)}</span>
          {normalizedBenchmark.length > 0 ? (
            <span>Benchmark {valueFormatter(normalizedBenchmark[normalizedBenchmark.length - 1]?.value ?? 0)}</span>
          ) : null}
        </div>
      </figcaption>
    </figure>
  );
}
