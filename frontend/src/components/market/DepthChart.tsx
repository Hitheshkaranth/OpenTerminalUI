import { useId } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type DepthLevel = {
  price: number;
  bidSize: number;
  askSize: number;
};

type Props = {
  levels: DepthLevel[];
  midPrice?: number;
  compact?: boolean;
};

type DepthRow = {
  price: number;
  bid: number;
  ask: number;
};

function formatAxisPrice(value: number | string) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return numeric >= 1000 ? numeric.toFixed(1) : numeric.toFixed(2);
}

function buildDepthRows(levels: DepthLevel[]): DepthRow[] {
  if (!levels.length) return [];

  const bidLevels = levels
    .filter((level) => level.bidSize > 0)
    .sort((left, right) => right.price - left.price);
  const askLevels = levels
    .filter((level) => level.askSize > 0)
    .sort((left, right) => left.price - right.price);

  const rowsByPrice = new Map<number, DepthRow>();

  let runningBid = 0;
  for (const level of bidLevels) {
    runningBid += level.bidSize;
    rowsByPrice.set(level.price, {
      price: level.price,
      bid: runningBid,
      ask: 0,
    });
  }

  let runningAsk = 0;
  for (const level of askLevels) {
    runningAsk += level.askSize;
    const existing = rowsByPrice.get(level.price);
    if (existing) {
      existing.ask = runningAsk;
    } else {
      rowsByPrice.set(level.price, {
        price: level.price,
        bid: 0,
        ask: runningAsk,
      });
    }
  }

  return Array.from(rowsByPrice.values()).sort((left, right) => left.price - right.price);
}

function formatDepthTooltipValue(
  value: number | string | readonly (number | string)[] | undefined,
  name: string | number | undefined,
): [string, string] {
  const raw = Array.isArray(value) ? value[0] : value;
  const numeric = typeof raw === "number" ? raw : Number(raw);
  const label = name === "bid" ? "Bid depth" : "Ask depth";
  return [
    Number.isFinite(numeric) ? numeric.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "--",
    label,
  ];
}

export function DepthChart({ levels, midPrice, compact = false }: Props) {
  const rows = buildDepthRows(levels);
  const gradientId = useId().replace(/:/g, "");

  if (!rows.length) {
    return (
      <div className="flex h-full min-h-[220px] items-center justify-center rounded border border-terminal-border bg-terminal-bg text-[11px] text-terminal-muted">
        Depth unavailable
      </div>
    );
  }

  return (
    <div className="h-full min-h-[220px] rounded border border-terminal-border bg-terminal-bg p-2">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={rows}
          margin={{
            top: compact ? 8 : 12,
            right: compact ? 8 : 18,
            left: compact ? 4 : 12,
            bottom: compact ? 4 : 8,
          }}
        >
          <defs>
            <linearGradient id={`${gradientId}-bid`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00C853" stopOpacity={0.38} />
              <stop offset="100%" stopColor="#00C853" stopOpacity={0.04} />
            </linearGradient>
            <linearGradient id={`${gradientId}-ask`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FF5252" stopOpacity={0.34} />
              <stop offset="100%" stopColor="#FF5252" stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="2 3" vertical={false} />
          <XAxis
            dataKey="price"
            type="number"
            domain={["dataMin", "dataMax"]}
            tick={{ fill: "#94A3B8", fontSize: compact ? 9 : 10 }}
            tickFormatter={formatAxisPrice}
            minTickGap={compact ? 18 : 12}
            tickLine={false}
            axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
          />
          <YAxis
            tick={{ fill: "#64748B", fontSize: compact ? 9 : 10 }}
            tickFormatter={(value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 0 })}
            tickLine={false}
            axisLine={false}
            width={compact ? 44 : 54}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#0F172A",
              borderColor: "rgba(255,255,255,0.14)",
              fontSize: compact ? "10px" : "11px",
            }}
            formatter={(value, name) => formatDepthTooltipValue(value, name)}
            labelFormatter={(label) => `Price ${formatAxisPrice(label)}`}
          />
          {Number.isFinite(midPrice) && Number(midPrice) > 0 ? (
            <ReferenceLine
              x={Number(midPrice)}
              stroke="rgba(255,255,255,0.28)"
              strokeDasharray="4 4"
              label={{
                value: "Mid",
                fill: "#94A3B8",
                fontSize: compact ? 9 : 10,
                position: "insideTop",
              }}
            />
          ) : null}
          <Area type="monotone" dataKey="bid" stroke="#00C853" fill={`url(#${gradientId}-bid)`} strokeWidth={2} isAnimationActive={false} />
          <Area type="monotone" dataKey="ask" stroke="#FF5252" fill={`url(#${gradientId}-ask)`} strokeWidth={2} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
