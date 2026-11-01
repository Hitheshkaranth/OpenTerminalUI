import { expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { chartDisplayPoints, ExperimentCharts, experimentChartPoints } from '../components/research/ExperimentCharts';

const curve = { initial_cash: 100, total_return: -.01, max_drawdown: -.1, equity_curve: [
  { date: '2025-01-01', equity: 100 }, { date: '2025-01-02', equity: 110 }, { date: '2025-01-03', equity: 99 },
] };

it('calculates return and drawdown only from recorded equity and starting capital', () => {
  const points = experimentChartPoints(curve);
  expect(points[1].returnPct).toBeCloseTo(10);
  expect(points[2].returnPct).toBeCloseTo(-1);
  expect(points[2].drawdownPct).toBeCloseTo(-10);
  expect(experimentChartPoints({ ...curve, initial_cash: undefined })[0].returnPct).toBeNull();
  expect(experimentChartPoints({ ...curve, drawdown_series: [0, 0, -.12] })[2].drawdownPct).toBe(-12);
});

it('refuses malformed or nonchronological curves rather than bridging missing observations', () => {
  expect(experimentChartPoints({ equity_curve: [{ date: 'invalid', equity: 1 }] })).toEqual([]);
  expect(experimentChartPoints({ equity_curve: [{ date: '2025-01-01', equity: Number.NaN }] })).toEqual([]);
  expect(experimentChartPoints({ equity_curve: [curve.equity_curve[1], curve.equity_curve[0]] })).toEqual([]);
});

it('provides keyboard observation inspection and keeps training and validation separate', () => {
  render(<ExperimentCharts results={{ validation: curve, training: { ...curve, equity_curve: [{ date: '2024-01-01', equity: 100 }, { date: '2024-01-02', equity: 105 }] } }} />);
  expect(screen.getByRole('img', { name: /Validation cumulative return over 3 saved observations/ })).toBeInTheDocument();
  const slider = screen.getByRole('slider', { name: 'Inspect saved observation' });
  fireEvent.change(slider, { target: { value: '1' } });
  expect(slider).toHaveAttribute('aria-valuetext', '2025-01-02, 10.00%');
  fireEvent.click(screen.getByRole('button', { name: 'Drawdown', exact: true }));
  expect(screen.getByRole('img', { name: /Validation drawdown over 3 saved observations/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Training', exact: true }));
  expect(screen.getByRole('img', { name: /Training drawdown over 2 saved observations/ })).toBeInTheDocument();
  expect(slider).toHaveAttribute('aria-valuetext', '2024-01-02, 0.00%');
});

it('shows only truthful summary comparisons when an old snapshot lacks curves', () => {
  render(<ExperimentCharts results={{ training: { total_return: .1, max_drawdown: -.2 } }} />);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  expect(screen.getByText('10.00%')).toBeInTheDocument();
  expect(screen.getAllByText('Not recorded')).toHaveLength(2);
  expect(screen.getByText(/No usable validation equity series/)).toBeInTheDocument();
});

it('preserves sharp troughs and endpoints when reducing a large series for display', () => {
  const equity_curve = Array.from({ length: 2000 }, (_, index) => ({ date: new Date(Date.UTC(2020, 0, index + 1)).toISOString(), equity: index === 997 ? 10 : 100 }));
  const points = experimentChartPoints({ initial_cash: 100, equity_curve });
  const display = chartDisplayPoints(points, 'drawdownPct');
  expect(display.length).toBeLessThan(600);
  expect(display[0]).toEqual(points[0]);
  expect(display.at(-1)).toEqual(points.at(-1));
  expect(display.find(point => point.date === equity_curve[997].date)?.drawdownPct).toBe(-90);
});
