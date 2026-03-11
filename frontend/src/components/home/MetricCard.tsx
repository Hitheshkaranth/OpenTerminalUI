import type { ReactNode } from "react";

import { SparklineCell } from "./SparklineCell";

export type MetricCardTone = "accent" | "up" | "down" | "neutral";

export type MetricCardDelta = {
  label: string;
  tone?: MetricCardTone;
};

export type MetricCardDetail = {
  label: string;
  value: string;
  tone?: MetricCardTone;
};

export type MetricCardProps = {
  label: string;
  value: string;
  delta?: MetricCardDelta;
  tone?: MetricCardTone;
  badge?: ReactNode;
  details?: readonly MetricCardDetail[];
  sparklinePoints?: readonly number[];
  sparklineAriaLabel?: string;
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
};

function toTone(tone: MetricCardTone | undefined): MetricCardTone {
  return tone ?? "neutral";
}

export function MetricCard({
  label,
  value,
  delta,
  tone = "accent",
  badge,
  details,
  sparklinePoints,
  sparklineAriaLabel,
  footer,
  children,
  className = "",
}: MetricCardProps) {
  const cardClassName = ["ot-home-widget-card", "ot-home-widget-metric-card", className].filter(Boolean).join(" ");

  return (
    <section className={cardClassName} aria-label={label}>
      <header className="ot-home-widget-card-header">
        <div>
          <p className="ot-home-widget-card-kicker">{label}</p>
          <p className="ot-home-widget-card-value" data-tone={tone}>
            {value}
          </p>
        </div>
        {badge ? <div className="ot-home-widget-card-badge">{badge}</div> : null}
      </header>

      {delta ? (
        <div className="ot-home-widget-delta" data-tone={toTone(delta.tone)}>
          {delta.label}
        </div>
      ) : null}

      {sparklinePoints && sparklinePoints.length > 1 ? (
        <SparklineCell
          className="ot-home-widget-card-sparkline"
          points={sparklinePoints}
          ariaLabel={sparklineAriaLabel ?? `${label} sparkline`}
          showTooltip
        />
      ) : null}

      {details && details.length > 0 ? (
        <dl className="ot-home-widget-metric-details">
          {details.map((detail) => (
            <div key={`${detail.label}-${detail.value}`} className="ot-home-widget-metric-detail">
              <dt className="ot-home-widget-metric-detail-label">{detail.label}</dt>
              <dd className="ot-home-widget-metric-detail-value" data-tone={toTone(detail.tone)}>
                {detail.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {children ? <div className="ot-home-widget-card-body">{children}</div> : null}
      {footer ? <div className="ot-home-widget-card-footer">{footer}</div> : null}
    </section>
  );
}
