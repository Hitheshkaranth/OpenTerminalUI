import type { Bar } from "oakscriptjs";

export type AlternativeChartParams = {
  renkoBrickSize: number;
  kagiReversal: number;
  pointFigureBoxSize: number;
  pointFigureReversalBoxes: number;
  lineBreakCount: number;
};

export const ALT_CHART_PARAMS_STORAGE_KEY = "ot:alt-chart-params:v1";
export const ALT_CHART_PARAMS_EVENT = "ot:alt-chart-params";

export const DEFAULT_ALT_CHART_PARAMS: AlternativeChartParams = {
  renkoBrickSize: 1,
  kagiReversal: 1,
  pointFigureBoxSize: 1,
  pointFigureReversalBoxes: 3,
  lineBreakCount: 3,
};

export function sanitizeAlternativeChartParams(input: Partial<AlternativeChartParams> | null | undefined): AlternativeChartParams {
  const source = input ?? {};
  const safe = (value: unknown, fallback: number, min: number, max: number): number => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };
  return {
    renkoBrickSize: safe(source.renkoBrickSize, DEFAULT_ALT_CHART_PARAMS.renkoBrickSize, 0.0001, 1_000_000),
    kagiReversal: safe(source.kagiReversal, DEFAULT_ALT_CHART_PARAMS.kagiReversal, 0.0001, 1_000_000),
    pointFigureBoxSize: safe(source.pointFigureBoxSize, DEFAULT_ALT_CHART_PARAMS.pointFigureBoxSize, 0.0001, 1_000_000),
    pointFigureReversalBoxes: Math.round(safe(source.pointFigureReversalBoxes, DEFAULT_ALT_CHART_PARAMS.pointFigureReversalBoxes, 1, 20)),
    lineBreakCount: Math.round(safe(source.lineBreakCount, DEFAULT_ALT_CHART_PARAMS.lineBreakCount, 1, 10)),
  };
}

function normalizedBar(time: number, open: number, close: number, volume: number): Bar {
  const high = Math.max(open, close);
  const low = Math.min(open, close);
  return {
    time,
    open,
    high,
    low,
    close,
    volume: Number.isFinite(volume) ? volume : 0,
  };
}

export function transformRenkoBars(bars: Bar[], brickSize: number): Bar[] {
  if (!bars.length) return [];
  const size = Math.max(0.0001, brickSize);
  const out: Bar[] = [];
  let anchor = Number(bars[0].close);
  for (const row of bars) {
    const close = Number(row.close);
    while (close >= anchor + size) {
      const next = anchor + size;
      out.push(normalizedBar(Number(row.time), anchor, next, Number(row.volume ?? 0)));
      anchor = next;
    }
    while (close <= anchor - size) {
      const next = anchor - size;
      out.push(normalizedBar(Number(row.time), anchor, next, Number(row.volume ?? 0)));
      anchor = next;
    }
  }
  return out;
}

export function transformKagiBars(bars: Bar[], reversalAmount: number): Bar[] {
  if (!bars.length) return [];
  const rev = Math.max(0.0001, reversalAmount);
  const out: Bar[] = [];
  let last = Number(bars[0].close);
  let direction: 1 | -1 = 1;
  for (let i = 1; i < bars.length; i += 1) {
    const close = Number(bars[i].close);
    const diff = close - last;
    if (direction === 1) {
      if (diff >= 0) {
        out.push(normalizedBar(Number(bars[i].time), last, close, Number(bars[i].volume ?? 0)));
        last = close;
      } else if (Math.abs(diff) >= rev) {
        direction = -1;
        out.push(normalizedBar(Number(bars[i].time), last, close, Number(bars[i].volume ?? 0)));
        last = close;
      }
    } else if (diff <= 0) {
      out.push(normalizedBar(Number(bars[i].time), last, close, Number(bars[i].volume ?? 0)));
      last = close;
    } else if (Math.abs(diff) >= rev) {
      direction = 1;
      out.push(normalizedBar(Number(bars[i].time), last, close, Number(bars[i].volume ?? 0)));
      last = close;
    }
  }
  return out;
}

export function transformPointFigureBars(bars: Bar[], boxSize: number, reversalBoxes: number): Bar[] {
  if (!bars.length) return [];
  const box = Math.max(0.0001, boxSize);
  const rev = Math.max(1, Math.round(reversalBoxes));
  const out: Bar[] = [];
  let columnTop = Number(bars[0].close);
  let columnBottom = Number(bars[0].close);
  let direction: 1 | -1 = 1;
  for (const row of bars) {
    const close = Number(row.close);
    if (direction === 1) {
      if (close >= columnTop + box) {
        while (close >= columnTop + box) {
          const next = columnTop + box;
          out.push(normalizedBar(Number(row.time), columnTop, next, Number(row.volume ?? 0)));
          columnTop = next;
        }
        columnBottom = Math.min(columnBottom, columnTop);
      } else if (close <= columnTop - box * rev) {
        direction = -1;
        columnBottom = columnTop - box;
        out.push(normalizedBar(Number(row.time), columnTop, columnBottom, Number(row.volume ?? 0)));
      }
    } else if (close <= columnBottom - box) {
      while (close <= columnBottom - box) {
        const next = columnBottom - box;
        out.push(normalizedBar(Number(row.time), columnBottom, next, Number(row.volume ?? 0)));
        columnBottom = next;
      }
      columnTop = Math.max(columnTop, columnBottom);
    } else if (close >= columnBottom + box * rev) {
      direction = 1;
      columnTop = columnBottom + box;
      out.push(normalizedBar(Number(row.time), columnBottom, columnTop, Number(row.volume ?? 0)));
    }
  }
  return out;
}

export function transformLineBreakBars(bars: Bar[], lineCount: number): Bar[] {
  if (!bars.length) return [];
  const count = Math.max(1, Math.round(lineCount));
  const lines: Bar[] = [];
  lines.push(normalizedBar(Number(bars[0].time), Number(bars[0].open), Number(bars[0].close), Number(bars[0].volume ?? 0)));
  for (let i = 1; i < bars.length; i += 1) {
    const close = Number(bars[i].close);
    const recent = lines.slice(-count);
    const highs = recent.map((r) => Number(r.high));
    const lows = recent.map((r) => Number(r.low));
    const maxHigh = Math.max(...highs);
    const minLow = Math.min(...lows);
    const lastClose = Number(lines[lines.length - 1].close);
    if (close > maxHigh || close < minLow) {
      lines.push(normalizedBar(Number(bars[i].time), lastClose, close, Number(bars[i].volume ?? 0)));
    }
  }
  return lines;
}
