import type { ConditionStatus, EarningsMetric, ThesisCondition } from "../../api/researchDossiers";
import "./ResearchMetricCharts.css";

const finite = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);
const format = (value: number) => value.toLocaleString(undefined, { maximumSignificantDigits: 6 });
export function metricDomain(values: (number | null | undefined)[]): [number, number] | null {
  const numbers = values.filter(finite);
  if (!numbers.length) return null;
  const low = Math.min(...numbers), high = Math.max(...numbers);
  const padding = high === low ? Math.max(Math.abs(low) * 0.2, 1) : (high - low) * 0.15;
  return [low - padding, high + padding];
}

type Row = { label: string; value?: number | null; shape?: "square" | "outline"; text?: string };
function MetricPlot({ label, unit, rows, threshold, band, note }: {
  label: string; unit: string; rows: Row[]; threshold?: number;
  band?: { low?: number | null; high?: number | null }; note?: string;
}) {
  const domain = metricDomain([...rows.map(r => r.value), threshold, band?.low, band?.high]);
  const position = (value: number) => domain ? `${100 * (value - domain[0]) / (domain[1] - domain[0])}%` : "50%";
  const validBand = band && (finite(band.low) || finite(band.high)) && !(finite(band.low) && finite(band.high) && band.low > band.high);
  return <figure className="research-metric-chart" aria-label={label}>
    <figcaption>{label}<span>{unit} · independent scale</span></figcaption>
    <dl>{rows.map(row => <div className="research-metric-chart__row" key={row.label}><dt>{row.label}</dt><dd>
      <svg aria-hidden="true" className="research-metric-chart__lane" height="28">
        {domain && <line className="research-metric-chart__baseline" x1="0" x2="100%" y1="14" y2="14" />}
        {domain && validBand && <rect className="research-metric-chart__band" x={position(finite(band.low) ? band.low : domain[0])} width={`${100 * ((finite(band.high) ? band.high : domain[1]) - (finite(band.low) ? band.low : domain[0])) / (domain[1] - domain[0])}%`} y="3" height="22" />}
        {finite(threshold) && <line className="research-metric-chart__threshold" x1={position(threshold)} x2={position(threshold)} y1="0" y2="28" />}
        {validBand && [band.low, band.high].filter(finite).map((bound, index) => <line key={index} className="research-metric-chart__threshold" x1={position(bound)} x2={position(bound)} y1="3" y2="25" />)}
        {finite(row.value) && (row.shape === "square" ? <rect className="research-metric-chart__point research-metric-chart__point--outline" x={position(row.value)} y="10" width="8" height="8" transform="translate(-4 0)" /> : <circle className={`research-metric-chart__point ${row.shape === "outline" ? "research-metric-chart__point--outline" : ""}`} cx={position(row.value)} cy="14" r="4" />)}
      </svg><span className="research-metric-chart__value">{row.text ?? (finite(row.value) ? `${format(row.value)} ${unit}` : "Not recorded")}</span>
    </dd></div>)}</dl>
    {domain ? <div className="research-metric-chart__axis" aria-label={`Scale from ${format(domain[0])} to ${format(domain[1])} ${unit}`}><span>{format(domain[0])}</span><span>{format(domain[1])}</span></div> : <p>No numeric observations to plot.</p>}
    {note && <p className="research-metric-chart__note">{note}</p>}
  </figure>;
}

export function ThresholdComparisonChart({ condition, result }: { condition: ThesisCondition; result?: ConditionStatus }) {
  const symbols = { gte: "≥", lte: "≤", gt: ">", lt: "<", eq: "=" };
  return <MetricPlot label={`${condition.label} · threshold comparison`} unit={condition.unit} threshold={condition.threshold}
    rows={[
      { label: "Threshold", value: condition.threshold, shape: "square", text: `${symbols[condition.operator]} ${format(condition.threshold)} ${condition.unit}` },
      { label: "Previous", value: result?.previous_value, shape: "outline" },
      { label: "Latest", value: result?.value },
    ]} note={`${!condition.enabled ? "Monitoring paused. " : ""}${result?.evidence?.period ? `Latest: ${result.evidence.period}. ` : ""}${finite(result?.value) ? "Dashed line: your threshold; hollow circle: previous observation." : "Awaiting a comparable observation. Dashed line: your threshold."}`} />;
}

export function EarningsComparisonChart({ metric, period }: { metric: EarningsMetric; period: string }) {
  const low = metric.guidance_low, high = metric.guidance_high;
  const guidance = finite(low) && finite(high) ? low > high ? "Guidance bounds are inconsistent; no band shown." : `Guidance band: ${format(low)}–${format(high)} ${metric.unit}.` : finite(low) ? `Guidance: at least ${format(low)} ${metric.unit}; shading continues to the right.` : finite(high) ? `Guidance: at most ${format(high)} ${metric.unit}; shading continues to the left.` : "Guidance not recorded.";
  return <MetricPlot label={`${metric.label} · ${period} earnings comparison`} unit={metric.unit}
    rows={[{ label: "Forecast", value: metric.expected, shape: "square" }, { label: "Actual", value: metric.actual }]}
    band={{ low, high }} note={`${guidance} Square: your forecast; circle: reported actual.`} />;
}
