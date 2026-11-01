import { useEffect, useId, useMemo, useRef, useState } from 'react';
import './ExperimentCharts.css';

export type ExperimentPeriodResult = {
  total_return?: number; max_drawdown?: number; trades?: unknown[]; bars?: number;
  initial_cash?: number; equity_curve?: Array<{ date: string; equity: number }>;
  drawdown_series?: number[];
};
export type ExperimentResults = { training?: ExperimentPeriodResult; validation?: ExperimentPeriodResult };
type Point = { date: string; timestamp: number; equity: number; returnPct: number | null; drawdownPct: number | null };
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const pct = (value: number | null | undefined) => finite(value) ? `${value.toFixed(2)}%` : 'Not recorded';
const dateLabel = (date: string) => date.slice(0, 10);

export function experimentChartPoints(result?: ExperimentPeriodResult): Point[] {
  if (!result?.equity_curve?.length) return [];
  const initial = finite(result.initial_cash) && result.initial_cash > 0 ? result.initial_cash : null;
  let peak = initial;
  let previous = -Infinity;
  const points: Point[] = [];
  for (let index = 0; index < result.equity_curve.length; index++) {
    const row = result.equity_curve[index];
    const timestamp = Date.parse(row.date);
    // Refuse a malformed curve instead of bridging over an unknown observation.
    if (!finite(timestamp) || timestamp <= previous || !finite(row.equity)) return [];
    previous = timestamp;
    peak = peak === null ? row.equity : Math.max(peak, row.equity);
    const savedDrawdown = result.drawdown_series?.length === result.equity_curve.length ? result.drawdown_series[index] : undefined;
    points.push({ date: row.date, timestamp, equity: row.equity,
      returnPct: initial === null ? null : (row.equity / initial - 1) * 100,
      drawdownPct: finite(savedDrawdown) && savedDrawdown <= 0 ? savedDrawdown * 100 : peak > 0 ? (row.equity / peak - 1) * 100 : null });
  }
  return points;
}

/** Preserve extrema in each bucket so drawdown troughs survive display reduction. */
export function chartDisplayPoints(points: Point[], metric: 'returnPct' | 'drawdownPct'): Point[] {
  if (points.length <= 600) return points;
  const chosen = new Set<number>([0, points.length - 1]);
  const size = Math.ceil(points.length / 250);
  for (let start = 0; start < points.length; start += size) {
    let low = start, high = start;
    for (let index = start; index < Math.min(start + size, points.length); index++) {
      if ((points[index][metric] ?? Infinity) < (points[low][metric] ?? Infinity)) low = index;
      if ((points[index][metric] ?? -Infinity) > (points[high][metric] ?? -Infinity)) high = index;
    }
    chosen.add(low); chosen.add(high);
  }
  return [...chosen].sort((a, b) => a - b).map(index => points[index]);
}

function Comparison({ results }: { results: ExperimentResults }) {
  return <div className="experiment-comparison" aria-label="Training and validation comparison">
    {([['total_return', 'Total return'], ['max_drawdown', 'Maximum drawdown']] as const).map(([metric, label]) => {
      const values = [results.training?.[metric], results.validation?.[metric]];
      const scale = Math.max(...values.filter(finite).map(value => Math.abs(value * 100)), 1);
      return <figure key={metric} className="experiment-comparison-metric"><figcaption>{label}</figcaption>
        {(['training', 'validation'] as const).map((period, index) => {
          const value = values[index]; const percent = finite(value) ? value * 100 : null;
          return <div key={period} className="experiment-comparison-row"><span>{period === 'training' ? 'Training' : 'Validation'}</span>
            <div className="experiment-bar-track" aria-hidden="true"><span className="experiment-zero" />{percent !== null && <span className={`experiment-bar experiment-bar--${period}`} style={{ width: `${Math.abs(percent) / scale * 50}%`, left: `${percent < 0 ? 50 - Math.abs(percent) / scale * 50 : 50}%` }} />}</div>
            <strong>{pct(percent)}</strong></div>;
        })}
        <p className="experiment-chart-note">{pct(-scale)} <span>0%</span> {pct(scale)}</p>
      </figure>;
    })}
  </div>;
}

