import { useMemo } from "react";

export type ProfileCompletionRingProps = {
  value: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
  missingFields?: readonly string[];
  className?: string;
};

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export function ProfileCompletionRing({
  value,
  size = 48,
  strokeWidth = 3,
  label = "Profile completion",
  missingFields = [],
  className = "",
}: ProfileCompletionRingProps) {
  const progress = clampPercentage(value);
  const radius = useMemo(() => Math.max(0, size / 2 - strokeWidth), [size, strokeWidth]);
  const circumference = useMemo(() => 2 * Math.PI * radius, [radius]);
  const dashOffset = useMemo(() => circumference - (progress / 100) * circumference, [circumference, progress]);

  return (
    <div
      className={["ot-home-widget-ring", className].filter(Boolean).join(" ")}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress)}
    >
      <svg
        className="ot-home-widget-ring-svg"
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        aria-hidden="true"
      >
        <circle
          className="ot-home-widget-ring-track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <circle
          className="ot-home-widget-ring-progress"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
        <text className="ot-home-widget-ring-value" x="50%" y="50%" textAnchor="middle" dominantBaseline="central">
          {Math.round(progress)}%
        </text>
      </svg>
      <div className="ot-home-widget-ring-copy">
        <span className="ot-home-widget-ring-label">{label}</span>
        <span className="ot-home-widget-ring-summary">
          {missingFields.length > 0 ? `Missing: ${missingFields.join(", ")}` : "Complete"}
        </span>
      </div>
    </div>
  );
}
