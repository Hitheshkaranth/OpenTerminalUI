import { useId, useState } from "react";
import type { ScreenChange, ScreenCoverage } from "../../api/screenMonitoring";
import { screenChangeSummary, screenCoverageSegments, screenMetricComparisons, screenMetricDifference, screenMetricMeta, screenMetricScale, screenMetricValue } from "./screenChartData";

export function ScreenCoverageChart({ coverage }: { coverage: ScreenCoverage }) {
  const data = screenCoverageSegments(coverage);
  return <figure className="screen-monitor-chart screen-coverage-chart" aria-label="Screen data coverage">
    <figcaption>Data coverage <span>Companies checked, not companies matching</span></figcaption>
    {!data.consistent ? <p>Coverage counts do not reconcile. Review the source counts before interpreting this chart.</p> : data.requested === 0 ? <p>No universe observations are available to chart.</p> : <div className="screen-coverage-track" aria-hidden="true">{data.segments.filter(item => item.count > 0).map(item => <span key={item.key} className={`screen-coverage-segment screen-coverage-${item.key}`} style={{ width: `${item.percentage}%` }} title={`${item.label}: ${item.count} of ${data.requested}`}/>)}</div>}
    <ul className="screen-coverage-legend">{data.segments.map(item => <li key={item.key}><span className={`screen-coverage-swatch screen-coverage-${item.key}`} aria-hidden="true"/><span>{item.label}</span><strong>{item.count}</strong>{data.requested > 0 && data.consistent && <span className="screen-chart-muted">({item.percentage.toFixed(1)}%)</span>}</li>)}</ul>
  </figure>;
}

export function ScreenChangesChart({ changes }: { changes: ScreenChange[] }) {
  const data = screenChangeSummary(changes);
  const maximum = Math.max(data.entered, data.exited, 1);
  const dates = data.first && data.last ? `${new Date(data.first).toLocaleDateString()} to ${new Date(data.last).toLocaleDateString()}` : "Dates unavailable";
  return <figure className="screen-monitor-chart screen-changes-chart" aria-label="Recorded screen entries and exits">
    <figcaption>Recorded membership changes <span>{data.total} loaded records · {dates}</span></figcaption>
    {data.total === 0 ? <p>No recorded transitions to chart. The first check establishes a baseline.</p> : <><div className="screen-change-bars">{([{ label: "Entered", value: data.entered, kind: "entered" }, { label: "Exited", value: data.exited, kind: "exited" }]).map(item => <div className="screen-change-bar-row" key={item.kind}><span>{item.label}</span><div className="screen-change-bar-track" aria-hidden="true"><span className={`screen-change-bar screen-change-${item.kind}`} style={{ width: `${item.value / maximum * 100}%` }}/></div><strong>{item.value}</strong></div>)}</div><p className="screen-chart-muted">Counts represent transitions in the loaded history. A company can enter or exit more than once; missing data does not count as an exit.</p></>}
  </figure>;
}

export function ScreenMetricChangeChart({ change }: { change: ScreenChange }) {
  const comparisons = screenMetricComparisons(change);
  const first = comparisons.find(row => row.before !== row.after) ?? comparisons[0];
  const [chosen, setChosen] = useState(first?.metric ?? "");
  const selected = comparisons.find(row => row.metric === chosen) ?? first;
  const id = useId();
  if (!selected) return <p>No metric observations are available to compare.</p>;
  const meta = screenMetricMeta(selected.metric);
  const scale = screenMetricScale([selected.before, selected.after, ...selected.thresholds.map(t => t.value)]);
  const x = (value: number) => 24 + scale.position(value) * 3.72;
  const summary = `${meta.label}: previous ${screenMetricValue(selected.before, selected.metric)}, current ${screenMetricValue(selected.after, selected.metric)}. Change: ${screenMetricDifference(selected.before, selected.after, selected.metric)}.`;
  return <figure className="screen-monitor-chart screen-metric-chart" aria-label={`Metric change for ${change.symbol}`}>
    <div className="screen-metric-chart-heading"><figcaption>Before and after</figcaption><label htmlFor={id}>Compare metric <select id={id} value={selected.metric} onChange={event => setChosen(event.target.value)}>{comparisons.map(row => <option key={row.metric} value={row.metric}>{screenMetricMeta(row.metric).label}</option>)}</select></label></div>
    <p className="screen-metric-summary">{summary}</p>
    {selected.before === null && selected.after === null ? <p>No comparable values to plot.</p> : <svg viewBox="0 0 420 112" role="img" aria-label={summary} className="screen-metric-svg">
      <line x1={24} x2={396} y1={83} y2={83} className="screen-metric-axis"/>
      <line x1={x(0)} x2={x(0)} y1={12} y2={83} className="screen-metric-zero"/>
      {selected.thresholds.map((threshold, index) => <line key={`${threshold.operator}-${index}`} x1={x(threshold.value)} x2={x(threshold.value)} y1={12} y2={83} className="screen-metric-threshold"/>)}
      {selected.before !== null && selected.after !== null && <line x1={x(selected.before)} y1={28} x2={x(selected.after)} y2={59} className="screen-metric-connector"/>}
      {selected.before !== null && <><line x1={x(0)} x2={x(selected.before)} y1={28} y2={28} className="screen-metric-previous-line"/><circle cx={x(selected.before)} cy={28} r={5} className="screen-metric-previous"/></>}
      {selected.after !== null && <><line x1={x(0)} x2={x(selected.after)} y1={59} y2={59} className="screen-metric-current-line"/><circle cx={x(selected.after)} cy={59} r={5} className="screen-metric-current"/></>}
      <text x={24} y={104} textAnchor="start">{screenMetricValue(scale.low, selected.metric)}</text><text x={396} y={104} textAnchor="end">{screenMetricValue(scale.high, selected.metric)}</text>
    </svg>}
    <div className="screen-metric-legend"><span><i className="screen-metric-dot screen-metric-dot-previous" aria-hidden="true"/>Previous: {screenMetricValue(selected.before, selected.metric)}</span><span><i className="screen-metric-dot screen-metric-dot-current" aria-hidden="true"/>Current: {screenMetricValue(selected.after, selected.metric)}</span></div>
    {selected.thresholds.length > 0 && <p className="screen-chart-muted">Dashed line: saved condition {selected.thresholds.map(threshold => `${threshold.operator} ${screenMetricValue(threshold.value, selected.metric)}`).join("; ")}</p>}
    <p className="screen-chart-muted">Each metric uses its own scale. Values retain the provider's units; a rising value does not necessarily improve the thesis.</p>
  </figure>;
}