export function ExperimentCharts({ results }: { results: ExperimentResults }) {
  const [period, setPeriod] = useState<'training' | 'validation'>('validation');
  const [metric, setMetric] = useState<'returnPct' | 'drawdownPct'>('returnPct');
  const [selected, setSelected] = useState<number | null>(null);
  const chartId = useId();
  const figureRef = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(740);
  const points = useMemo(() => experimentChartPoints(results[period]), [results, period]);
  const displayed = useMemo(() => chartDisplayPoints(points, metric), [points, metric]);
  const valid = points.length >= 2 && points.every(point => finite(point[metric]));
  useEffect(() => {
    const element = figureRef.current;
    if (!element) return;
    const measure = () => { const measured = element.getBoundingClientRect().width; if (measured > 0) setWidth(Math.max(280, measured)); };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, [valid]);
  const right = width - 24;
  const values = valid ? displayed.map(point => point[metric] as number) : [];
  const min = Math.min(0, ...values), max = Math.max(0, ...values);
  const range = max - min || 1;
  const yMin = min - range * .08, yMax = metric === 'drawdownPct' ? 0 : max + range * .08;
  const x = (point: Point) => 66 + (point.timestamp - points[0].timestamp) / (points[points.length - 1].timestamp - points[0].timestamp) * (right - 66);
  const y = (value: number) => 20 + (yMax - value) / (yMax - yMin) * 190;
  const current = points[Math.min(selected ?? points.length - 1, points.length - 1)];
  const label = `${period === 'training' ? 'Training' : 'Validation'} ${metric === 'returnPct' ? 'cumulative return' : 'drawdown'}`;
  return <section className="experiment-charts" aria-label="Experiment performance charts">
    <h5>Performance at a glance</h5>
    <Comparison results={results} />
    <div className="experiment-chart-controls">
      <fieldset><legend>Period</legend>{(['training', 'validation'] as const).map(value => <button key={value} type="button" aria-pressed={period === value} onClick={() => { setPeriod(value); setSelected(null); }}>{value === 'training' ? 'Training' : 'Validation'}</button>)}</fieldset>
      <fieldset><legend>Measure</legend>{([['returnPct', 'Cumulative return'], ['drawdownPct', 'Drawdown']] as const).map(([value, text]) => <button key={value} type="button" aria-pressed={metric === value} onClick={() => setMetric(value)}>{text}</button>)}</fieldset>
    </div>
    {valid ? <figure ref={figureRef} className="experiment-series"><figcaption>{label}</figcaption>
      <svg viewBox={`0 0 ${width} 250`} role="img" aria-labelledby={`${chartId}-title ${chartId}-description`}>
        <title id={`${chartId}-title`}>{label} over {points.length} saved observations</title>
        <desc id={`${chartId}-description`}>From {dateLabel(points[0].date)} to {dateLabel(points[points.length - 1].date)}. Final {pct(points[points.length - 1][metric])}. Values come from saved simulated equity, including configured fees and slippage.</desc>
        {[yMax, (yMax + yMin) / 2, yMin].map(tick => <g key={tick}><line x1="66" x2={right} y1={y(tick)} y2={y(tick)} className="experiment-gridline" /><text x="58" y={y(tick) + 4} textAnchor="end">{tick.toFixed(1)}%</text></g>)}
        <line x1="66" x2={right} y1={y(0)} y2={y(0)} className="experiment-baseline" />
        <polyline points={displayed.map(point => `${x(point).toFixed(2)},${y(point[metric] as number).toFixed(2)}`).join(' ')} fill="none" className={`experiment-line experiment-line--${period}`} />
        {current && <><line x1={x(current)} x2={x(current)} y1="20" y2="210" className="experiment-cursor" /><circle cx={x(current)} cy={y(current[metric] as number)} r="4" className={`experiment-point experiment-point--${period}`} /></>}
        <text x="66" y="239">{dateLabel(points[0].date)}</text><text x={right} y="239" textAnchor="end">{dateLabel(points[points.length - 1].date)}</text>
      </svg>
      <div className="experiment-inspection"><label htmlFor={`${chartId}-observation`}>Inspect saved observation</label><output htmlFor={`${chartId}-observation`}>{current ? `${dateLabel(current.date)} · ${pct(current[metric])}` : 'Not recorded'}</output></div>
      <input id={`${chartId}-observation`} className="experiment-observation" type="range" min="0" max={points.length - 1} value={selected ?? points.length - 1} onChange={event => setSelected(Number(event.target.value))} aria-valuetext={current ? `${dateLabel(current.date)}, ${pct(current[metric])}` : undefined} />
      <p className="experiment-chart-note">Each period starts with its own portfolio. Curves are not joined across the training/validation boundary. {metric === 'drawdownPct' ? 'Drawdown uses the saved series, or is calculated from saved equity peaks when no series was recorded.' : 'Return is measured against the recorded starting cash.'}{points.length > displayed.length ? ' The display preserves bucket highs and lows; use the observation control to inspect every saved value.' : ''}</p>
    </figure> : <p className="experiment-chart-unavailable">{points.length && metric === 'returnPct' ? 'Starting cash is not recorded, so a cumulative-return curve cannot be calculated.' : `No usable ${period} equity series was recorded.`} The comparison above uses saved summary values only.</p>}
  </section>;
}
