import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer } from "recharts";

type RadarScorecardProps = {
  data: Array<Record<string, unknown>>;
  dataKey?: string;
};

export function RadarScorecard({ data, dataKey = "value" }: RadarScorecardProps) {
  if (!data.length) return <div className="text-xs text-terminal-muted">No radar data</div>;
  return (
    <div className="h-60 w-full">
      <ResponsiveContainer>
        <RadarChart data={data}>
          <PolarGrid stroke="#2a2f3e" />
          <PolarAngleAxis dataKey="axis" stroke="#8892a4" />
          <Radar dataKey={dataKey} stroke="#18ffff" fill="#18ffff" fillOpacity={0.35} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
